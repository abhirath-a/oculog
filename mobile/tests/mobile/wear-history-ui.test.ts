// biome-ignore-all lint/suspicious/noExplicitAny: Lightweight executable hook/JSX tree, not native rendering evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import { createWearHistoryController } from "../../src/lib/wear-history/controller";
import * as model from "../../src/lib/wear-history/model";

const require = createRequire(import.meta.url);
// Same complete-month synthetic fixture shape as wear-history.test.ts. No device/API data.
function history(month = "2026-06"): model.WearHistory {
	return {
		version: 1,
		month,
		today: "2026-06-18",
		timeZone: "America/New_York",
		days: model.monthDates(month).map((localDate, index) => ({
			localDate,
			worn: index === 0 || index === 2 ? true : index === 1 ? false : null,
			source: index < 2 ? "manual" : index === 2 ? "assumed" : "unknown",
		})),
		automation: { version: 1, enabled: false, weekdays: [], startsOn: null },
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function harness(screen: "history" | "automation" = "history") {
	const session = {
		account: { id: "synthetic-owner" },
		token: "synthetic-token",
		isValid: true,
		onChange: (_listener: () => void) => () => {},
	};
	const store = {
		account: { id: "synthetic-owner" },
		state: { today: "2026-06-18" },
		reload: async () => {
			reloads++;
		},
	};
	let reloads = 0;
	const dimensions = { width: 375, height: 812, fontScale: 1, scale: 3 };
	const writes: {
		localDate: string;
		worn: boolean | null;
		result: ReturnType<typeof deferred<model.DayResult>>;
	}[] = [];
	const automations: {
		enabled: boolean;
		weekdays: number[];
		result: ReturnType<typeof deferred<model.AutomationPreferences>>;
	}[] = [];
	const loads: string[] = [];
	const savedDays = new Map<string, model.DayResult["day"]>();
	let focused: (() => void) | undefined;
	const controllers: ReturnType<typeof createWearHistoryController>[] = [];
	const prevented: boolean[] = [];
	const navigations: string[] = [];
	let rejectReads = false;
	const runtime = {
		createDeviceWearHistoryController() {
			const controller = createWearHistoryController(
				{
					history: async (month) => {
						loads.push(month);
						if (rejectReads) throw new Error("Synthetic refresh failed");
						const snapshot = history(month);
						return {
							...snapshot,
							days: snapshot.days.map(
								(day) => savedDays.get(day.localDate) ?? day,
							),
						};
					},
					day: ({ localDate, worn }) => {
						const result = deferred<model.DayResult>();
						writes.push({ localDate, worn, result });
						return result.promise;
					},
					automation: ({ enabled, weekdays }) => {
						const result = deferred<model.AutomationPreferences>();
						automations.push({ enabled, weekdays, result });
						return result.promise;
					},
				},
				() =>
					session.isValid
						? { owner: session.account.id, token: session.token }
						: null,
				"2026-06",
			);
			controllers.push(controller);
			return controller;
		},
	};
	const slots = new Map<string, any[]>();
	const effects = new Map<string, { deps: any[]; cleanup?: () => void }>();
	let instance = "",
		index = 0,
		changed = false;
	let queue: (() => void)[] = [];
	let nodes: { kind: string; props?: any; text?: string }[] = [];
	let visited = new Set<string>();
	const slot = () => {
		const values = slots.get(instance) ?? [];
		slots.set(instance, values);
		return { values, key: index++ };
	};
	const same = (a: any[], b: any[]) =>
		a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
	const hooks = {
		...React,
		useState(initial: any) {
			const { values, key } = slot();
			if (!(key in values))
				values[key] = typeof initial === "function" ? initial() : initial;
			return [
				values[key],
				(next: any) => {
					const value = typeof next === "function" ? next(values[key]) : next;
					if (!Object.is(value, values[key])) {
						values[key] = value;
						changed = true;
					}
				},
			];
		},
		useRef(initial: any) {
			const { values, key } = slot();
			values[key] ??= { current: initial };
			return values[key];
		},
		useMemo(create: () => any, deps: any[]) {
			const { values, key } = slot();
			if (!values[key] || !same(values[key].deps, deps))
				values[key] = { deps, value: create() };
			return values[key].value;
		},
		useCallback(callback: any, deps: any[]) {
			return hooks.useMemo(() => callback, deps);
		},
		useEffect(effect: () => any, deps: any[]) {
			const key = `${instance}:${index++}`;
			const previous = effects.get(key);
			if (!previous || !same(previous.deps, deps))
				queue.push(() => {
					previous?.cleanup?.();
					effects.set(key, { deps, cleanup: effect() });
				});
		},
		useSyncExternalStore(subscribe: any, getSnapshot: any) {
			hooks.useEffect(
				() =>
					subscribe(() => {
						changed = true;
					}),
				[subscribe],
			);
			return getSnapshot();
		},
	};
	function leaf(kind: string) {
		return Object.assign(() => null, { kind });
	}
	const native = Object.fromEntries(
		[
			"NativePage",
			"NativeRow",
			"NativeSection",
			"NativeText",
			"PageToggle",
		].map((name) => [name, leaf(name)]),
	);
	const modifiers = Object.fromEntries(
		[
			"accessibilityAddTraits",
			"accessibilityLabel",
			"buttonStyle",
			"controlSize",
			"datePickerStyle",
			"environment",
			"disabled",
			"fixedSize",
			"font",
			"frame",
			"multilineTextAlignment",
			"padding",
			"tint",
			"toggleStyle",
		].map((name) => [
			name,
			(value: any, ...args: any[]) => ({ kind: name, value, args }),
		]),
	);
	const imports: Record<string, any> = {
		react: hooks,
		"react/jsx-runtime": require("react/jsx-runtime"),
		"@expo/ui/swift-ui": Object.fromEntries(
			["Button", "DatePicker", "HStack", "VStack", "Text", "Toggle"].map(
				(name) => [name, leaf(name)],
			),
		),
		"@expo/ui/swift-ui/modifiers": modifiers,
		"react-native": { useWindowDimensions: () => dimensions },
		"expo-router": {
			useFocusEffect(callback: () => void) {
				hooks.useEffect(() => {
					focused = callback;
					callback();
					return () => {
						focused = undefined;
					};
				}, [callback]);
			},
			useRouter: () => ({ push: (path: string) => navigations.push(path) }),
		},
		"expo-router/react-navigation": {
			usePreventRemove: (busy: boolean) => prevented.push(busy),
		},
		"../../lib/api": { sessionStore: session },
		"../../lib/store": { useStore: () => store },
		"../../lib/wear-history/model": model,
		"../../lib/wear-history/runtime": runtime,
		"../native-page": native,
		"../ui": {
			Feedback: leaf("Feedback"),
			useAction() {
				const [busy, setBusy] = hooks.useState(false);
				const [error, setError] = hooks.useState("");
				const [message, setMessage] = hooks.useState("");
				return {
					busy,
					error,
					message,
					clearFeedback() {
						setError("");
						setMessage("");
					},
					async run(operation: () => Promise<unknown>, success: string) {
						setBusy(true);
						setError("");
						setMessage("");
						try {
							const result = await operation();
							if (result !== false) setMessage(success);
							return result;
						} catch (reason) {
							setError(
								reason instanceof Error ? reason.message : String(reason),
							);
							return false;
						} finally {
							setBusy(false);
						}
					},
				};
			},
		},
		"../button-action-colors": {
			useButtonActionColors: () => ({ accent: "#008800" }),
		},
	};
	function load(file: string) {
		const exports: any = {};
		const source = readFileSync(
			new URL(`../../src/components/wear-history/${file}.tsx`, import.meta.url),
			"utf8",
		);
		runInNewContext(
			ts.transpileModule(source, {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			}).outputText,
			{
				exports,
				require(name: string) {
					assert.ok(name in imports, `Unexpected import: ${name}`);
					return imports[name];
				},
			},
		);
		return exports;
	}
	imports["./native-support"] = load("native-support");
	const Root = load(`${screen}-screen`).default;
	function walk(node: any, path: string) {
		if (node == null || typeof node === "boolean") return;
		if (Array.isArray(node)) {
			node.forEach((child, i) => {
				walk(child, `${path}/${i}`);
			});
			return;
		}
		if (typeof node === "string" || typeof node === "number") {
			nodes.push({ kind: "text", text: String(node) });
			return;
		}
		if (node.type === React.Fragment) {
			walk(node.props.children, `${path}/fragment`);
			return;
		}
		if (node.type.kind) {
			nodes.push({ kind: node.type.kind, props: node.props });
			// SwiftUI displays these native labels without React children.
			if (node.type.kind === "Toggle") walk(node.props.label, `${path}/label`);
			walk(node.props.children, `${path}/children`);
			return;
		}
		const previous = instance,
			previousIndex = index;
		instance = `${path}/${node.type.name}/${node.key ?? ""}`;
		visited.add(instance);
		index = 0;
		walk(node.type(node.props), `${instance}/result`);
		instance = previous;
		index = previousIndex;
	}
	function render() {
		for (let pass = 0; pass < 20; pass++) {
			changed = false;
			queue = [];
			nodes = [];
			visited = new Set();
			walk(React.createElement(Root, { owner: "synthetic-owner" }), "root");
			// Key changes really unmount old hooks, including controller disposal.
			for (const [key, effect] of effects) {
				if (![...visited].some((path) => key.startsWith(`${path}:`))) {
					effect.cleanup?.();
					effects.delete(key);
				}
			}
			for (const key of slots.keys()) if (!visited.has(key)) slots.delete(key);
			for (const effect of queue) effect();
			if (!changed) return;
		}
		assert.fail("Hook render did not settle");
	}
	async function settle() {
		for (let i = 0; i < 12; i++) {
			await Promise.resolve();
			render();
		}
	}
	const text = () =>
		nodes
			.filter((node) => node.kind === "text")
			.map((node) => node.text)
			.join(" ");
	const action = (label: string) => {
		// The iOS day editor now uses a native controlled Toggle for explicit
		// boolean edits. Invoke its actual retained callback for race tests;
		// static tests separately retain the missing explicit-action safeguard.
		if (label === "I wore lenses" || label === "I did not wear lenses") {
			const toggle = nodes.find(
				(node) =>
					node.kind === "Toggle" &&
					typeof node.props.onIsOnChange === "function",
			);
			assert.ok(toggle, `Missing day toggle: ${text()}`);
			const callback = toggle.props.onIsOnChange;
			return {
				...toggle.props,
				onPress: () => callback(label === "I wore lenses"),
			};
		}
		const node = nodes.find(
			(node) =>
				node.kind === "Button" &&
				(node.props.label === label ||
					node.props.children?.props.children === label),
		);
		assert.ok(node, `Missing button ${label}: ${text()}`);
		return node.props;
	};
	const picker = () => {
		const pickers = nodes.filter((node) => node.kind === "DatePicker");
		assert.equal(pickers.length, 1, "One first-party native date picker");
		return pickers[0].props;
	};
	const select = (date: string) =>
		picker().onDateChange(new Date(`${date}T12:00:00.000Z`));
	const toggle = (label = "Enable assumed-wear logging") => {
		const node = nodes.find(
			(node) => node.kind === "PageToggle" && node.props.label === label,
		);
		if (node) return node.props;
		const chip = nodes.find(
			(item) =>
				item.kind === "Toggle" &&
				item.props.modifiers.some(
					(modifier: any) =>
						modifier.kind === "accessibilityLabel" && modifier.value === label,
				),
		);
		assert.ok(chip, `Missing toggle ${label}`);
		return {
			...chip.props,
			value: chip.props.isOn,
			onChange: chip.props.onIsOnChange,
			disabled: chip.props.modifiers.some(
				(modifier: any) => modifier.kind === "disabled" && modifier.value,
			),
		};
	};
	const disabled = (props: any) =>
		(props.modifiers ?? []).some(
			(modifier: any) => modifier.kind === "disabled" && modifier.value,
		);
	function acknowledgeDay(index = writes.length - 1) {
		const write = writes[index];
		const day: model.DayResult["day"] = {
			localDate: write.localDate,
			worn: write.worn,
			source: write.worn === null ? "unknown" : "manual",
		};
		savedDays.set(day.localDate, day);
		write.result.resolve({ version: 1, day });
	}
	render();
	return {
		render,
		settle,
		text,
		action,
		picker,
		select,
		toggle,
		disabled,
		writes,
		automations,
		loads,
		focusAgain() {
			focused?.();
			render();
		},
		controllers,
		prevented,
		navigations,
		session,
		store,
		dimensions,
		acknowledgeDay,
		reloads: () => reloads,
		failReads: () => {
			rejectReads = true;
		},
		nodes: () => nodes,
	};
}

test("returning to history refreshes the currently browsed month", async () => {
	const h = harness();
	await h.settle();
	h.select("2026-05-31");
	await h.settle();
	const before = h.loads.length;
	h.focusAgain();
	await h.settle();
	assert.equal(h.loads.length, before + 1);
	assert.equal(h.loads.at(-1), "2026-05");
});

test("native Date callbacks preserve literal UTC dates across month/year and leap-day transitions", async () => {
	const h = harness();
	await h.settle();
	for (const [instant, date] of [
		["2026-06-01T00:30:00+02:00", "2026-05-31"],
		["2026-05-31T23:30:00-02:00", "2026-06-01"],
		["2025-12-31T23:59:59.999Z", "2025-12-31"],
		["2026-01-01T00:00:00.000Z", "2026-01-01"],
		["2024-02-29T00:00:00.000Z", "2024-02-29"],
		["0001-01-01T12:00:00.000Z", "0001-01-01"],
	]) {
		h.picker().onDateChange(new Date(instant));
		await h.settle();
		assert.equal(h.controllers[0].getState().month, date.slice(0, 7));
		assert.equal(h.loads.at(-1), date.slice(0, 7));
		assert.equal(h.picker().selection.toISOString(), `${date}T12:00:00.000Z`);
		assert.ok(h.action("I wore lenses"));
		assert.equal(h.writes.length, 0);
	}
});

for (const change of ["token", "owner", "invalid", "store-owner"] as const) {
	test(`native picker and read callbacks cannot cross ${change} session boundaries`, async () => {
		const h = harness();
		await h.settle();
		const pick = h.picker().onDateChange;
		const refresh = h.action("Refresh history").onPress;
		const navigate = h.action("Automatic logging settings").onPress;
		const before = h.loads.length;
		if (change === "token") h.session.token = "new-token";
		else if (change === "owner") h.session.account = { id: "other-owner" };
		else if (change === "invalid") h.session.isValid = false;
		else {
			h.store.account = { id: "other-owner" };
			// Store-owner loss unmounts the session-keyed content.
			h.render();
		}
		const invoke = () => {
			pick(new Date("2026-05-31T12:00:00.000Z"));
			refresh();
			navigate();
		};
		invoke();
		assert.equal(h.loads.length, before);
		h.render();
		await h.settle();
		const after = h.loads.length;
		invoke();
		await h.settle();
		assert.equal(h.loads.length, after);
		assert.equal(h.writes.length, 0);
		assert.equal(h.navigations.length, 0);
	});
}

test("history selection alone never writes; source counts and unknown semantics stay distinct", async () => {
	const h = harness();
	await h.settle();
	assert.match(
		h.text(),
		/1 confirmed worn[,·\s]+1 confirmed not worn[,·\s]+1 assumed worn/,
	);
	for (const date of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]) {
		h.select(date);
		h.render();
		assert.match(
			h.text(),
			new RegExp(
				{
					"2026-06-01": "Manual: wore lenses",
					"2026-06-02": "Manual: did not wear",
					"2026-06-03": "Assumed worn",
					"2026-06-04": "Unknown",
				}[date]!,
			),
		);
	}
	assert.equal(h.writes.length, 0);
	assert.match(h.text(), /Unrecorded days remain unknown/);
	assert.match(h.text(), /Unknown/);
	assert.ok(h.action("I wore lenses"));
});

for (const [label, worn] of [
	["I wore lenses", true],
	["I did not wear lenses", false],
	["Clear to unknown", null],
] as const) {
	test(`explicit ${label} executes the real save callback and same-scope Store reload`, async () => {
		const h = harness();
		await h.settle();
		h.select("2026-06-03");
		h.render();
		const oldAction = h.action(label).onPress;
		const oldPicker = h.picker().onDateChange;
		oldAction();
		oldAction();
		oldPicker(new Date("2026-05-31T12:00:00.000Z"));
		assert.equal(h.controllers[0].getState().month, "2026-06");
		assert.equal(
			h.writes.length,
			1,
			"synchronous UI/controller locks reject duplicate callbacks",
		);
		assert.equal(h.writes[0].localDate, "2026-06-03");
		assert.equal(h.writes[0].worn, worn);
		h.render();
		assert.ok(h.prevented.includes(true));
		assert.ok(h.disabled(h.picker()));
		h.select("2026-06-02");
		assert.equal(h.reloads(), 0);
		h.acknowledgeDay();
		await h.settle();
		assert.equal(h.reloads(), 1);
		assert.equal(h.controllers[0].getState().busy, false);
		assert.match(h.text(), /Saved June 3, 2026/);
		assert.equal(h.navigations.length, 0);
	});
}

test("cleared assumed day stays unknown across same-session explicit read and focus refresh", async () => {
	const h = harness();
	await h.settle();
	h.select("2026-06-03");
	h.render();
	assert.match(h.text(), /Assumed worn/);
	h.action("Clear to unknown").onPress();
	h.acknowledgeDay();
	await h.settle();
	assert.equal(h.reloads(), 1);
	const before = h.loads.length;
	h.action("Refresh history").onPress();
	await h.settle();
	h.focusAgain();
	await h.settle();
	assert.equal(h.loads.length, before + 2);
	assert.equal(
		h.controllers.length,
		1,
		"Read refresh must keep the same session controller",
	);
	const day = h.controllers[0]
		.getState()
		.history?.days.find((day) => day.localDate === "2026-06-03");
	assert.equal(day?.worn, null);
	assert.equal(day?.source, "unknown");
	assert.match(h.text(), /Unknown/);
	assert.doesNotMatch(h.text(), /Automatically assumed from/);
	assert.equal(
		h.writes.length,
		1,
		"Reads and selection never repeat the clear write",
	);
	assert.equal(h.reloads(), 1);
});

test("selectionRevision rejects old day action between selecting another date and React rerender", async () => {
	const h = harness();
	await h.settle();
	h.select("2026-06-01");
	h.render();
	const oldSave = h.action("I wore lenses").onPress;
	h.select("2026-06-02");
	oldSave();
	assert.equal(h.writes.length, 0);
	h.render();
	h.action("I did not wear lenses").onPress();
	assert.equal(h.writes[0].localDate, "2026-06-02");
	h.acknowledgeDay();
	await h.settle();
});

test("native range bounds future dates and callbacks reject them; today remains editable", async () => {
	const h = harness();
	await h.settle();
	assert.equal(
		h.picker().range.start.toISOString(),
		"0001-01-01T12:00:00.000Z",
	);
	assert.equal(h.picker().range.end.toISOString(), "2026-06-18T12:00:00.000Z");
	assert.equal(h.disabled(h.picker()), false);
	const before = h.loads.length;
	for (const date of ["2026-06-19", "2026-07-01"]) h.select(date);
	h.render();
	assert.match(h.text(), /Choose today or an earlier day/);
	assert.equal(h.loads.length, before);
	assert.equal(h.writes.length, 0);
	h.select("2026-06-18");
	h.render();
	h.action("I wore lenses").onPress();
	assert.equal(h.writes[0].localDate, "2026-06-18");
	h.acknowledgeDay();
	await h.settle();
});

test("month change fences old save, refresh, picker and navigation callbacks before rerender", async () => {
	const h = harness();
	await h.settle();
	h.select("2026-06-01");
	h.render();
	const save = h.action("I wore lenses").onPress;
	const refresh = h.action("Refresh history").onPress;
	const navigate = h.action("Automatic logging settings").onPress;
	const change = h.picker().onDateChange;
	change(new Date("2026-05-31T23:59:59.999Z"));
	save();
	refresh();
	navigate();
	change(new Date("2026-06-02T00:00:00.000Z"));
	change(new Date("2026-04-30T12:00:00.000Z"));
	assert.equal(h.writes.length, 0);
	assert.equal(h.navigations.length, 0);
	assert.equal(h.loads.filter((month) => month === "2026-05").length, 1);
	assert.equal(h.loads.includes("2026-04"), false);
	await h.settle();
	assert.equal(h.controllers[0].getState().month, "2026-05");
	assert.equal(h.picker().selection.toISOString(), "2026-05-31T12:00:00.000Z");
	h.action("I wore lenses").onPress();
	assert.equal(h.writes[0].localDate, "2026-05-31");
	h.acknowledgeDay();
	await h.settle();
});

for (const screen of ["history", "automation"] as const) {
	test(`${screen}: token rotation blocks old callbacks before and after keyed rerender`, async () => {
		const h = harness(screen);
		await h.settle();
		if (screen === "history") {
			h.select("2026-06-01");
			h.render();
		}
		const oldSave = h.action(
			screen === "history" ? "I wore lenses" : "Save",
		).onPress;
		h.session.token = "rotated-token";
		oldSave();
		assert.equal(h.writes.length + h.automations.length, 0);
		h.render();
		await h.settle();
		oldSave();
		assert.equal(h.writes.length + h.automations.length, 0);
		assert.equal(h.controllers.length, 2);
		if (screen === "history")
			assert.match(h.text(), /Choose today or an earlier day/);
		else assert.equal(h.toggle().value, false);
	});
}

for (const screen of ["history", "automation"] as const) {
	test(`${screen}: owner, validity and Store owner guards reject stale callbacks`, async () => {
		const h = harness(screen);
		await h.settle();
		if (screen === "history") {
			h.select("2026-06-01");
			h.render();
		}
		const oldSave = h.action(
			screen === "history" ? "I wore lenses" : "Save",
		).onPress;
		h.session.account = { id: "other-owner" };
		oldSave();
		h.render();
		assert.match(h.text(), /Loading your account calendar/);
		h.session.account = { id: "synthetic-owner" };
		h.session.isValid = false;
		oldSave();
		h.render();
		assert.match(h.text(), /Loading your account calendar/);
		h.session.isValid = true;
		h.store.account = { id: "other-owner" };
		h.render();
		oldSave();
		assert.match(h.text(), /Loading your account calendar/);
		assert.equal(h.writes.length + h.automations.length, 0);
	});
}

for (const change of ["token", "owner", "unmount"] as const) {
	test(`postack Store.reload is fenced after ${change} changes during write`, async () => {
		const h = harness();
		await h.settle();
		h.select("2026-06-01");
		h.render();
		h.action("I wore lenses").onPress();
		if (change === "token") h.session.token = "new-token";
		else if (change === "owner") h.session.account = { id: "other-owner" };
		else {
			h.store.account = { id: "other-owner" };
			h.render();
		}
		h.acknowledgeDay();
		await h.settle();
		assert.equal(h.reloads(), 0);
		assert.doesNotMatch(h.text(), /Saved June/);
	});
}

test("screen fences Store.reload when session changes after controller acknowledgment but before its then callback", async () => {
	const h = harness();
	await h.settle();
	h.select("2026-06-01");
	h.render();
	h.action("I wore lenses").onPress();
	const controller = h.controllers[0];
	// save() computes true, then publishes busy=false in finally, before the screen's then runs.
	let rotated = false;
	const unsubscribe = controller.subscribe(() => {
		if (!rotated && !controller.getState().busy) {
			rotated = true;
			h.session.token = "postack-rotation";
		}
	});
	h.acknowledgeDay();
	await h.settle();
	unsubscribe();
	assert.equal(rotated, true);
	assert.equal(h.reloads(), 0);
	assert.doesNotMatch(h.text(), /Saved June/);
});

test("busy automation blocks old switch, weekday and Save callbacks until acknowledgment", async () => {
	const h = harness("automation");
	await h.settle();
	h.toggle().onChange(true);
	h.render();
	h.toggle("Monday: assume wear after the day ends").onChange(true);
	h.render();
	const switchChange = h.toggle().onChange;
	const weekdayChange = h.toggle(
		"Monday: assume wear after the day ends",
	).onChange;
	const save = h.action("Save").onPress;
	save();
	switchChange(false);
	weekdayChange(false);
	save();
	h.render();
	assert.equal(h.toggle().value, true);
	assert.equal(h.toggle("Monday: assume wear after the day ends").value, true);
	assert.equal(h.toggle().disabled, true);
	assert.equal(h.automations.length, 1);
	assert.ok(h.prevented.includes(true));
	h.automations[0].result.resolve({
		version: 1,
		enabled: true,
		weekdays: [0],
		startsOn: "2026-06-18",
	});
	await h.settle();
	assert.equal(h.toggle().disabled, false);
	assert.equal(h.controllers[0].getState().busy, false);
});

test("acknowledged day still reloads Store and unlocks when history refresh fails", async () => {
	const h = harness();
	await h.settle();
	h.select("2026-06-01");
	h.render();
	h.action("I wore lenses").onPress();
	h.failReads();
	h.acknowledgeDay();
	await h.settle();
	assert.equal(h.reloads(), 1);
	assert.match(h.text(), /Saved, but wear history could not refresh/);
	assert.equal(h.controllers[0].getState().busy, false);
});

test("weekdays use one native iOS button-toggle row, not seven switches or extra Hosts", async () => {
	const h = harness("automation");
	await h.settle();
	h.toggle().onChange(true);
	h.render();
	const chips = h.nodes().filter((node) => node.kind === "Toggle");
	assert.equal(chips.length, 7);
	assert.equal(
		h.nodes().filter((node) => node.kind === "PageToggle").length,
		1,
		"Only the overall opt-in is a switch",
	);
	assert.equal(
		h
			.nodes()
			.filter((node) => node.kind === "HStack" && node.props.spacing === 5)
			.length,
		1,
	);
	for (const chip of chips) {
		assert.ok(
			chip.props.modifiers.some(
				(modifier: any) =>
					modifier.kind === "toggleStyle" && modifier.value === "button",
			),
		);
		assert.ok(
			chip.props.modifiers.some(
				(modifier: any) =>
					modifier.kind === "accessibilityLabel" &&
					modifier.value.includes("assume wear"),
			),
		);
	}
	const monday = h.toggle("Monday: assume wear after the day ends");
	monday.onChange(true);
	monday.onChange(true);
	h.render();
	h.action("Save").onPress();
	assert.deepEqual(
		[...h.automations[0].weekdays],
		[0],
		"Repeated native events must not duplicate a weekday",
	);
});

test("automation defaults off; switch/weekday edits stay local; enabling requires a weekday", async () => {
	const h = harness("automation");
	await h.settle();
	assert.equal(h.toggle().value, false);
	assert.equal(h.nodes().filter((node) => node.kind === "Toggle").length, 0);
	h.toggle().onChange(true);
	h.render();
	for (const name of [
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
		"Sunday",
	])
		assert.equal(
			h.toggle(`${name}: assume wear after the day ends`).value,
			false,
		);
	assert.ok(h.disabled(h.action("Save")));
	h.action("Save").onPress();
	assert.equal(h.automations.length, 0);
	h.toggle("Friday: assume wear after the day ends").onChange(true);
	h.render();
	h.toggle("Monday: assume wear after the day ends").onChange(true);
	h.render();
	assert.equal(h.automations.length, 0);
	h.action("Save").onPress();
	h.action("Save").onPress();
	assert.equal(h.automations.length, 1);
	assert.equal(h.automations[0].enabled, true);
	assert.deepEqual([...h.automations[0].weekdays], [0, 4]);
	h.automations[0].result.resolve({
		version: 1,
		enabled: true,
		weekdays: [0, 4],
		startsOn: "2026-06-18",
	});
	await h.settle();
	assert.match(h.text(), /Saved. Selected completed days/);
	assert.equal(h.reloads(), 0);
	assert.equal(h.navigations.length, 0);
});

test("draftRevision rejects old Save immediately after switch change, before React rerender", async () => {
	const h = harness("automation");
	await h.settle();
	const oldSave = h.action("Save").onPress;
	h.toggle().onChange(true);
	oldSave();
	assert.equal(
		h.automations.length,
		0,
		"must not submit the old disabled draft",
	);
	h.render();
	assert.ok(h.disabled(h.action("Save")));
});

test("draftRevision rejects old Save immediately after weekday edit; explicit disable preserves selections", async () => {
	const h = harness("automation");
	await h.settle();
	h.toggle().onChange(true);
	h.render();
	h.toggle("Tuesday: assume wear after the day ends").onChange(true);
	h.render();
	const oldSave = h.action("Save").onPress;
	h.toggle("Monday: assume wear after the day ends").onChange(true);
	oldSave();
	assert.equal(h.automations.length, 0);
	h.render();
	h.toggle().onChange(false);
	h.render();
	h.action("Save").onPress();
	assert.equal(h.automations[0].enabled, false);
	assert.deepEqual([...h.automations[0].weekdays], [0, 1]);
	h.automations[0].result.resolve({
		version: 1,
		enabled: false,
		weekdays: [0, 1],
		startsOn: null,
	});
	await h.settle();
	assert.match(
		h.text(),
		/Automatic logging is off. Past records and assumptions are preserved/,
	);
});

test("native date picker keeps UTC date semantics without custom grids or nested Hosts", async () => {
	const h = harness();
	await h.settle();
	for (const dimensions of [
		{ width: 375, fontScale: 1 },
		{ width: 375, fontScale: 1.5 },
		{ width: 320, fontScale: 1 },
	]) {
		Object.assign(h.dimensions, dimensions);
		h.render();
		const picker = h.picker();
		assert.deepEqual([...picker.displayedComponents], ["date"]);
		assert.ok(
			picker.modifiers.some(
				(modifier: any) =>
					modifier.kind === "datePickerStyle" &&
					["compact", "graphical"].includes(modifier.value),
			),
		);
		assert.ok(
			picker.modifiers.some(
				(modifier: any) =>
					modifier.kind === "environment" &&
					modifier.value === "timeZone" &&
					modifier.args[0] === "UTC",
			),
		);
		assert.equal(
			h.nodes().filter((node) => ["Host", "RNView"].includes(node.kind)).length,
			0,
		);
		picker.onDateChange(new Date("2026-06-03T00:00:00.000Z"));
		h.render();
		assert.equal(
			h.picker().selection.toISOString(),
			"2026-06-03T12:00:00.000Z",
		);
		assert.match(h.text(), /Assumed worn/);
		assert.ok(h.action("Clear to unknown"));
	}
	assert.equal(h.writes.length, 0);
});
