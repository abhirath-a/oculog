import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SimpleState } from "../../shared/simple-domain";
import type { SettingsModel } from "../../src/components/settings";
import * as schedule from "../../src/components/settings/schedule";

function fixture(): SimpleState {
	return {
		today: "2026-04-01",
		timeZone: "UTC",
		eyes: ["left", "right"].map((eye) => ({
			id: null,
			eye: eye as "left" | "right",
			replacementDays: null,
			openedOn: null,
			dueOn: null,
			spareCount: 4,
			daysRemaining: null,
		})),
		daily: { localDate: "2026-04-01", worn: null },
	};
}

test("schedule explicitly registers current lenses without inventory commands", () => {
	const draft = schedule.initialDraft(fixture());
	draft.leftDays = "14";
	draft.leftOpened = "2026-03-20";
	assert.deepEqual(schedule.scheduleCommands(draft, "UTC"), [
		{
			eye: "left",
			replacementDays: 14,
			openedOn: "2026-03-20",
			timeZone: "UTC",
		},
		{
			eye: "right",
			replacementDays: 14,
			openedOn: "2026-03-20",
			timeZone: "UTC",
		},
	]);
	draft.differentIntervals = true;
	draft.rightDays = "30";
	draft.differentDates = true;
	draft.rightOpened = "";
	assert.equal(schedule.scheduleCommands(draft, "UTC")[1].openedOn, null);
	assert.equal(schedule.scheduleCommands(draft, "UTC")[1].replacementDays, 30);
});

test("both eyes validate before writes, including real calendar dates", () => {
	const draft = {
		...schedule.initialDraft(fixture()),
		leftDays: "14",
		rightDays: "366",
		differentIntervals: true,
	};
	assert.throws(
		() => schedule.scheduleCommands(draft, "UTC"),
		(error) => {
			assert.ok(error instanceof schedule.ScheduleValidationError);
			assert.equal(error.field, "rightDays");
			return true;
		},
	);
	assert.throws(
		() =>
			schedule.scheduleCommands(
				{ ...draft, rightDays: "14", leftOpened: "2026-02-30" },
				"UTC",
			),
		(error) => {
			assert.ok(error instanceof schedule.ScheduleValidationError);
			assert.equal(error.field, "leftOpened");
			return true;
		},
	);
	assert.throws(
		() => schedule.scheduleCommands({ ...draft, leftDays: "1.5" }, "UTC"),
		(error) => {
			assert.ok(error instanceof schedule.ScheduleValidationError);
			assert.equal(error.field, "leftDays");
			return true;
		},
	);
});

