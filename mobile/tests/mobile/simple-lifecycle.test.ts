import assert from "node:assert/strict";
import { test } from "node:test";
import type { SimpleState } from "../../shared/simple-domain";
import {
	type ActionSession,
	reportActionFailure,
} from "../../src/lib/action-guard";
import {
	type Commands,
	calendarDate,
	SimpleController,
} from "../../src/lib/simple-controller";

const zone = "America/New_York";
function state(today: string): SimpleState {
	return {
		today,
		timeZone: zone,
		eyes: ["left", "right"].map((eye) => ({
			id: null,
			eye: eye as "left" | "right",
			replacementDays: null,
			openedOn: null,
			dueOn: null,
			spareCount: 0,
			daysRemaining: null,
		})),
		daily: { localDate: today, worn: null },
	};
}
function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
test("calendar checker uses account timezone through spring and fall DST, not elapsed 24 hours", () => {
	for (const [timestamp, expected] of [
		["2026-03-08T04:59:59Z", "2026-03-07"],
		["2026-03-08T05:00:00Z", "2026-03-08"],
		["2026-03-09T03:59:59Z", "2026-03-08"],
		["2026-03-09T04:00:00Z", "2026-03-09"],
		["2026-11-01T04:00:00Z", "2026-11-01"],
		["2026-11-01T05:30:00Z", "2026-11-01"],
		["2026-11-01T06:30:00Z", "2026-11-01"],
		["2026-11-02T04:59:59Z", "2026-11-01"],
		["2026-11-02T05:00:00Z", "2026-11-02"],
	])
		assert.equal(calendarDate(zone, new Date(timestamp)), expected);
});
test("foreground rollover reads only on local day changes; paused checks do no work", async () => {
	let now = new Date("2026-03-08T05:00:00Z"),
		reads = 0;
	const controller = new SimpleController(
		{
			state: async () => {
				reads++;
				return state(calendarDate(zone, now));
			},
			post: async () => state(calendarDate(zone, now)),
		},
		String,
		() => now,
	);
	controller.account("A");
	await controller.reload();
	now = new Date("2026-03-09T03:59:59Z");
	await controller.checkDay(true);
	assert.equal(reads, 1);
	now = new Date("2026-03-09T04:00:00Z");
	await controller.checkDay(false);
	assert.equal(reads, 1);
	await controller.checkDay(true);
	assert.equal(reads, 2);
	assert.equal(controller.snapshot.state?.today, "2026-03-09");
	await controller.checkDay(true);
	assert.equal(reads, 2);
	controller.account(null);
	await controller.checkDay(true);
	assert.equal(reads, 2);
});
test("rollover skips pending writes and loading reads, then checks after the write finishes", async () => {
	let now = new Date("2026-11-01T04:00:00Z"),
		reads = 0;
	const write = deferred<SimpleState>(),
		read = deferred<SimpleState>();
	const controller = new SimpleController(
		{
			state: () => {
				reads++;
				return reads === 1
					? Promise.resolve(state("2026-11-01"))
					: read.promise;
			},
			post: () => write.promise,
		},
		String,
		() => now,
	);
	controller.account("A");
	await controller.reload();
	const pending = controller.mutate("replace", { eye: "left" });
	now = new Date("2026-11-02T05:00:00Z");
	await controller.checkDay(true);
	assert.equal(reads, 1);
	write.resolve(state("2026-11-01"));
	await pending;
	const rollover = controller.checkDay(true);
	await controller.checkDay(true);
	assert.equal(reads, 2);
	read.resolve(state("2026-11-02"));
	await rollover;
	assert.equal(controller.snapshot.state?.today, "2026-11-02");
});
test("failed rollover goes offline without automatic retry loops; manual retry restores it", async () => {
	let now = new Date("2026-06-08T12:00:00Z"),
		reads = 0,
		fail = false;
	const controller = new SimpleController(
		{
			state: async () => {
				reads++;
				if (fail) throw { status: 0 };
				return state(calendarDate(zone, now));
			},
			post: async () => state("2026-06-08"),
		},
		String,
		() => now,
	);
	controller.account("A");
	await controller.reload();
	now = new Date("2026-06-09T12:00:00Z");
	fail = true;
	await controller.checkDay(true);
	assert.equal(controller.snapshot.online, false);
	assert.equal(reads, 2);
	for (let i = 0; i < 5; i++) await controller.checkDay(true);
	assert.equal(reads, 2);
	fail = false;
	await controller.reload();
	assert.equal(controller.snapshot.state?.today, "2026-06-09");
	assert.equal(controller.snapshot.online, true);
});
test("rollover read from old account cannot publish after account change", async () => {
	let now = new Date("2026-06-08T12:00:00Z"),
		reads = 0;
	const late = deferred<SimpleState>();
	const controller = new SimpleController(
		{
			state: () =>
				++reads === 1 ? Promise.resolve(state("2026-06-08")) : late.promise,
			post: async () => state("2026-06-08"),
		},
		String,
		() => now,
	);
	controller.account("A");
	await controller.reload();
	now = new Date("2026-06-09T12:00:00Z");
	const polling = controller.checkDay(true);
	controller.account("B");
	late.resolve(state("2026-06-09"));
	await polling;
	assert.equal(controller.snapshot.state, null);
	assert.equal(controller.snapshot.online, false);
});
test("daily write in polling gap refreshes and posts server today, never stale caller date", async () => {
	let now = new Date("2026-03-09T03:59:59Z"),
		reads = 0;
	const posts: Commands["day"][] = [];
	const controller = new SimpleController(
		{
			state: async () => {
				reads++;
				return state(calendarDate(zone, now));
			},
			post: async (route, body) => {
				assert.equal(route, "day");
				posts.push(body as Commands["day"]);
				return {
					...state(calendarDate(zone, now)),
					daily: { localDate: calendarDate(zone, now), worn: false },
				};
			},
		},
		String,
		() => now,
	);
	controller.account("A");
	await controller.reload();
	now = new Date("2026-03-09T04:00:00Z");
	await controller.mutate("day", { localDate: "2026-03-08", worn: false });
	assert.equal(reads, 2);
	assert.deepEqual(posts, [{ localDate: "2026-03-09", worn: false }]);
	assert.equal(controller.snapshot.state?.daily.worn, false);
});
test("daily preflight never writes after failed refresh or after switching accounts", async () => {
	for (const changeAccount of [false, true]) {
		let now = new Date("2026-06-08T12:00:00Z"),
			reads = 0,
			posts = 0;
		const late = deferred<SimpleState>();
		const controller = new SimpleController(
			{
				state: async () => {
					if (++reads === 1) return state("2026-06-08");
					if (!changeAccount) throw { status: 0 };
					return late.promise;
				},
				post: async () => {
					posts++;
					return state("2026-06-09");
				},
			},
			String,
			() => now,
		);
		controller.account("A");
		await controller.reload();
		now = new Date("2026-06-09T12:00:00Z");
		const action = controller.mutate("day", {
			localDate: "2026-06-08",
			worn: true,
		});
		if (changeAccount) {
			controller.account("B");
			late.resolve(state("2026-06-09"));
			assert.equal(await action, false);
		} else {
			await assert.rejects(action);
			assert.equal(controller.snapshot.online, false);
		}
		assert.equal(posts, 0);
	}
});
test("delayed A status-0 action cannot mark B offline or show A errors", async () => {
	let current: ActionSession = { owner: "A", token: "A-token" },
		offline = 0,
		errors = 0;
	const requested = { ...current },
		late = deferred<unknown>();
	const action = late.promise
		.then(() => {
			throw { status: 0 };
		})
		.catch((error) =>
			reportActionFailure(
				error,
				requested,
				current,
				() => offline++,
				() => errors++,
			),
		);
	current = { owner: "B", token: "B-token" };
	late.resolve(null);
	assert.equal(await action, false);
	assert.equal(offline, 0);
	assert.equal(errors, 0);
	assert.equal(
		reportActionFailure(
			{ status: 0 },
			{ owner: "B", token: "old-B-token" },
			current,
			() => offline++,
			() => errors++,
		),
		false,
	);
	assert.equal(offline, 0);
});
test("current action network failures and unauthenticated restoring failures remain visible", () => {
	for (const current of [
		{ owner: "A", token: "A-token" },
		{ owner: undefined, token: "" },
	]) {
		let offline = 0,
			errors = 0;
		assert.equal(
			reportActionFailure(
				{ status: 0 },
				{ ...current },
				current,
				() => offline++,
				() => errors++,
			),
			true,
		);
		assert.equal(offline, 1);
		assert.equal(errors, 1);
		reportActionFailure(
			{ status: 400 },
			{ ...current },
			current,
			() => offline++,
			() => errors++,
		);
		assert.equal(offline, 1);
		assert.equal(errors, 2);
	}
});
