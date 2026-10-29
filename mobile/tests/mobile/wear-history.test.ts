import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as controllers from "../../src/lib/wear-history/controller";
import {
	createWearHistoryController,
	type WearHistorySession,
	type WearHistoryTransport,
} from "../../src/lib/wear-history/controller";
import * as model from "../../src/lib/wear-history/model";
import {
	type AutomationPreferences,
	type DayResult,
	monthDates,
	parseAutomationPreferences,
	parseDayResult,
	parseWearHistory,
	shiftMonth,
	validDate,
	validMonth,
	type WearHistory,
	weekdayMonday,
} from "../../src/lib/wear-history/model";

const off = (): AutomationPreferences => ({
	version: 1,
	enabled: false,
	weekdays: [],
	startsOn: null,
});
function history(month = "2026-06", today = "2026-06-18"): WearHistory {
	return {
		version: 1,
		month,
		today,
		timeZone: "America/New_York",
		days: monthDates(month).map((localDate) => ({
			localDate,
			worn: null,
			source: "unknown",
		})),
		automation: off(),
	};
}
const dayResult = (
	localDate = "2026-06-01",
	worn: boolean | null = true,
): DayResult => ({
	version: 1,
	day: { localDate, worn, source: worn === null ? "unknown" : "manual" },
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
async function flush() {
	await Promise.resolve();
	await Promise.resolve();
}
function harness() {
	let session: WearHistorySession = { owner: "a", token: "token-a" };
	const reads: {
		month: string;
		result: ReturnType<typeof deferred<WearHistory>>;
	}[] = [];
	const writes: {
		body: { localDate: string; worn: boolean | null };
		result: ReturnType<typeof deferred<DayResult>>;
	}[] = [];
	const automations: {
		body: { enabled: boolean; weekdays: number[] };
		result: ReturnType<typeof deferred<AutomationPreferences>>;
	}[] = [];
	const transport: WearHistoryTransport = {
		history(month) {
			const result = deferred<WearHistory>();
			reads.push({ month, result });
			return result.promise;
		},
		day(body) {
			const result = deferred<DayResult>();
			writes.push({ body, result });
			return result.promise;
		},
		automation(body) {
			const result = deferred<AutomationPreferences>();
			automations.push({ body, result });
			return result.promise;
		},
	};
	const controller = createWearHistoryController(
		transport,
		() => session,
		"2026-06",
	);
	return {
		controller,
		reads,
		writes,
		automations,
		setSession(next: WearHistorySession) {
			session = next;
		},
	};
}
async function ready() {
	const h = harness();
	const mounted = h.controller.mount();
	h.reads[0].result.resolve(history());
	await mounted;
	return h;
}

test("literal Gregorian month math covers leap centuries, ancient years, bounds and DST", () => {
	for (const value of ["0001-01", "0099-12", "2024-02", "9999-12"])
		assert.equal(validMonth(value), true);
	for (const value of [
		"0000-01",
		"2026-00",
		"2026-13",
		"2026-6",
		"2026-06-01",
		" 2026-06",
		null,
		202606,
	])
		assert.equal(validMonth(value), false);
	assert.equal(monthDates("2024-02").length, 29);
	assert.equal(monthDates("2000-02").length, 29);
	assert.equal(monthDates("1900-02").length, 28);
	assert.equal(monthDates("0004-02").length, 29);
	assert.equal(monthDates("2026-03").at(-1), "2026-03-31");
	assert.equal(monthDates("2026-11").length, 30);
	assert.equal(shiftMonth("2026-12", 1), "2027-01");
	assert.equal(shiftMonth("2026-01", -13), "2024-12");
	assert.equal(shiftMonth("0099-12", 1), "0100-01");
	assert.equal(shiftMonth("0001-01", 9999 * 12 - 1), "9999-12");
	for (const [month, delta] of [
		["0001-01", -1],
		["9999-12", 1],
		["2026-01", 0.5],
		["2026-01", Infinity],
	] as const)
		assert.throws(() => shiftMonth(month, delta));
	assert.throws(() => monthDates("2026-13"));
	for (const date of ["2024-02-29", "0001-01-01", "9999-12-31"])
		assert.equal(validDate(date), true);
	for (const date of [
		"1900-02-29",
		"2026-04-31",
		"2026-06-00",
		"2026-6-01",
		"2026-06-01T00:00:00Z",
	])
		assert.equal(validDate(date), false);
	assert.equal(weekdayMonday("0001-01-01"), 0);
	assert.equal(weekdayMonday("2026-06-14"), 6);
	assert.equal(weekdayMonday("2026-03-09"), 0);
	assert.throws(() => weekdayMonday("2026-02-30"));
});

test("strict complete month DTOs preserve unknown, manual no and assumed provenance", () => {
	const value = history();
	value.days[0] = { localDate: "2026-06-01", worn: false, source: "manual" };
	value.days[1] = { localDate: "2026-06-02", worn: true, source: "assumed" };
	assert.deepEqual(parseWearHistory(value), value);
	assert.deepEqual(
		parseDayResult(dayResult("2026-06-03", null)),
		dayResult("2026-06-03", null),
	);
	assert.deepEqual(
		parseWearHistory(history("0001-02", "0001-02-28")).days.length,
		28,
	);
	const mutations: ((value: WearHistory) => void)[] = [
		(v) => {
			v.version = 2 as 1;
		},
		(v) => {
			(v as unknown as Record<string, unknown>).extra = true;
		},
		(v) => {
			v.month = "2026-6";
		},
		(v) => {
			v.today = "2026-02-30";
		},
		(v) => {
			v.timeZone = "bogus/zone";
		},
		(v) => {
			v.days.pop();
		},
		(v) => {
			v.days = Array(30);
		},
		(v) => {
			v.days.push(v.days[0]);
		},
		(v) => {
			v.days.reverse();
		},
		(v) => {
			v.days[1] = v.days[0];
		},
		(v) => {
			v.days[0].worn = true;
		},
		(v) => {
			v.days[0].source = "manual";
		},
		(v) => {
			v.days[0] = { localDate: "2026-06-01", worn: false, source: "assumed" };
		},
		(v) => {
			v.days[17] = { localDate: v.today, worn: true, source: "assumed" };
		},
		(v) => {
			v.days[18] = { localDate: "2026-06-19", worn: true, source: "assumed" };
		},
		(v) => {
			(v.days[0] as unknown as Record<string, unknown>).sensor = true;
		},
	];
	for (const mutate of mutations) {
		const value = history();
		mutate(value);
		assert.throws(() => parseWearHistory(value));
	}
	for (const value of [
		null,
		[],
		{},
		{ ...dayResult(), version: 2 },
		{ ...dayResult(), extra: 1 },
		{
			version: 1,
			day: { localDate: "2026-06-01", worn: true, source: "assumed" },
		},
	])
		assert.throws(() => parseDayResult(value));
});

test("automation DTO is bounded, exact, canonical, explicit and date-validated", () => {
	const enabled = {
		version: 1,
		enabled: true,
		weekdays: [0, 6],
		startsOn: "2026-06-18",
	};
	assert.deepEqual(parseAutomationPreferences(enabled), enabled);
	assert.deepEqual(parseAutomationPreferences(off()), off());
	for (const change of [
		{ enabled: "true" },
		{ weekdays: [] },
		{ weekdays: [6, 0] },
		{ weekdays: [0, 0] },
		{ weekdays: [7] },
		{ weekdays: [-1] },
		{ weekdays: [1.5] },
		{ weekdays: [true] },
		{ weekdays: ["1"] },
		{ weekdays: Array(1) },
		{ weekdays: Array(8).fill(1) },
		{ startsOn: null },
		{ startsOn: "2026-02-29" },
		{ version: 2 },
		{ extra: true },
	])
		assert.throws(() => parseAutomationPreferences({ ...enabled, ...change }));
	assert.throws(() =>
		parseAutomationPreferences({ ...off(), startsOn: "2026-06-18" }),
	);
	assert.equal(
		parseWearHistory({
			...history(),
			automation: { ...enabled, startsOn: "2026-06-19" },
		}).automation.startsOn,
		"2026-06-19",
		"Existing literal rule dates survive timezone rollback; no future assumptions are permitted",
	);
});

test("same-session month requests are latest-wins, including stale errors", async () => {
	const h = harness();
	const first = h.controller.load("2026-06");
	const next = h.controller.load("2026-05");
	h.reads[1].result.resolve(history("2026-05"));
	await next;
	h.reads[0].result.reject(new Error("stale June failure"));
	await first;
	assert.equal(h.controller.getState().month, "2026-05");
	assert.equal(h.controller.getState().history?.month, "2026-05");
	assert.equal(h.controller.getState().error, "");
	assert.equal(h.controller.getState().loading, false);
});

test("owner and token changes clear old data and fence both read success and failure", async () => {
	for (const next of [
		{ owner: "b", token: "token-b" },
		{ owner: "a", token: "renewed" },
		null,
	]) {
		const h = await ready();
		const pending = h.controller.load("2026-05");
		h.setSession(next);
		assert.equal(h.controller.getState().history, null);
		h.reads[1].result.reject(new Error("old session error"));
		await pending;
		assert.equal(h.controller.getState().error, "");
		assert.equal(h.controller.getState().loading, false);
	}
	const h = harness();
	const old = h.controller.load("2026-06");
	h.setSession({ owner: "b", token: "b" });
	const current = h.controller.load("2026-05");
	h.reads[1].result.resolve(history("2026-05"));
	await current;
	h.reads[0].result.resolve(history());
	await old;
	assert.equal(h.controller.getState().history?.month, "2026-05");
});

test("manual save rejects invalid and future dates with a synchronous shared write lock", async () => {
	const h = await ready();
	for (const date of ["2026-02-30", "2026-06-19", "2026-06-18T00:00:00Z"])
		assert.equal(await h.controller.saveDay(date, true), false);
	assert.equal(
		await h.controller.saveDay("2026-06-01", "yes" as unknown as boolean),
		false,
	);
	assert.equal(h.writes.length, 0);
	const pending = h.controller.saveDay("2026-06-01", false);
	assert.equal(h.controller.getState().busy, true);
	assert.equal(await h.controller.saveDay("2026-06-02", true), false);
	assert.equal(await h.controller.saveAutomation(true, [0]), false);
	assert.equal(h.writes.length, 1);
	assert.equal(h.controller.getState().history?.days[0].source, "unknown");
	h.writes[0].result.resolve(dayResult("2026-06-01", false));
	await flush();
	h.reads[1].result.resolve(history());
	assert.equal(await pending, true);
	assert.equal(h.controller.getState().busy, false);
});

test("session changes triggered synchronously by subscribers cannot send an old intent as the new owner", async () => {
	const h = await ready();
	const unsubscribe = h.controller.subscribe(() => {
		if (h.controller.getState().busy) h.setSession({ owner: "b", token: "b" });
	});
	assert.equal(await h.controller.saveDay("2026-06-01", true), false);
	assert.equal(h.writes.length, 0);
	assert.equal(h.controller.getState().busy, false);
	assert.equal(h.controller.getState().history, null);
	unsubscribe();
});

test("acknowledged save refreshes the selected month, never navigates back", async () => {
	const h = await ready();
	const save = h.controller.saveDay("2026-06-01", true);
	const navigation = h.controller.load("2026-05");
	h.reads[1].result.resolve(history("2026-05"));
	await navigation;
	h.writes[0].result.resolve(dayResult());
	await flush();
	assert.equal(h.reads[2].month, "2026-05");
	h.reads[2].result.resolve(history("2026-05"));
	assert.equal(await save, true);
	assert.equal(h.controller.getState().month, "2026-05");
	assert.equal(h.controller.getState().busy, false);
});

test("newer reads invalidate postwrite refresh without discarding acknowledgment or leaving locks", async () => {
	const h = await ready();
	const save = h.controller.saveDay("2026-06-01", null);
	h.writes[0].result.resolve(dayResult("2026-06-01", null));
	await flush();
	const navigation = h.controller.load("2026-04");
	h.reads[2].result.resolve(history("2026-04"));
	await navigation;
	h.reads[1].result.reject(new Error("obsolete refresh failure"));
	assert.equal(await save, true);
	assert.equal(h.controller.getState().busy, false);
	assert.equal(h.controller.getState().error, "");
	assert.equal(h.controller.getState().month, "2026-04");
});

test("mutation errors from a prior month do not leak into the current calendar", async () => {
	const h = await ready();
	const save = h.controller.saveDay("2026-06-01", true);
	const navigation = h.controller.load("2026-05");
	h.reads[1].result.resolve(history("2026-05"));
	await navigation;
	h.writes[0].result.reject(new Error("June mutation error"));
	assert.equal(await save, false);
	assert.equal(h.controller.getState().error, "");
	assert.equal(h.controller.getState().busy, false);
});

test("successful mutation plus failed refresh is true with visible error and unlocked retry", async () => {
	const h = await ready();
	const save = h.controller.saveDay("2026-06-01", true);
	h.writes[0].result.resolve(dayResult());
	await flush();
	h.reads[1].result.reject(new Error("refresh unavailable"));
	assert.equal(await save, true);
	assert.equal(
		h.controller.getState().error,
		"Saved, but wear history could not refresh. refresh unavailable",
	);
	assert.equal(h.controller.getState().loading, false);
	assert.equal(h.controller.getState().busy, false);
	const retry = h.controller.saveDay("2026-06-01", true);
	assert.equal(h.writes.length, 2);
	h.writes[1].result.reject(new Error("offline"));
	assert.equal(await retry, false);
	assert.equal(h.controller.getState().busy, false);
});

test("late old-session writes cannot refresh, report errors or unlock a new-session write", async () => {
	for (const fail of [false, true]) {
		const h = await ready();
		const old = h.controller.saveDay("2026-06-01", true);
		h.setSession({ owner: "b", token: "b" });
		const reload = h.controller.load("2026-06");
		h.reads[1].result.resolve(history());
		await reload;
		const current = h.controller.saveDay("2026-06-02", false);
		if (fail) h.writes[0].result.reject(new Error("old failure"));
		else h.writes[0].result.resolve(dayResult());
		assert.equal(await old, false);
		assert.equal(h.controller.getState().busy, true);
		assert.equal(h.controller.getState().error, "");
		h.writes[1].result.resolve(dayResult("2026-06-02", false));
		await flush();
		h.reads[2].result.resolve(history());
		assert.equal(await current, true);
		assert.equal(h.controller.getState().busy, false);
	}
});

test("Strict Mode dispose/mount fences late requests and resumes loading", async () => {
	const h = harness();
	const old = h.controller.mount();
	h.controller.dispose();
	const remount = h.controller.mount();
	h.reads[0].result.resolve(history("2026-06", "2026-06-01"));
	await old;
	assert.equal(h.controller.getState().history, null);
	assert.equal(h.controller.getState().loading, true);
	h.reads[1].result.resolve(history());
	await remount;
	const write = h.controller.saveDay("2026-06-01", true);
	h.controller.dispose();
	h.writes[0].result.resolve(dayResult());
	assert.equal(await write, false);
	assert.equal(h.controller.getState().busy, false);
	assert.equal(h.reads.length, 2);
	assert.equal(await h.controller.saveDay("2026-06-01", true), false);
});

test("disposed late callbacks do not publish even when the session changed", async () => {
	const h = harness();
	let notifications = 0;
	h.controller.subscribe(() => {
		notifications++;
	});
	const pending = h.controller.load("2026-06");
	h.controller.dispose();
	const before = notifications;
	h.setSession({ owner: "b", token: "b" });
	h.reads[0].result.reject(new Error("late failure"));
	await pending;
	assert.equal(notifications, before);
});

test("automation validates selections, copies and sorts inputs and acknowledges refresh failures", async () => {
	const h = await ready();
	for (const days of [[], [0, 0], [7], [1.5], [true] as unknown as number[]])
		assert.equal(await h.controller.saveAutomation(true, days), false);
	assert.equal(h.automations.length, 0);
	const days = [6, 0];
	const save = h.controller.saveAutomation(true, days);
	days[0] = 3;
	assert.deepEqual(h.automations[0].body, { enabled: true, weekdays: [0, 6] });
	h.automations[0].result.resolve({
		version: 1,
		enabled: true,
		weekdays: [0, 6],
		startsOn: "2026-06-18",
	});
	await flush();
	h.reads[1].result.reject(new Error("refresh failed"));
	assert.equal(await save, true);
	assert.equal(h.controller.getState().busy, false);
	const disable = h.controller.saveAutomation(false, []);
	h.automations[1].result.resolve(off());
	await flush();
	h.reads[2].result.resolve(history());
	assert.equal(await disable, true);
});

test("wrong-month and malformed write responses fail closed and release locks", async () => {
	const h = harness();
	const load = h.controller.load("2026-06");
	h.reads[0].result.resolve(history("2026-05"));
	await load;
	assert.equal(h.controller.getState().history, null);
	assert.match(h.controller.getState().error, /wrong calendar month/);
	const next = h.controller.load("2026-06");
	h.reads[1].result.resolve(history());
	await next;
	const save = h.controller.saveDay("2026-06-01", true);
	h.writes[0].result.resolve(dayResult("2026-06-02", true));
	assert.equal(await save, false);
	assert.equal(h.controller.getState().busy, false);
	assert.equal(h.reads.length, 2);
});

// Native modules are replaced only at the import boundary; the real runtime source executes.
function runtimeHarness() {
	let session: WearHistorySession = { owner: "a", token: "token-a" };
	let ids = 0;
	const calls: {
		path: string;
		options: Record<string, unknown>;
		result: ReturnType<typeof deferred<unknown>>;
	}[] = [];
	const listeners = new Set<() => void>();
	const sessionStore = {
		get account() {
			return session ? { id: session.owner } : null;
		},
		get token() {
			return session?.token ?? "";
		},
		get isValid() {
			return !!session;
		},
		onChange(callback: () => void) {
			listeners.add(callback);
			return () => {
				listeners.delete(callback);
			};
		},
	};
	const send = <T>(path: string, options: Record<string, unknown>) => {
		const result = deferred<unknown>();
		calls.push({ path, options, result });
		return result.promise as Promise<T>;
	};
	const source = readFileSync(
		new URL("../../src/lib/wear-history/runtime.ts", import.meta.url),
		"utf8",
	);
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
		},
	}).outputText;
	const exports: Record<string, unknown> = {};
	runInNewContext(output, {
		exports,
		require(name: string) {
			if (name === "expo-crypto") return { randomUUID: () => `uuid-${++ids}` };
			if (name === "../api") return { request: send, sessionStore };
			if (name === "./model") return model;
			if (name === "./controller") return controllers;
			throw new Error(`Unexpected import ${name}`);
		},
	});
	const runtime =
		exports as unknown as typeof import("../../src/lib/wear-history/runtime");
	const transport = runtime.createWearHistoryTransport(
		send,
		() => session,
		() => `uuid-${++ids}`,
	);
	return {
		...transport,
		calls,
		runtime,
		setSession(next: WearHistorySession) {
			session = next;
			for (const listener of listeners) listener();
		},
	};
}
const headers = (call: { options: Record<string, unknown> }) =>
	call.options.headers as Record<string, string>;