function harness() {
	const hooks: unknown[] = [];
	let cursor = 0;
	const calls: {
		route: string;
		body: { eye: string; openedOn?: string | null };
	}[] = [];
	const pending: Promise<unknown>[] = [];
	const authStore = { record: { id: "owner" }, token: "token" };
	let failRight = false;
	let swapOwner = false;
	let focus: (() => void) | undefined;
	const effects: (() => undefined | (() => void))[] = [];
	const cleanups: (() => void)[] = [];
	let confirmation: () => Promise<boolean> = async () => false;
	let logouts = 0;
	const store = {
		state: fixture(),
		account: { id: "owner", email: "lens@example.com" },
		online: true,
		pending: false,
		loading: false,
		error: "",
		logout: async () => {
			logouts++;
		},
		mutate: async (route: string, body: { eye: string }) => {
			calls.push({ route, body });
			if (swapOwner) authStore.token = "another-session";
			if (body.eye === "right" && failRight) throw new Error("Connection lost");
			return true;
		},
	};
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": {
			jsx: (type: unknown, props: unknown) => ({ type, props }),
		},
		react: {
			useCallback: (fn: unknown) => fn,
			useEffect: (fn: () => undefined | (() => void)) => {
				effects.push(fn);
			},
			useRef: (value: unknown) => {
				const i = cursor++;
				if (!(i in hooks)) hooks[i] = { current: value };
				return hooks[i];
			},
			useState: (value: unknown) => {
				const i = cursor++;
				if (!(i in hooks))
					hooks[i] = typeof value === "function" ? value() : value;
				return [
					hooks[i],
					(next: unknown) => {
						hooks[i] = typeof next === "function" ? next(hooks[i]) : next;
					},
				];
			},
		},
		"react-native": {},
		"./presentation": {
			ScreenFrame: "ScreenFrame",
			PresentationText: "PresentationText",
		},
		"expo-router": {
			useFocusEffect: (callback: () => void) => {
				focus = callback;
			},
		},
		"../lib/api": {
			sessionStore: {
				get token() {
					return authStore.token;
				},
				get account() {
					return authStore.record;
				},
			},
		},
		"../lib/simple-controller": { deviceTimeZone: () => "UTC" },
		"../lib/store": { useStore: () => store },
		"./settings/form": { default: "SettingsForm" },
		"./settings/schedule": schedule,
		"./ui": {
			confirm: () => confirmation(),
			useAction: () => {
				const i = cursor++;
				if (!(i in hooks)) {
					const feedback = {
						busy: false,
						error: "",
						message: "",
						clearFeedback: () => {
							feedback.error = "";
							feedback.message = "";
						},
						run: (fn: () => Promise<unknown>, success = "Saved") => {
							feedback.busy = true;
							feedback.clearFeedback();
							const p = Promise.resolve()
								.then(fn)
								.then((result) => {
									if (result !== false) feedback.message = success;
								})
								.catch((error: Error) => {
									feedback.error = error.message;
								})
								.finally(() => {
									feedback.busy = false;
								});
							pending.push(p);
							return p;
						},
					};
					hooks[i] = feedback;
				}
				return hooks[i];
			},
		},
	};
	const hookExports: Record<string, unknown> = {};
	const hookSource = readFileSync(
		new URL(
			"../../src/components/settings/use-schedule-settings.ts",
			import.meta.url,
		),
		"utf8",
	);
	runInNewContext(
		ts.transpileModule(hookSource, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports: hookExports,
			require: (name: string) => {
				const aliases: Record<string, string> = {
					"./schedule": "./settings/schedule",
					"../ui": "./ui",
					"../../shared/simple-domain": "../../shared/simple-domain",
					"../../lib/api": "../lib/api",
					"../../lib/simple-controller": "../lib/simple-controller",
					"../../lib/store": "../lib/store",
				};
				const key = aliases[name] || name;
				assert.ok(key in mocks, key);
				return mocks[key];
			},
		},
	);
	mocks["./settings/use-schedule-settings"] = hookExports;
	const controller = hookExports as {
		useScheduleSettings: (state: SimpleState) => SettingsModel;
	};
	return {
		render: () => {
			cursor = 0;
			const model = controller.useScheduleSettings(store.state);
			for (const effect of effects.splice(0)) {
				const cleanup = effect();
				if (cleanup) cleanups.push(cleanup);
			}
			return model;
		},
		flush: () => Promise.all(pending.splice(0)),
		unmount: () => {
			for (const cleanup of cleanups.splice(0)) cleanup();
		},
		confirm: (value: boolean) => {
			confirmation = async () => value;
		},
		deferConfirmation: () => {
			let resolve!: (value: boolean) => void;
			confirmation = () =>
				new Promise<boolean>((done) => {
					resolve = done;
				});
			return (value: boolean) => resolve(value);
		},
		logouts: () => logouts,
		session: authStore,
		state: store.state,
		store,
		focus: () => focus?.(),
		calls,
		failRight: (v: boolean) => {
			failRight = v;
		},
		swapOwner: () => {
			swapOwner = true;
		},
	};
}

test("partial settings retry saves only unfinished eye and never consumes spares", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	h.failRight(true);
	h.render().save();
	await h.flush();
	h.failRight(false);
	h.render().save();
	await h.flush();
	assert.deepEqual(
		h.calls.map((call) => call.body.eye),
		["left", "right", "right"],
	);
	assert.ok(h.calls.every((call) => call.route === "settings"));
	h.render().save();
	await h.flush();
	assert.equal(
		h.calls.length,
		3,
		"unchanged schedule does not rewrite either eye",
	);
});

test("partial retry accepts a successful left server snapshot published while pending", async () => {
	const h = harness();
	const mutate = h.store.mutate;
	h.store.mutate = async (route, body) => {
		h.store.pending = true;
		try {
			const result = await mutate(route, body);
			if (result) {
				assert.equal(h.store.pending, true);
				h.store.state = {
					...h.store.state,
					eyes: h.store.state.eyes.map((eye) =>
						eye.eye === body.eye ? { ...eye, replacementDays: 14 } : eye,
					),
				};
			}
			return result;
		} finally {
			h.store.pending = false;
		}
	};
	h.render().change("leftDays", "14");
	h.failRight(true);
	h.render().save();
	await h.flush();
	assert.equal(
		h.store.state.eyes.find((eye) => eye.eye === "left")?.replacementDays,
		14,
	);
	h.failRight(false);
	// The harness declines all conflict prompts: a spurious prompt would block retry.
	h.render().save();
	await h.flush();
	assert.deepEqual(
		h.calls.map((call) => call.body.eye),
		["left", "right", "right"],
	);
	assert.equal(h.render().draft.leftDays, "14");
});

