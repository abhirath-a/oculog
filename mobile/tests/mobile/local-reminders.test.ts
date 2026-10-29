// biome-ignore-all lint/style/noNonNullAssertion: Synthetic fixtures explicitly populate optional state and prescriptions.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
	createReminderManager,
	type ReminderDependencies,
	type ScheduledReminder,
	type StoredReminders,
} from "../../src/lib/local-reminders/manager";
import {
	buildReminderPlans,
	defaultPreferences,
	FEATURE,
	type ReminderPlan,
	type ReminderSnapshot,
	validatePreferences,
} from "../../src/lib/local-reminders/model";
import { deviceCalendarDate } from "../../src/lib/prescriptions/calendar";
import { emptyDraft } from "../../src/lib/prescriptions/model";

const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const snap = (owner = "account-A", token = "token-A"): ReminderSnapshot => ({
	owner,
	sessionKey: token,
	state: {
		today: "2026-03-08",
		timeZone: "America/New_York",
		eyes: [
			{
				id: "saved-left",
				eye: "left",
				replacementDays: 14,
				openedOn: "2026-02-22",
				dueOn: "2026-03-08",
				daysRemaining: 0,
				spareCount: 2,
			},
			{
				id: "saved-right",
				eye: "right",
				replacementDays: 14,
				openedOn: "2026-02-22",
				dueOn: "2026-03-08",
				daysRemaining: 0,
				spareCount: 2,
			},
		],
		daily: { localDate: "2026-03-08", worn: true },
	},
	prescription: {
		version: 1,
		id: "confirmed",
		confirmedAt: "2026-03-01T00:00:00Z",
		...emptyDraft(),
		expiresOn: "2026-04-08",
	},
});
const enabled = () => {
	const p = defaultPreferences();
	p.daily.enabled = p.replacement.enabled = p.prescription.enabled = true;
	return p;
};
const date = (value = "2026-03-08T08:00:00") => new Date(value);
const off: ReminderSnapshot = {
	owner: null,
	sessionKey: null,
	state: null,
	prescription: null,
};
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
function harness() {
	const storage = new Map<string, StoredReminders>();
	const pending = new Map<string, ScheduledReminder>();
	const scheduled: {
		id: string;
		plan: ReminderPlan;
		data: Record<string, unknown>;
	}[] = [];
	const cancelled: string[] = [];
	let counter = 0;
	let permission: "granted" | "denied" | "undetermined" = "granted";
	let now = date();
	let promptCount = 0;
	let failCancel = false;
	let failSchedule = false;
	let failSave = false;
	let hook: ((point: string) => Promise<void>) | null = null;
	const pause = async (point: string) => {
		if (hook) await hook(point);
	};
	const deps: ReminderDependencies = {
		async hash(owner) {
			await pause("hash");
			return hash(owner);
		},
		storage: {
			async load(key) {
				await pause("load");
				return structuredClone(storage.get(key) ?? null);
			},
			async save(key, value) {
				if (failSave) throw new Error("save failure");
				storage.set(key, structuredClone(value));
				await pause("save");
			},
		},
		async permission(request) {
			if (request) promptCount++;
			await pause(request ? "permission-request" : "permission-read");
			return permission;
		},
		async scheduled() {
			await pause("scheduled");
			return [...pending.values()];
		},
		async schedule(plan, data) {
			if (failSchedule) throw new Error("schedule failure");
			await pause("schedule-before");
			const id = `notification-${++counter}`;
			pending.set(id, { identifier: id, data });
			scheduled.push({ id, plan, data });
			await pause("schedule-after");
			return id;
		},
		async cancel(id) {
			if (failCancel) throw new Error("cancel failure");
			cancelled.push(id);
			pending.delete(id);
			await pause("cancel");
		},
		now: () => now,
	};
	const manager = createReminderManager(deps);
	return {
		manager,
		deps,
		storage,
		pending,
		scheduled,
		cancelled,
		setPermission: (p: typeof permission) => {
			permission = p;
		},
		setNow: (value: Date) => {
			now = value;
		},
		prompts: () => promptCount,
		failCancel: (v: boolean) => {
			failCancel = v;
		},
		failSchedule: (v: boolean) => {
			failSchedule = v;
		},
		failSave: (v: boolean) => {
			failSave = v;
		},
		block(point: string, skip = 0) {
			const entered = deferred();
			const release = deferred();
			hook = async (p) => {
				if (p !== point) return;
				if (skip-- > 0) return;
				hook = null;
				entered.resolve();
				await release.promise;
			};
			return { entered: entered.promise, release: release.resolve };
		},
	};
}

