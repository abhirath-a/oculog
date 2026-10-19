import assert from "node:assert/strict";
import { test } from "node:test";
import type { SimpleState } from "../../shared/simple-domain";
import {
	positiveInteger,
	remainingLabel,
	SimpleController,
	type SimpleTransport,
} from "../../src/lib/simple-controller";
import { createSimpleTransport } from "../../src/lib/simple-transport";

const state = (spareCount = 2): SimpleState => ({
	today: "2026-06-08",
	timeZone: "UTC",
	eyes: [
		{
			id: "left",
			eye: "left",
			replacementDays: 14,
			openedOn: "2026-06-01",
			dueOn: "2026-06-15",
			spareCount,
			daysRemaining: 7,
		},
		{
			id: "right",
			eye: "right",
			replacementDays: 14,
			openedOn: null,
			dueOn: null,
			spareCount: 0,
			daysRemaining: null,
		},
	],
	daily: { localDate: "2026-06-08", worn: null },
});
function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
test("home labels use calendar days only, with unknown distinct from No", () => {
	assert.equal(remainingLabel(7), "7 days left");
	assert.equal(remainingLabel(0), "Replace today");
	assert.equal(remainingLabel(-2), "2 days overdue");
	assert.equal(remainingLabel(null), "Not wearing lenses");
	assert.equal(state().daily.worn, null);
	assert.equal(positiveInteger("3"), 3);
	assert.throws(() => positiveInteger("1.5"));
	assert.throws(() => positiveInteger("0"));
});
test("new-account null schedules and zero spares stay unconfigured, without invented dates", async () => {
	const empty: SimpleState = {
		today: "2026-06-08",
		timeZone: "UTC",
		eyes: ["left", "right"].map((eye) => ({
			id: null,
			eye: eye as "left" | "right",
			replacementDays: null,
			openedOn: null,
			dueOn: null,
			spareCount: 0,
			daysRemaining: null,
		})),
		daily: { localDate: "2026-06-08", worn: null },
	};
	const controller = new SimpleController(
		{ state: async () => empty, post: async () => empty },
		String,
	);
	controller.account("new");
	await controller.reload();
	assert.deepEqual(controller.snapshot.state, empty);
	assert.ok(
		controller.snapshot.state?.eyes.every(
			(e) =>
				e.replacementDays === null && e.openedOn === null && e.spareCount === 0,
		),
	);
});
test("actual controller replaces authoritative stock and daily log, never predicts locally", async () => {
	const next = state(1);
	next.daily.worn = false;
	const controller = new SimpleController(
		{ state: async () => state(), post: async () => next },
		String,
	);
	controller.account("A");
	await controller.reload();
	assert.equal(controller.snapshot.state?.eyes[0].spareCount, 2);
	await controller.mutate("replace", { eye: "left" });
	assert.equal(controller.snapshot.state, next);
	assert.equal(controller.snapshot.state?.eyes[0].spareCount, 1);
	assert.equal(controller.snapshot.state?.daily.worn, false);
});
test("pending writes lock duplicate intents and reads; account change drops late mutation", async () => {
	const write = deferred<SimpleState>();
	let reads = 0;
	const controller = new SimpleController(
		{
			state: async () => {
				reads++;
				return state();
			},
			post: () => write.promise,
		},
		String,
	);
	controller.account("A");
	await controller.reload();
	const pending = controller.mutate("add", { eye: "left", quantity: 1 });
	assert.equal(controller.snapshot.pending, true);
	await assert.rejects(controller.mutate("replace", { eye: "left" }));
	await controller.reload();
	assert.equal(reads, 1);
	controller.account("B");
	write.resolve(state(9));
	assert.equal(await pending, false);
	assert.equal(controller.snapshot.state, null);
	assert.equal(controller.snapshot.pending, false);
});
test("latest load wins and logout invalidates delayed reads", async () => {
	const first = deferred<SimpleState>(),
		second = deferred<SimpleState>();
	let calls = 0;
	const controller = new SimpleController(
		{
			state: () => (++calls === 1 ? first.promise : second.promise),
			post: async () => state(),
		},
		String,
	);
	controller.account("A");
	const a = controller.reload(),
		b = controller.reload();
	second.resolve(state(8));
	await b;
	first.resolve(state(99));
	await a;
	assert.equal(controller.snapshot.state?.eyes[0].spareCount, 8);
	const c = controller.reload();
	controller.account(null);
	await c;
	assert.equal(controller.snapshot.state, null);
});
test("same-account reauthentication invalidates old reads without losing the last display", async () => {
	const wait = deferred<SimpleState>();
	let late = false;
	const controller = new SimpleController(
		{
			state: () => (late ? wait.promise : Promise.resolve(state())),
			post: async () => state(),
		},
		String,
	);
	controller.account("A");
	await controller.reload();
	late = true;
	const request = controller.reload();
	controller.session("A");
	wait.resolve(state(99));
	await request;
	assert.equal(controller.snapshot.state?.eyes[0].spareCount, 2);
	assert.equal(controller.snapshot.online, false);
	assert.equal(controller.snapshot.loading, false);
});
test("network failure retains display but disallows writes until retry; no queue", async () => {
	let fail = false,
		posts = 0;
	const transport: SimpleTransport = {
		state: async () => {
			if (fail) throw new Error("network");
			return state();
		},
		post: async () => {
			posts++;
			throw new Error("network");
		},
	};
	const controller = new SimpleController(
		transport,
		String,
		() => new Date("2026-06-08T12:00:00Z"),
	);
	controller.account("A");
	await controller.reload();
	await assert.rejects(
		controller.mutate("day", { localDate: "2026-06-08", worn: true }),
	);
	assert.equal(controller.snapshot.online, false);
	assert.equal(controller.snapshot.pending, false);
	assert.ok(controller.snapshot.error.includes("network"));
	assert.equal(controller.snapshot.state?.daily.worn, null);
	await assert.rejects(controller.mutate("add", { eye: "left", quantity: 1 }));
	assert.equal(posts, 1);
	fail = true;
	await controller.reload();
	assert.equal(controller.snapshot.online, false);
	fail = false;
	await controller.reload();
	assert.equal(controller.snapshot.online, true);
});
test("actual adapter uses contract paths, auth, and stable idempotency for uncertain retry", async () => {
	const requests: { path: string; options: Record<string, unknown> }[] = [];
	let uncertain = true,
		key = 0,
		owner = "A";
	const rejected: unknown[][] = [];
	const api = createSimpleTransport(
		async <T>(path: string, options: Record<string, unknown>) => {
			requests.push({ path, options });
			if (uncertain) throw { status: 0 };
			return state() as T;
		},
		() => ({ owner, token: `${owner}token` }),
		() => String(++key),
		async (...args) => {
			rejected.push(args);
		},
	);
	await assert.rejects(api.post("add", { eye: "left", quantity: 2 }));
	uncertain = false;
	await api.state();
	await api.post("add", { eye: "left", quantity: 2 });
	assert.equal(requests[0].path, "/api/oculog/v1/simple/add");
	assert.equal(requests[1].path, "/api/oculog/v1/simple/state");
	assert.equal(requests[0].options.method, "POST");
	assert.deepEqual(requests[0].options.body, { eye: "left", quantity: 2 });
	assert.deepEqual(requests[0].options.headers, {
		"Idempotency-Key": "1",
		Authorization: "Bearer Atoken",
	});
	assert.deepEqual(requests[2].options.headers, requests[0].options.headers);
	owner = "B";
	await api.post("add", { eye: "left", quantity: 2 });
	assert.deepEqual(requests[3].options.headers, {
		"Idempotency-Key": "2",
		Authorization: "Bearer Btoken",
	});
	assert.deepEqual(rejected, [[0, "Atoken", "A"]]);
});
test("adapter forwards 401 and 403 with requesting account, for session-safe rejection", async () => {
	for (const status of [401, 403]) {
		let args: unknown[] = [];
		const api = createSimpleTransport(
			async () => {
				throw { status };
			},
			() => ({ owner: "A", token: "old" }),
			() => "key",
			async (...values) => {
				args = values;
			},
		);
		await assert.rejects(api.state());
		assert.deepEqual(args, [status, "old", "A"]);
	}
});

test("retry ledger survives network/5xx and session refreshes, but clears definite 4xx rejections", async () => {
	for (const status of [0, 500, 503, 400, 409, 422]) {
		const keys: unknown[] = [];
		let failing = true;
		let token = "initial";
		let next = 0;
		const api = createSimpleTransport(
			async <T>(_path: string, options: Record<string, unknown>) => {
				keys.push(
					(options.headers as Record<string, unknown>)["Idempotency-Key"],
				);
				if (failing) throw { status };
				return state() as T;
			},
			() => ({ owner: "same-account", token }),
			() => String(++next),
			async () => {},
		);
		await assert.rejects(api.post("add", { eye: "left", quantity: 2 }));
		failing = false;
		token = "refreshed-session";
		await api.post("add", { eye: "left", quantity: 2 });
		assert.equal(
			keys[1],
			status >= 400 && status < 500 ? "2" : "1",
			`status ${status}`,
		);
		await api.post("add", { eye: "left", quantity: 2 });
		assert.notEqual(keys[2], keys[1], "success completes the intent");
	}
});