function last<T>(items: T[]): T {
	const item = items.at(-1);
	assert.ok(item);
	return item;
}

test("runtime captures explicit auth and retains retry keys for network, timeout and server uncertainty", async () => {
	const h = runtimeHarness();
	let previous = "";
	for (const status of [0, 500, 408]) {
		const write = h.transport.day({ localDate: "2026-06-01", worn: true });
		const call = last(h.calls);
		assert.equal(call.path, "/api/oculog/v2/wear/day");
		assert.equal(headers(call).Authorization, "Bearer token-a");
		if (previous) assert.equal(headers(call)["Idempotency-Key"], previous);
		previous = headers(call)["Idempotency-Key"];
		call.result.reject({ status });
		await assert.rejects(write);
	}
	const acknowledged = h.transport.day({ localDate: "2026-06-01", worn: true });
	assert.equal(headers(last(h.calls))["Idempotency-Key"], previous);
	last(h.calls).result.resolve(dayResult());
	await acknowledged;
	const next = h.transport.day({ localDate: "2026-06-01", worn: true });
	assert.notEqual(headers(last(h.calls))["Idempotency-Key"], previous);
	last(h.calls).result.resolve(dayResult());
	await next;
});

test("a different choice supersedes an uncertain day intent instead of replaying an obsolete value", async () => {
	const h = runtimeHarness();
	const first = h.transport.day({ localDate: "2026-06-01", worn: true });
	const obsolete = headers(last(h.calls))["Idempotency-Key"];
	last(h.calls).result.reject({ status: 0 });
	await assert.rejects(first);
	const opposite = h.transport.day({ localDate: "2026-06-01", worn: false });
	last(h.calls).result.resolve(dayResult("2026-06-01", false));
	await opposite;
	const chosenAgain = h.transport.day({ localDate: "2026-06-01", worn: true });
	assert.notEqual(headers(last(h.calls))["Idempotency-Key"], obsolete);
	last(h.calls).result.resolve(dayResult());
	await chosenAgain;
});