test("defaults are opt-in and malformed preferences are rejected", () => {
	const p = defaultPreferences();
	assert.equal(p.daily.hour, 21);
	assert.equal(p.replacement.hour, 9);
	assert.equal(p.prescription.hour, 9);
	assert.equal(buildReminderPlans(snap(), p, date()).length, 0);
	for (const bad of [
		{ ...p, daily: { enabled: 1, hour: 9, minute: 0 } },
		{ ...p, daily: { enabled: true, hour: 24, minute: 0 } },
		{ ...p, daily: { enabled: true, hour: 9, minute: -1 } },
	])
		assert.throws(() => validatePreferences(bad));
});

test("daily is one honest repeating check-in even when logged; due dates group eyes", () => {
	const plans = buildReminderPlans(snap(), enabled(), date());
	const daily = plans.filter((p) => p.kind === "daily");
	assert.equal(daily.length, 1);
	assert.equal(daily[0].trigger.type, "daily");
	assert.match(daily[0].body, /review your lens log/i);
	assert.doesNotMatch(daily[0].body, /missing|not logged|overworn|hour/i);
	const replacement = plans.filter((p) => p.kind === "replacement");
	assert.equal(replacement.length, 2);
	assert.deepEqual(
		replacement.map(
			(p) => p.trigger.type === "date" && deviceCalendarDate(p.trigger.date),
		),
		["2026-03-08", "2026-03-09"],
	);
});

test("replacement uses saved open/due dates, never missing IDs, unopened drafts or guessed intervals", () => {
	const snapshot = snap();
	const p = enabled();
	p.daily.enabled = p.prescription.enabled = false;
	snapshot.state!.eyes[0].id = null;
	snapshot.state!.eyes[1].openedOn = null;
	assert.equal(buildReminderPlans(snapshot, p, date()).length, 0);
	snapshot.state!.eyes[0].id = "saved";
	snapshot.state!.eyes[0].dueOn = null;
	assert.equal(buildReminderPlans(snapshot, p, date()).length, 0);
	for (const eye of snapshot.state!.eyes) {
		eye.id = "saved";
		eye.openedOn = "2025-01-01";
		eye.dueOn = "2025-01-15";
	}
	const plans = buildReminderPlans(snapshot, p, date());
	assert.equal(plans.length, 1);
	assert.match(plans[0].id, /overdue/);
	assert.equal(
		buildReminderPlans(snap(), p, date("2026-03-08T09:00:00")).length,
		1,
	);
});

test("Rx uses exact confirmed expiry, 30/7 calendar dates, bounded near fallback and no unknown/expired/draft alerts", () => {
	const snapshot = snap();
	const p = enabled();
	p.daily.enabled = p.replacement.enabled = false;
	const plans = buildReminderPlans(snapshot, p, date());
	assert.deepEqual(
		plans.map(
			(plan) =>
				plan.trigger.type === "date" && deviceCalendarDate(plan.trigger.date),
		),
		["2026-03-09", "2026-04-01"],
	);
	snapshot.prescription!.expiresOn = "2026-03-12";
	const near = buildReminderPlans(snapshot, p, date());
	assert.equal(near.length, 1);
	assert.equal(
		near[0].trigger.type === "date" && deviceCalendarDate(near[0].trigger.date),
		"2026-03-08",
	);
	snapshot.prescription!.expiresOn = "2026-03-09";
	assert.equal(
		buildReminderPlans(snapshot, p, date("2026-03-08T09:00:00")).length,
		0,
	);
	for (const expiresOn of [null, "2026-03-08", "2026-03-07", "2026-02-30"]) {
		snapshot.prescription!.expiresOn = expiresOn;
		assert.equal(buildReminderPlans(snapshot, p, date()).length, 0);
	}
	snapshot.prescription!.expiresOn = "2026-04-08";
	snapshot.prescription!.confirmedAt = "";
	assert.equal(buildReminderPlans(snapshot, p, date()).length, 0);
});