test("session change between eye writes stops the old form", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	h.swapOwner();
	h.render().save();
	await h.flush();
	assert.equal(h.calls.length, 1);
});

test("unsaved drafts survive focus refreshes and partial failures", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	for (const eye of h.state.eyes) eye.openedOn = "2026-04-01";
	h.render();
	h.focus();
	assert.equal(h.render().draft.leftOpened, "");
	h.failRight(true);
	h.render().save();
	await h.flush();
	h.render();
	h.focus();
	assert.equal(h.render().draft.leftDays, "14");
});

test("pending guards synchronously block duplicate saves, edits, and focus", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	const model = h.render();
	model.save();
	model.save();
	model.change("leftDays", "30");
	h.focus();
	await h.flush();
	assert.equal(h.calls.length, 2);
	assert.equal(h.render().draft.leftDays, "14");
	h.store.pending = true;
	h.render().change("leftDays", "30");
	h.render().save();
	assert.equal(h.calls.length, 2);
	assert.equal(h.render().draft.leftDays, "14");
});

test("a stale rendered save cannot submit a different unsaved draft", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	const old = h.render();
	old.change("leftDays", "30");
	old.save();
	await h.flush();
	assert.equal(h.calls.length, 0);
	h.render().save();
	await h.flush();
	assert.equal(h.calls.length, 2);
});

test("validation stays inline, clears only the edited field, and uses shared interval semantics", async () => {
	const h = harness();
	h.render().save();
	let model = h.render();
	assert.equal(
		model.disabled,
		false,
		"local validation does not disable native inputs",
	);
	assert.equal(model.busy, false);
	assert.equal(model.validationEvent, 1);
	model.save();
	assert.equal(
		h.render().validationEvent,
		2,
		"repeat invalid saves publish a fresh focus request",
	);
	await h.flush();
	model = h.render();
	assert.match(
		model.fieldErrors.leftDays || "",
		/^Interval: enter a whole number from 1 to 365/,
	);
	assert.equal(model.error, "");
	assert.equal(h.calls.length, 0);
	model.change("leftOpened", "2026-03-20");
	model = h.render();
	assert.ok(
		model.fieldErrors.leftDays,
		"unrelated date edits retain interval validation",
	);
	model.change("leftDays", "14");
	assert.equal(h.render().fieldErrors.leftDays, undefined);
	h.render().change("differentIntervals", true);
	h.render().save();
	await h.flush();
	assert.match(h.render().fieldErrors.rightDays || "", /^Right interval:/);
	h.render().change("differentIntervals", false);
	assert.equal(
		h.render().fieldErrors.rightDays,
		undefined,
		"hidden right field error is removed",
	);
});

test("server failure survives draft edits, while committed-save events exclude failed and no-op saves", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	h.failRight(true);
	h.render().save();
	await h.flush();
	assert.equal(h.render().savedEvent, 0);
	assert.equal(h.render().error, "Connection lost");
	h.render().change("rightOpened", "2026-03-20");
	assert.equal(h.render().error, "Connection lost");
	h.failRight(false);
	h.render().save();
	await h.flush();
	assert.equal(h.render().savedEvent, 1);
	h.render().save();
	await h.flush();
	assert.equal(h.render().savedEvent, 1);
});

test("sign-out confirmation shares the save lock without showing saving or clearing saved feedback", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	h.render().save();
	await h.flush();
	assert.equal(h.render().message, "Changes saved.");
	const answer = h.deferConfirmation();
	const before = h.render();
	before.signOut();
	before.save();
	before.signOut();
	await Promise.resolve();
	const waiting = h.render();
	assert.equal(waiting.busy, false);
	assert.equal(waiting.disabled, true);
	assert.equal(waiting.accountDisabled, true);
	assert.equal(waiting.message, "Changes saved.");
	waiting.change("leftDays", "30");
	answer(false);
	await h.flush();
	assert.equal(h.logouts(), 0);
	assert.equal(h.calls.length, 2);
	assert.equal(h.render().draft.leftDays, "14");
	assert.equal(h.render().message, "Changes saved.");
	assert.equal(h.render().savedEvent, 1);
	assert.equal(h.render().disabled, false);
});

test("save blocks logout and a changed session invalidates sign-out confirmation", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	const model = h.render();
	model.save();
	model.signOut();
	await h.flush();
	assert.equal(h.logouts(), 0);
	const answer = h.deferConfirmation();
	h.render().signOut();
	await Promise.resolve();
	h.session.token = "new-session";
	answer(true);
	await h.flush();
	assert.equal(h.logouts(), 0);
});