test("disable supersedes uncertain enable, so a later explicit enable is a new intent", async () => {
	const h = runtimeHarness();
	const enabling = h.transport.automation({ enabled: true, weekdays: [0] });
	const obsolete = headers(last(h.calls))["Idempotency-Key"];
	last(h.calls).result.reject({ status: 0 });
	await assert.rejects(enabling);
	const disabling = h.transport.automation({ enabled: false, weekdays: [] });
	last(h.calls).result.resolve(off());
	await disabling;
	const enablingAgain = h.transport.automation({
		enabled: true,
		weekdays: [0],
	});
	assert.notEqual(headers(last(h.calls))["Idempotency-Key"], obsolete);
	last(h.calls).result.resolve({
		version: 1,
		enabled: true,
		weekdays: [0],
		startsOn: "2026-06-18",
	});
	await enablingAgain;
});

test("runtime clears definitive rejection keys but preserves malformed acknowledgment intents", async () => {
	const h = runtimeHarness();
	const first = h.transport.day({ localDate: "2026-06-01", worn: true });
	const key = headers(h.calls[0])["Idempotency-Key"];
	h.calls[0].result.reject({ status: 422 });
	await assert.rejects(first);
	const retry = h.transport.day({ localDate: "2026-06-01", worn: true });
	const newKey = headers(h.calls[1])["Idempotency-Key"];
	assert.notEqual(newKey, key);
	h.calls[1].result.resolve({ version: 1 });
	await assert.rejects(retry);
	const same = h.transport.day({ localDate: "2026-06-01", worn: true });
	assert.equal(headers(h.calls[2])["Idempotency-Key"], newKey);
	h.calls[2].result.resolve(dayResult());
	await same;
});