test("calendar plans retain literal days and local times across DST and extreme device zones", () => {
	const previous = process.env.TZ;
	try {
		for (const zone of [
			"America/New_York",
			"Europe/Berlin",
			"Pacific/Kiritimati",
			"Pacific/Honolulu",
		]) {
			process.env.TZ = zone;
			const plans = buildReminderPlans(snap(), enabled(), date());
			for (const plan of plans)
				if (plan.trigger.type === "date") {
					assert.equal(plan.trigger.date.getHours(), 9, zone);
					assert.ok(plan.trigger.date.getTime() > date().getTime());
				}
			assert.deepEqual(
				plans
					.filter((p) => p.kind === "replacement")
					.map(
						(p) =>
							p.trigger.type === "date" && deviceCalendarDate(p.trigger.date),
					),
				["2026-03-08", "2026-03-09"],
				zone,
			);
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("replacement day-after and next-eye due dates share a single timestamp", () => {
	const snapshot = snap();
	snapshot.state!.eyes[1].dueOn = "2026-03-09";
	const p = defaultPreferences();
	p.replacement.enabled = true;
	const plans = buildReminderPlans(snapshot, p, date());
	assert.equal(plans.length, 3);
	assert.deepEqual(
		plans.map(
			(plan) =>
				plan.trigger.type === "date" && deviceCalendarDate(plan.trigger.date),
		),
		["2026-03-08", "2026-03-09", "2026-03-10"],
	);
});

test("one-shots cross spring/fall DST by calendar day, not fixed 24-hour offsets", () => {
	const previous = process.env.TZ;
	try {
		process.env.TZ = "America/New_York";
		for (const [day, hours] of [
			["2026-03-07", 23],
			["2026-10-31", 25],
		] as const) {
			const snapshot = snap();
			snapshot.state!.eyes.forEach((eye) => {
				eye.openedOn = "2026-01-01";
				eye.dueOn = day;
			});
			const p = defaultPreferences();
			p.replacement.enabled = true;
			const plans = buildReminderPlans(
				snapshot,
				p,
				new Date(`${day}T08:00:00`),
			);
			const times = plans.map((plan) =>
				plan.trigger.type === "date" ? plan.trigger.date.getTime() : 0,
			);
			assert.equal((times[1] - times[0]) / 3600000, hours);
		}
		const snapshot = snap();
		const p = defaultPreferences();
		p.prescription.enabled = true;
		const deduplicated = buildReminderPlans(
			snapshot,
			p,
			date("2026-03-31T09:00:00"),
		);
		assert.equal(deduplicated.length, 1);
		assert.equal(
			deduplicated[0].trigger.type === "date" &&
				deviceCalendarDate(deduplicated[0].trigger.date),
			"2026-04-01",
		);
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("unreadable preferences reap only feature schedules and recover after storage is repaired", async () => {
	const h = harness();
	const corrupt = defaultPreferences();
	corrupt.daily.hour = 24;
	h.storage.set(hash("account-A"), { preferences: corrupt, receipts: [] });
	h.pending.set("stale", {
		identifier: "stale",
		data: { feature: FEATURE, ownerHash: hash("old") },
	});
	h.pending.set("other", {
		identifier: "other",
		data: { feature: "unrelated" },
	});
	h.manager.setSnapshot(snap());
	await h.manager.load();
	assert.ok(h.manager.getState().error);
	assert.equal(h.pending.size, 1);
	assert.equal(h.prompts(), 0);
	h.storage.set(hash("account-A"), {
		preferences: defaultPreferences(),
		receipts: [],
	});
	await h.manager.reconcile();
	assert.equal(h.manager.getState().error, null);
	assert.equal(h.manager.getState(), h.manager.getState());
});

test("startup never prompts; explicit enable persists account-local preferences and reconcile is idempotent", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	assert.equal(h.prompts(), 0);
	assert.equal(h.pending.size, 0);
	await h.manager.updatePreferences(enabled());
	assert.equal(h.prompts(), 1);
	const count = h.pending.size;
	assert.ok(count > 0 && count < 10);
	await h.manager.reconcile();
	await h.manager.reconcile();
	assert.equal(h.pending.size, count);
	assert.equal(h.scheduled.length, count);
	assert.equal(h.manager.getState().scheduledCount, count);
	for (const item of h.scheduled) {
		assert.equal(item.data.feature, FEATURE);
		assert.equal(item.data.ownerHash, hash("account-A"));
		assert.match(String(item.data.planId), /^[a-f0-9]{64}$/);
		assert.doesNotMatch(
			JSON.stringify(item.data),
			/token-A|account-A|2026|sphere|expiry/,
		);
	}
	h.manager.setSnapshot(off);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.ok(h.storage.has(hash("account-A")));
	h.manager.setSnapshot(snap());
	await h.manager.load();
	assert.equal(h.manager.getState().preferences.daily.enabled, true);
	assert.equal(h.prompts(), 1);
});

test("denied permissions and failed scheduling/storage are honest and retryable", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	h.setPermission("denied");
	await h.manager.updatePreferences(enabled());
	assert.equal(h.manager.getState().permission, "denied");
	assert.equal(h.manager.getState().scheduledCount, 0);
	assert.match(h.manager.getState().notice!, /disabled/);
	assert.equal(h.manager.getState().preferences.prescription.enabled, true);
	h.setPermission("granted");
	h.failSchedule(true);
	await h.manager.reconcile();
	assert.ok(h.manager.getState().error);
	assert.equal(h.manager.getState().scheduledCount, 0);
	h.failSchedule(false);
	await h.manager.reconcile();
	assert.equal(h.manager.getState().error, null);
	assert.ok(h.pending.size > 0);
	h.failSave(true);
	const p = defaultPreferences();
	await h.manager.updatePreferences(p);
	assert.ok(h.manager.getState().error);
	assert.equal(h.manager.getState().preferences.daily.enabled, true);
	h.failSave(false);
	await h.manager.updatePreferences(p);
	assert.equal(h.pending.size, 0);
});

test("startup orphans and sign-out cancel only tagged feature requests; cancellation errors retry", async () => {
	const h = harness();
	h.pending.set("unrelated", {
		identifier: "unrelated",
		data: { feature: "other" },
	});
	h.pending.set("orphan", {
		identifier: "orphan",
		data: { feature: FEATURE, ownerHash: hash("old") },
	});
	h.failCancel(true);
	await h.manager.load();
	assert.ok(h.manager.getState().error);
	assert.equal(h.manager.getState().scheduledCount, 0);
	h.failCancel(false);
	await h.manager.reconcile();
	assert.equal(h.pending.has("orphan"), false);
	assert.equal(h.pending.has("unrelated"), true);
	h.manager.setSnapshot(snap());
	await h.manager.load();
	await h.manager.updatePreferences(enabled());
	h.failCancel(true);
	h.manager.setSnapshot(off);
	await h.manager.reconcile();
	assert.ok(h.manager.getState().error);
	h.failCancel(false);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 1);
	assert.equal(h.pending.has("unrelated"), true);
});

test("snapshot deletion removes corresponding requests; delivered overdue and near-expiry receipts prevent storms", async () => {
	const h = harness();
	const snapshot = snap();
	snapshot.state!.eyes.forEach((eye) => {
		eye.dueOn = "2026-01-01";
	});
	snapshot.prescription!.expiresOn = "2026-03-12";
	h.manager.setSnapshot(snapshot);
	await h.manager.load();
	const p = enabled();
	p.daily.enabled = false;
	await h.manager.updatePreferences(p);
	assert.equal(h.pending.size, 2);
	h.pending.clear();
	h.setNow(date("2026-03-09T08:00:00"));
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.equal(h.scheduled.length, 2);
	snapshot.prescription = null;
	snapshot.state!.eyes = [];
	h.manager.setSnapshot(snapshot);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
});

test("identical refresh during explicit permission preserves choice and initialized cache", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	let loads = 0;
	const load = h.deps.storage.load;
	h.deps.storage.load = async (key) => {
		loads++;
		return load(key);
	};
	const gate = h.block("permission-request");
	const p = defaultPreferences();
	p.daily.enabled = true;
	const action = h.manager.updatePreferences(p);
	await gate.entered;
	h.manager.setSnapshot(snap());
	gate.release();
	await action;
	await h.manager.reconcile();
	assert.equal(h.manager.getState().preferences.daily.enabled, true);
	assert.equal(
		h.storage.get(hash("account-A"))?.preferences.daily.enabled,
		true,
	);
	assert.equal(h.manager.getState().error, null);
	assert.equal(h.pending.size, 1);
	assert.equal(loads, 0);
});

test("Rx and lens refresh during permission uses latest data without losing explicit opt-in", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	const gate = h.block("permission-request");
	const action = h.manager.updatePreferences(enabled());
	await gate.entered;
	const latest = snap();
	latest.prescription!.expiresOn = "2026-05-08";
	latest.state!.eyes.forEach((eye) => {
		eye.dueOn = "2026-03-15";
	});
	h.manager.setSnapshot(latest);
	gate.release();
	await action;
	await h.manager.reconcile();
	const expected = buildReminderPlans(latest, enabled(), date()).map((plan) =>
		hash(`${FEATURE}:${plan.id}`),
	);
	assert.deepEqual(
		[...h.pending.values()].map((request) => request.data.planId).sort(),
		expected.sort(),
	);
	assert.deepEqual(h.storage.get(hash("account-A"))?.preferences, enabled());
	assert.equal(h.prompts(), 1);
	assert.equal(h.manager.getState().error, null);
});

for (const point of ["schedule-after", "save"] as const) {
	test(`data revision during ${point} cancels obsolete IDs, repairs receipts and retains committed preferences`, async () => {
		const h = harness();
		h.manager.setSnapshot(snap());
		await h.manager.load();
		const p = defaultPreferences();
		p.replacement.enabled = p.prescription.enabled = true;
		// Preference commit and receipt pruning precede the first one-shot receipt.
		const gate = h.block(point, point === "save" ? 2 : 0);
		const action = h.manager.updatePreferences(p);
		await gate.entered;
		const obsolete = h.scheduled[0].id;
		const latest = snap();
		latest.prescription!.expiresOn = "2026-05-08";
		latest.state!.eyes.forEach((eye) => {
			eye.dueOn = "2026-03-15";
		});
		h.manager.setSnapshot(latest);
		gate.release();
		await action;
		await h.manager.reconcile();
		assert.ok(h.cancelled.includes(obsolete));
		assert.equal(h.pending.has(obsolete), false);
		const expected = buildReminderPlans(latest, p, date()).map((plan) =>
			hash(`${FEATURE}:${plan.id}`),
		);
		assert.deepEqual(
			[...h.pending.values()].map((request) => request.data.planId).sort(),
			expected.sort(),
		);
		assert.deepEqual(h.storage.get(hash("account-A"))?.preferences, p);
		assert.equal(h.manager.getState().error, null);
		const count = h.scheduled.length;
		await h.manager.reconcile();
		assert.equal(h.scheduled.length, count);
		assert.equal(h.manager.getState().busy, false);
	});
}

for (const point of [
	"scheduled",
	"hash",
	"load",
	"permission-read",
	"permission-request",
	"save",
	"schedule-before",
	"schedule-after",
]) {
	for (const change of ["owner", "token"] as const) {
		test(`fences ${change} changes during ${point}`, async () => {
			const h = harness();
			h.manager.setSnapshot(snap());
			await h.manager.load();
			// Hashing now occurs for plan identities, not on every data refresh.
			if (point === "hash") await h.manager.updatePreferences(enabled());
			const gate = h.block(point);
			const explicitUpdate =
				point === "permission-request" ||
				point === "save" ||
				point.startsWith("schedule");
			if (!explicitUpdate)
				h.manager.setSnapshot(
					point === "load" ? snap("account-A", "loading-token") : snap(),
				);
			const action = explicitUpdate
				? h.manager.updatePreferences(enabled())
				: h.manager.reconcile();
			await gate.entered;
			h.manager.setSnapshot(
				change === "owner"
					? snap("account-B", "token-B")
					: snap("account-A", "new-token"),
			);
			gate.release();
			await action;
			await h.manager.reconcile();
			for (const request of h.pending.values())
				assert.equal(
					request.data.ownerHash,
					hash(change === "owner" ? "account-B" : "account-A"),
				);
			if (change === "owner") {
				assert.equal(h.pending.size, 0);
				assert.equal(h.manager.getState().preferences.daily.enabled, false);
			}
			if (point === "permission-request") {
				assert.equal(h.manager.getState().preferences.daily.enabled, false);
				assert.equal(
					h.storage.get(hash("account-A"))?.preferences.daily.enabled,
					false,
				);
			}
			assert.equal(h.manager.getState().busy, false);
		});
	}
}

test("change during persisted one-shot schedule cancels stale ID and repairs receipt", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	const p = defaultPreferences();
	p.replacement.enabled = true;
	// Enable first without saved eyes, then a snapshot introduces one-shots.
	const empty = snap();
	empty.state!.eyes = [];
	h.manager.setSnapshot(empty);
	await h.manager.load();
	await h.manager.updatePreferences(p);
	h.manager.setSnapshot(snap());
	const gate = h.block("schedule-after");
	const action = h.manager.reconcile();
	await gate.entered;
	h.manager.setSnapshot(snap("account-B", "token-B"));
	gate.release();
	await action;
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.ok(h.cancelled.length > 0);
	h.manager.setSnapshot(snap());
	await h.manager.reconcile();
	assert.equal(h.pending.size, 2);
});

for (const change of ["owner", "token"] as const) {
	test(`change during one-shot receipt persistence repairs cancelled receipts (${change})`, async () => {
		const h = harness();
		const empty = snap();
		empty.state!.eyes = [];
		h.manager.setSnapshot(empty);
		await h.manager.load();
		const p = defaultPreferences();
		p.replacement.enabled = true;
		await h.manager.updatePreferences(p);
		const gate = h.block("save", 1); // prune first, then persist the newly scheduled one-shot
		h.manager.setSnapshot(snap());
		const action = h.manager.reconcile();
		await gate.entered;
		h.manager.setSnapshot(
			change === "owner"
				? snap("account-B", "token-B")
				: snap("account-A", "fresh-token"),
		);
		gate.release();
		await action;
		await h.manager.reconcile();
		assert.ok(h.cancelled.length > 0);
		assert.equal(h.pending.size, change === "owner" ? 0 : 2);
		if (change === "owner") {
			h.manager.setSnapshot(snap());
			await h.manager.reconcile();
			assert.equal(h.pending.size, 2);
		}
	});
}

test("cancellation awaits are fenced across account change and sign-out", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	await h.manager.updatePreferences(enabled());
	const gate = h.block("cancel");
	h.manager.setSnapshot(snap("account-B", "token-B"));
	const action = h.manager.reconcile();
	await gate.entered;
	h.manager.setSnapshot(off);
	gate.release();
	await action;
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
});