test("date bounds follow the current server day without resetting a dirty draft", () => {
	const h = harness();
	h.render().change("leftDays", "14");
	assert.equal(h.render().today, "2026-04-01");
	h.store.state = { ...h.store.state, today: "2026-04-02" };
	const model = h.render();
	assert.equal(model.today, "2026-04-02");
	assert.equal(model.draft.leftDays, "14");
});

test("future opened dates validate before either eye writes", () => {
	const draft = {
		...schedule.initialDraft(fixture()),
		leftDays: "14",
		leftOpened: "2026-04-02",
	};
	assert.throws(
		() => schedule.scheduleCommands(draft, "UTC", "2026-04-01"),
		/no later than today/,
	);
});

test("returning to Settings refreshes opened dates changed on Home", () => {
	const h = harness();
	h.render();
	for (const eye of h.state.eyes) {
		eye.replacementDays = 14;
		eye.openedOn = "2026-04-01";
	}
	h.render();
	h.focus();
	assert.equal(h.render().draft.leftOpened, "2026-04-01");
	assert.equal(h.render().draft.leftDays, "14");
});

test("focused foreground refresh preserves remote opened dates when only interval is edited", async () => {
	const h = harness();
	h.render();
	h.store.state = {
		...h.state,
		eyes: h.state.eyes.map((eye) => ({
			...eye,
			replacementDays: 14,
			openedOn: "2026-04-01",
		})),
	};
	h.render();
	assert.equal(h.render().draft.leftOpened, "2026-04-01");
	h.render().change("leftDays", "30");
	h.render().save();
	await h.flush();
	assert.equal(h.calls.length, 2);
	assert.ok(h.calls.every((call) => call.body.openedOn === "2026-04-01"));
});

test("Skip guard is offline-safe and locks synchronously through save and sign-out", async () => {
	const h = harness();
	h.store.online = false;
	assert.equal(h.render().canLeave(), true);
	h.store.online = true;
	h.render().change("leftDays", "14");
	const model = h.render();
	model.save();
	assert.equal(model.canLeave(), false);
	await h.flush();
	assert.equal(h.render().canLeave(), true);
	const answer = h.deferConfirmation();
	const before = h.render();
	before.signOut();
	assert.equal(before.canLeave(), false);
	await Promise.resolve();
	answer(false);
	await h.flush();
	assert.equal(h.render().canLeave(), true);
});

test("route removal discards a local draft and invalidates stale callbacks", async () => {
	const h = harness();
	h.render().change("leftDays", "14");
	const model = h.render();
	h.unmount();
	assert.equal(model.canLeave(), false);
	model.save();
	model.signOut();
	await h.flush();
	assert.equal(h.calls.length, 0);
	assert.equal(h.logouts(), 0);
});

test("unmount during an in-flight eye write stops subsequent writes but retains its server state", async () => {
	const h = harness();
	let finish!: () => void;
	const mutate = h.store.mutate;
	h.store.mutate = async (route, body) => {
		await mutate(route, body);
		await new Promise<void>((resolve) => {
			finish = resolve;
		});
		h.store.state = {
			...h.store.state,
			eyes: h.store.state.eyes.map((eye) =>
				eye.eye === body.eye ? { ...eye, replacementDays: 14 } : eye,
			),
		};
		return true;
	};
	h.render().change("leftDays", "14");
	h.render().save();
	await Promise.resolve();
	await Promise.resolve();
	h.unmount();
	finish();
	await h.flush();
	assert.deepEqual(
		h.calls.map((call) => call.body.eye),
		["left"],
	);
	assert.equal(h.store.state.eyes[0].replacementDays, 14);
	assert.equal(h.store.state.eyes[1].replacementDays, null);
});

test("dirty remote changes require explicit review without stale writes or losing edits", async () => {
	const h = harness();
	h.render().change("leftDays", "30");
	h.store.state = {
		...h.state,
		eyes: h.state.eyes.map((eye) => ({
			...eye,
			replacementDays: 14,
			openedOn: "2026-04-01",
		})),
	};
	h.render().save();
	await h.flush();
	assert.equal(h.calls.length, 0);
	assert.equal(h.render().draft.leftDays, "30");
	assert.equal(h.render().draft.leftOpened, "");
	h.confirm(true);
	h.render().save();
	await h.flush();
	assert.equal(
		h.calls.length,
		0,
		"review does not write until a separate Save",
	);
	assert.equal(h.render().draft.leftDays, "30");
	assert.equal(h.render().draft.leftOpened, "2026-04-01");
	h.render().save();
	await h.flush();
	assert.equal(h.calls.length, 2);
	assert.ok(h.calls.every((call) => call.body.openedOn === "2026-04-01"));
});