test("runtime fingerprints include full intent, route, account and token; old callbacks cannot erase new keys", async () => {
	const h = runtimeHarness();
	const old = h.transport.day({ localDate: "2026-06-01", worn: true });
	const oldKey = headers(h.calls[0])["Idempotency-Key"];
	h.setSession({ owner: "a", token: "new-token" });
	h.syncSession();
	const current = h.transport.day({ localDate: "2026-06-01", worn: true });
	const newKey = headers(h.calls[1])["Idempotency-Key"];
	assert.notEqual(newKey, oldKey);
	assert.equal(headers(h.calls[1]).Authorization, "Bearer new-token");
	h.calls[1].result.reject({ status: 0 });
	await assert.rejects(current);
	h.calls[0].result.resolve(dayResult());
	await assert.rejects(old, /session changed/);
	const retry = h.transport.day({ localDate: "2026-06-01", worn: true });
	assert.equal(headers(h.calls[2])["Idempotency-Key"], newKey);
	h.calls[2].result.resolve(dayResult());
	await retry;
	const changed = h.transport.day({ localDate: "2026-06-01", worn: null });
	assert.notEqual(headers(h.calls[3])["Idempotency-Key"], newKey);
	h.calls[3].result.resolve(dayResult("2026-06-01", null));
	await changed;
});