test("delivered receipts survive manager restart without duplicate overdue scheduling", async () => {
	const h = harness();
	const snapshot = snap();
	snapshot.state!.eyes.forEach((eye) => {
		eye.dueOn = "2026-01-01";
	});
	h.manager.setSnapshot(snapshot);
	await h.manager.load();
	const p = defaultPreferences();
	p.replacement.enabled = true;
	await h.manager.updatePreferences(p);
	assert.equal(h.pending.size, 1);
	h.pending.clear();
	h.manager.dispose();
	const restarted = createReminderManager(h.deps);
	restarted.setSnapshot(snapshot);
	await restarted.load();
	assert.equal(h.pending.size, 0);
	assert.equal(h.scheduled.length, 1);
});

test("one-shot receipt persistence failure cancels its request and retry does not duplicate", async () => {
	const h = harness();
	const empty = snap();
	empty.state!.eyes = [];
	h.manager.setSnapshot(empty);
	await h.manager.load();
	const p = defaultPreferences();
	p.replacement.enabled = true;
	await h.manager.updatePreferences(p);
	const gate = h.block("schedule-after");
	h.manager.setSnapshot(snap());
	const action = h.manager.reconcile();
	await gate.entered;
	h.failSave(true);
	gate.release();
	await action;
	assert.ok(h.manager.getState().error);
	assert.equal(h.manager.getState().scheduledCount, 0);
	assert.equal(h.pending.size, 0);
	h.failSave(false);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 2);
	assert.equal(h.manager.getState().error, null);
});

