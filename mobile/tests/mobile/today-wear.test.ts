// biome-ignore-all lint/suspicious/noExplicitAny: VM hook harness models render/effect boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness(confirmed: boolean | null = null) {
	const hooks: any[] = [];
	let cursor = 0;
	const effects: (() => void)[] = [];
	const writes: boolean[] = [];
	const store = { online: true, error: "", account: { id: "a" } };
	const session = { token: "session-a" };
	const props = {
		disabled: false,
		state: { today: "2026-10-24", timeZone: "UTC", daily: { worn: confirmed } },
	};
	let throws = false;
	const mocks: any = {
		"../../lib/store": { useStore: () => store },
		"../../lib/api": { sessionStore: session },
		react: {
			useState(initial: any) {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = initial;
				return [
					hooks[index],
					(next: any) => {
						hooks[index] = next;
					},
				];
			},
			useRef(initial: any) {
				const index = cursor++;
				hooks[index] ??= { current: initial };
				return hooks[index];
			},
			useEffect(effect: () => void) {
				cursor++;
				effects.push(effect);
			},
		},
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL("../../src/components/home/today-wear.ts", import.meta.url),
				"utf8",
			),
			{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
		).outputText,
		{
			exports,
			require(name: string) {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
			JSON,
		},
	);
	return {
		props,
		store,
		session,
		writes,
		throwWrite() {
			throws = true;
		},
		render() {
			cursor = 0;
			// biome-ignore lint/correctness/useHookAtTopLevel: VM hook harness deliberately simulates render/effect boundaries.
			const choice = exports.useTodayWear(
				props.state,
				props.disabled,
				(value: boolean) => {
					if (throws) throw new Error("rejected");
					writes.push(value);
					props.disabled = true;
				},
			);
			for (const effect of effects.splice(0)) effect();
			return choice;
		},
	};
}

test("wear selection updates immediately, keeps confirmed state untouched, and blocks duplicate dispatch", () => {
	const h = harness();
	const initial = h.render();
	assert.equal(initial.selected, null);
	assert.equal(initial.saving, null);
	initial.choose(true);
	initial.choose(false);
	const optimistic = h.render();
	assert.equal(optimistic.selected, true);
	assert.equal(optimistic.saving, true);
	assert.equal(optimistic.disabled, true);
	assert.equal(h.props.state.daily.worn, null);
	assert.deepEqual(h.writes, [true]);
	h.props.state.daily.worn = true;
	h.props.disabled = false;
	h.render();
	const saved = h.render();
	assert.equal(saved.selected, true);
	assert.equal(saved.saving, null);
});

test("wear No rolls back to confirmed Yes on offline/uncertain failure without changing domain state", () => {
	const h = harness(true);
	h.render().choose(false);
	assert.equal(h.render().selected, false);
	h.store.online = false;
	h.store.error = "Delivery unconfirmed. Retry the same request.";
	const failed = h.render();
	assert.equal(failed.selected, true);
	assert.equal(failed.saving, null);
	assert.equal(h.props.state.daily.worn, true);
	assert.equal(h.store.error, "Delivery unconfirmed. Retry the same request.");
	assert.deepEqual(h.writes, [false]);
});

test("settled failed writes restore unknown; local optimistic state cannot cross account/session/calendar boundaries", () => {
	const settled = harness();
	settled.render().choose(false);
	assert.equal(settled.render().saving, false);
	settled.props.disabled = false;
	settled.render();
	assert.equal(settled.render().selected, null);
	for (const transition of [
		(h: ReturnType<typeof harness>) => {
			h.store.account.id = "b";
		},
		(h: ReturnType<typeof harness>) => {
			h.session.token = "refreshed";
		},
		(h: ReturnType<typeof harness>) => {
			h.props.state.today = "2026-10-25";
		},
		(h: ReturnType<typeof harness>) => {
			h.props.state.timeZone = "Pacific/Kiritimati";
		},
	]) {
		const h = harness();
		h.render().choose(true);
		assert.equal(h.render().selected, true);
		transition(h);
		assert.equal(h.render().selected, null);
		assert.equal(h.render().saving, null);
	}
});

test("disabled wear never dispatches; synchronous rejection clears optimistic draft", () => {
	const h = harness();
	h.props.disabled = true;
	h.render().choose(true);
	assert.deepEqual(h.writes, []);
	h.props.disabled = false;
	h.throwWrite();
	assert.throws(() => h.render().choose(true), /rejected/);
	assert.equal(h.render().selected, null);
});