test("runtime canonical automation bodies reuse uncertain intents and fence stale read DTOs", async () => {
	const h = runtimeHarness();
	const first = h.transport.automation({ enabled: true, weekdays: [6, 0] });
	const key = headers(h.calls[0])["Idempotency-Key"];
	assert.equal(
		JSON.stringify(h.calls[0].options.body),
		JSON.stringify({ enabled: true, weekdays: [0, 6] }),
	);
	h.calls[0].result.reject({ status: 503 });
	await assert.rejects(first);
	const retry = h.transport.automation({ enabled: true, weekdays: [0, 6] });
	assert.equal(headers(h.calls[1])["Idempotency-Key"], key);
	h.calls[1].result.resolve({
		version: 1,
		enabled: true,
		weekdays: [0, 6],
		startsOn: "2026-06-18",
	});
	await retry;
	const read = h.transport.history("2026-06");
	assert.equal(h.calls[2].path, "/api/oculog/v2/wear/history?month=2026-06");
	h.setSession({ owner: "b", token: "b" });
	h.calls[2].result.resolve(history());
	await assert.rejects(read, /session changed/);
});

test("device factory uses sessionStore subscriptions to fence switch-away-and-back callbacks", async () => {
	const h = runtimeHarness();
	const controller = h.runtime.createDeviceWearHistoryController();
	const mounting = controller.mount();
	const requestedMonth = String(h.calls[0].path.split("month=")[1]);
	h.setSession({ owner: "b", token: "b" });
	h.setSession({ owner: "a", token: "token-a" });
	h.calls[0].result.resolve(history(requestedMonth));
	await mounting;
	assert.equal(controller.getState().history, null);
	assert.equal(controller.getState().loading, false);
	controller.dispose();
	const remount = controller.mount();
	h.calls[1].result.resolve(history(requestedMonth));
	await remount;
	assert.equal(controller.getState().history?.month, requestedMonth);
	controller.dispose();
});