test("stale schedule cancellation failures remain visible and can be retried", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	const gate = h.block("schedule-after");
	const action = h.manager.updatePreferences(enabled());
	await gate.entered;
	h.failCancel(true);
	h.manager.setSnapshot(off);
	gate.release();
	await action;
	await h.manager.reconcile();
	assert.ok(h.manager.getState().error);
	assert.equal(h.manager.getState().scheduledCount, 0);
	assert.ok(h.pending.size > 0);
	h.failCancel(false);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.equal(h.manager.getState().error, null);
});

test("Rx null-before-load cancels pending requests and restores them without repeating delivered catch-up", async () => {
	const h = harness();
	const snapshot = snap();
	snapshot.prescription!.expiresOn = "2026-03-12";
	h.manager.setSnapshot(snapshot);
	await h.manager.load();
	const p = defaultPreferences();
	p.prescription.enabled = true;
	await h.manager.updatePreferences(p);
	assert.equal(h.pending.size, 1);
	const clearing = { ...snapshot, prescription: null };
	h.manager.setSnapshot(clearing);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	h.manager.setSnapshot(snapshot);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 1);
	h.pending.clear(); // delivered
	h.manager.setSnapshot(clearing);
	await h.manager.reconcile();
	h.manager.setSnapshot(snapshot);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.equal(h.scheduled.length, 2);
});

test("a previously planned 30-day Rx reminder never turns into an extra near-expiry catch-up", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	const p = defaultPreferences();
	p.prescription.enabled = true;
	await h.manager.updatePreferences(p);
	assert.equal(h.pending.size, 2);
	const thirty = h.scheduled.find(
		(item) =>
			item.plan.trigger.type === "date" &&
			deviceCalendarDate(item.plan.trigger.date) === "2026-03-09",
	)!;
	h.pending.delete(thirty.id);
	h.setNow(date("2026-03-10T08:00:00"));
	await h.manager.reconcile();
	assert.equal(h.pending.size, 1);
	assert.equal(h.scheduled.length, 2);
	h.setNow(date("2026-03-31T09:00:00"));
	await h.manager.reconcile();
	assert.equal(h.scheduled.length, 2);
	h.pending.clear();
	h.setNow(date("2026-04-02T08:00:00"));
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.equal(h.scheduled.length, 2);
});

test("normal due/day-after delivery does not create a third overdue reminder", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	const p = defaultPreferences();
	p.replacement.enabled = true;
	await h.manager.updatePreferences(p);
	assert.equal(h.pending.size, 2);
	const due = h.scheduled.find(
		(item) =>
			item.plan.trigger.type === "date" &&
			deviceCalendarDate(item.plan.trigger.date) === "2026-03-08",
	)!;
	h.pending.delete(due.id);
	h.setNow(date("2026-03-09T08:00:00"));
	await h.manager.reconcile();
	assert.equal(h.pending.size, 1);
	assert.equal(h.scheduled.length, 2);
	h.pending.clear();
	h.setNow(date("2026-03-10T08:00:00"));
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
	assert.equal(h.scheduled.length, 2);
});

test("sign-out and reauthentication restore cancelled pending one-shots, not delivered catch-ups", async () => {
	const h = harness();
	const snapshot = snap();
	snapshot.prescription!.expiresOn = "2026-03-12";
	h.manager.setSnapshot(snapshot);
	await h.manager.load();
	const p = defaultPreferences();
	p.prescription.enabled = true;
	await h.manager.updatePreferences(p);
	h.manager.setSnapshot(off);
	await h.manager.reconcile();
	h.manager.setSnapshot(snapshot);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 1);
	h.pending.clear();
	h.manager.setSnapshot(off);
	await h.manager.reconcile();
	h.manager.setSnapshot(snapshot);
	await h.manager.reconcile();
	assert.equal(h.pending.size, 0);
});

test("64-request device budget fails explicitly without silently truncating plans", async () => {
	const h = harness();
	for (let i = 0; i < 64; i++)
		h.pending.set(`other-${i}`, {
			identifier: `other-${i}`,
			data: { feature: "other" },
		});
	h.manager.setSnapshot(snap());
	await h.manager.load();
	await h.manager.updatePreferences(enabled());
	assert.ok(h.manager.getState().error);
	assert.equal(h.pending.size, 64);
	assert.equal(h.scheduled.length, 0);
});

test("foreground and taps require current cached owner/feature/kind, with no I/O", async () => {
	const h = harness();
	h.manager.setSnapshot(snap());
	await h.manager.load();
	await h.manager.updatePreferences(enabled());
	const data = h.scheduled.find(
		(item) => item.plan.kind === "prescription",
	)!.data;
	assert.equal(h.manager.shouldPresentNotification(data), true);
	assert.equal(await h.manager.routeForNotification(data), "/prescriptions");
	assert.equal(
		h.manager.shouldPresentNotification({ ...data, feature: "other" }),
		false,
	);
	assert.equal(
		h.manager.shouldPresentNotification({ ...data, kind: "unknown" }),
		false,
	);
	assert.equal(
		await h.manager.routeForNotification({
			...data,
			ownerHash: hash("someone-else"),
		}),
		null,
	);
	const route = h.manager.routeForNotification(data);
	h.manager.setSnapshot(off);
	assert.equal(await route, null);
	assert.equal(h.manager.shouldPresentNotification(data), false);
	await h.manager.reconcile();
});
