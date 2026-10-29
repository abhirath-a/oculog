// biome-ignore-all lint/suspicious/noExplicitAny: Executable JSX/hook harness, not native rendering evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as dateOnly from "../../src/components/presentation/date-only";

const require = createRequire(import.meta.url);
const read = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

function harness(
	loaded = true,
	editor = false,
	iosVersion = "26.0",
	realDates = false,
) {
	const slots = new Map<string, any[]>();
	const effects = new Map<string, { deps: any[]; cleanup?: () => void }>();
	let instance = "",
		index = 0,
		changed = false;
	let queue: (() => void)[] = [];
	let nodes: any[] = [];
	const navigations: string[] = [],
		announcements: string[] = [],
		focus: string[] = [];
	let saves = 0,
		reloads = 0,
		haptics = 0,
		locked = false;
	const session = {
		account: { id: "synthetic-owner" },
		token: "synthetic-token",
	};
	const snapshot = { today: "2026-10-24", eyes: [] };
	const store = {
		account: session.account,
		state: loaded ? snapshot : null,
		pending: false,
		loading: !loaded,
		error: "",
		reload: async () => {
			reloads++;
		},
	};
	const model: any = {
		draft: {
			leftDays: "",
			rightDays: "",
			leftOpened: "",
			rightOpened: "",
			differentIntervals: false,
			differentDates: false,
		},
		busy: false,
		disabled: false,
		accountDisabled: false,
		message: "",
		error: "",
		connectionError: "",
		loading: false,
		fieldErrors: {},
		savedEvent: 0,
		validationEvent: 0,
		timeZone: "UTC",
		today: snapshot.today,
		canLeave: () => !locked,
		change(key: string, value: any) {
			if (!locked) {
				model.draft = { ...model.draft, [key]: value };
				model.message = "";
				const errors = { ...model.fieldErrors };
				delete errors[key];
				model.fieldErrors = errors;
			}
		},
		reload: () => {
			reloads++;
		},
		save() {
			saves++;
			if (!model.draft.leftDays) {
				model.fieldErrors = { leftDays: "Enter a prescribed interval." };
				model.validationEvent++;
				return;
			}
			locked = true;
			model.busy = true;
			model.disabled = true;
			model.accountDisabled = true;
			model.message = "";
		},
	};
	const hook = () => {
		const values = slots.get(instance) || [];
		slots.set(instance, values);
		return { values, slot: index++ };
	};
	const hooks = {
		...React,
		useState(initial: any) {
			const { values, slot } = hook();
			if (!(slot in values))
				values[slot] = typeof initial === "function" ? initial() : initial;
			return [
				values[slot],
				(next: any) => {
					const value = typeof next === "function" ? next(values[slot]) : next;
					if (!Object.is(value, values[slot])) {
						values[slot] = value;
						changed = true;
					}
				},
			];
		},
		useRef(initial: any) {
			const { values, slot } = hook();
			values[slot] ||= { current: initial };
			return values[slot];
		},
		useEffect(effect: () => any, deps: any[] = []) {
			const key = `${instance}:${index++}`,
				old = effects.get(key);
			if (!old || deps.some((d, i) => !Object.is(d, old.deps[i]))) {
				queue.push(() => {
					old?.cleanup?.();
					effects.set(key, { deps, cleanup: effect() });
				});
			}
		},
		useCallback(fn: any) {
			return fn;
		},
		useImperativeHandle(ref: any, create: any) {
			if (ref) ref.current = create();
		},
	};
	function leaf(kind: string, native = true) {
		const component: any = () => null;
		component.kind = kind;
		component.native = native;
		return component;
	}
	const sdk = Object.fromEntries(
		["Button", "Column", "Host", "Icon", "Row", "ScrollView", "Text"].map(
			(k) => [k, leaf(k)],
		),
	);
	const modifiers = Object.fromEntries(
		[
			"accessibilityAddTraits",
			"buttonStyle",
			"controlSize",
			"fixedSize",
			"font",
			"frame",
			"glassEffect",
			"foregroundStyle",
			"multilineTextAlignment",
			"scrollDismissesKeyboard",
			"tint",
		].map((k) => [k, (options: any) => ({ kind: k, options })]),
	);
	const prevent: boolean[] = [];
	const shared: Record<string, any> = {
		react: hooks,
		"@expo/ui": sdk,
		"@expo/ui/swift-ui/modifiers": modifiers,
		"react-native": {
			Platform: { OS: "ios", Version: iosVersion },
			View: leaf("RNView", false),
			AccessibilityInfo: {
				announceForAccessibility: (text: string) => announcements.push(text),
			},
		},
		"expo-router": {
			useRouter: () => ({ replace: (path: string) => navigations.push(path) }),
		},
		"expo-router/react-navigation": {
			usePreventRemove: (blocked: boolean) => prevent.push(blocked),
		},
		"../../lib/api": { sessionStore: session },
		"../../lib/store": { useStore: () => store },
		"../home/today-design": { TodayText: leaf("TodayText") },
		"../native-input": { __esModule: true, default: leaf("Input") },
		"../native-page": {
			PageToggle: leaf("Toggle"),
			NativeStack: leaf("Column"),
			NativeText: leaf("TodayText"),
			NativeAction: (props: any) =>
				React.createElement(
					sdk.Button,
					props,
					React.createElement(sdk.Text, null, props.label),
				),
		},
		"../presentation/date-only": dateOnly,
		"./editor-date-picker": { DateFieldPicker: leaf("Picker") },
		"../presentation/haptics": {
			notifySuccess: async () => {
				haptics++;
			},
		},
		"../settings/editor-date": { __esModule: true, default: leaf("Date") },
		"./editor-date": { __esModule: true, default: leaf("Date") },
		"../home/today-feedback": {
			__esModule: true,
			default: leaf("Feedback", false),
		},
		"../settings/use-schedule-settings": { useScheduleSettings: () => model },
		"../presentation/screen-frame": { ScreenFrame: leaf("Frame", false) },
		"../presentation/theme": {
			usePresentationPaletteHold() {},
			usePresentationTheme: () => ({
				background: "#fff",
				surface: "#eee",
				primary: "#080",
				text: "#111",
				secondary: "#666",
				divider: "#ccc",
			}),
		},
	};
	function load(path: string, directory = "onboarding") {
		const exports: any = {};
		runInNewContext(
			ts.transpileModule(read(`components/${directory}/${path}`), {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			}).outputText,
			{
				exports,
				requestAnimationFrame: (fn: () => void) => {
					fn();
					return 1;
				},
				cancelAnimationFrame() {},
				require(name: string) {
					if (name === "react/jsx-runtime") return require(name);
					if (name === "./page" || name === "../onboarding/page") return page;
					if (
						name === "../settings/lens-setup-fields" ||
						name === "./lens-setup-fields"
					)
						return fields;
					assert.ok(name in shared, `Unexpected import ${name}`);
					return shared[name];
				},
			},
		);
		return exports;
	}
	const page = load("page.tsx");
	if (realDates) {
		const ActualDate = load("editor-date.tsx", "settings").default;
		ActualDate.observedKind = "Date";
		shared["./editor-date"] = { __esModule: true, default: ActualDate };
	}
	const fields = load("lens-setup-fields.tsx", "settings");
	const Root = editor
		? load("editor-form.tsx", "settings").default
		: load("index.tsx").default;
	function walk(node: any, path: string, depth: number) {
		if (node == null || typeof node === "boolean") return;
		if (Array.isArray(node)) {
			node.forEach((child, i) => {
				walk(child, `${path}/${i}`, depth);
			});
			return;
		}
		if (typeof node === "string" || typeof node === "number") {
			nodes.push({ kind: "text", text: String(node), depth });
			return;
		}
		if (node.type === React.Fragment) {
			walk(node.props.children, `${path}/fragment`, depth);
			return;
		}
		if (node.type.kind) {
			const kind = node.type.kind;
			if (kind !== "Host")
				assert.equal(
					node.type.native,
					depth > 0,
					`${kind} crosses native/RN boundary`,
				);
			nodes.push({ kind, props: node.props, depth });
			if (node.props.inputRef)
				node.props.inputRef.current = {
					focus: () => focus.push(node.props.label),
					blur() {},
				};
			if (kind === "Picker") walk(node.props.anchor, `${path}/anchor`, depth);
			walk(
				node.props.children,
				`${path}/${kind}`,
				depth + (kind === "Host" ? 1 : 0),
			);
		} else {
			if (node.type.observedKind)
				nodes.push({ kind: node.type.observedKind, props: node.props, depth });
			const previous = instance,
				previousIndex = index;
			instance = `${path}/${node.type.name}/${node.key || ""}`;
			index = 0;
			const output = node.type(node.props);
			walk(output, `${instance}/result`, depth);
			instance = previous;
			index = previousIndex;
		}
	}
	function render() {
		for (let pass = 0; pass < 12; pass++) {
			changed = false;
			nodes = [];
			queue = [];
			walk(React.createElement(Root, editor ? { model } : {}), "root", 0);
			for (const effect of queue) effect();
			const layout = nodes.find((n) => n.kind === "RNView" && n.props.onLayout);
			if (!nodes.some((n) => n.kind === "Host") && layout)
				layout.props.onLayout({
					nativeEvent: { layout: { width: 320, height: 568 } },
				});
			if (!changed) return;
		}
		assert.fail("Unexpected render loop");
	}
	const text = () =>
		nodes
			.filter((n) => n.kind === "text")
			.map((n) => n.text)
			.join(" ");
	const action = (label: string) => {
		// OnboardingAction ultimately supplies an SDK Button with its label as Text children.
		const button = nodes.find(
			(n) => n.kind === "Button" && n.props.children?.props?.children === label,
		);
		assert.ok(button, `Missing action ${label}: ${text()}`);
		return button.props;
	};
	const press = (label: string) => {
		action(label).onPress();
		render();
	};
	const finish = (success: boolean, increment = true) => {
		locked = false;
		model.busy = model.disabled = model.accountDisabled = false;
		model.message = success ? "Changes saved." : "";
		model.error = success ? "" : "Right eye could not be saved. Retry.";
		if (success && increment) model.savedEvent++;
		render();
	};
	render();
	return {
		render,
		text,
		action,
		press,
		finish,
		store,
		session,
		model,
		navigations,
		announcements,
		focus,
		prevent,
		nodes: () => nodes,
		saves: () => saves,
		reloads: () => reloads,
		haptics: () => haptics,
	};
}

test("welcome explains concrete purpose before setup, with one measured native Host/scroller", () => {
	const h = harness();
	assert.match(h.text(), /Know when your lenses are due/);
	assert.match(h.text(), /daily wear log/);
	assert.match(h.text(), /daily yes\/no/);
	assert.equal(h.nodes().filter((n) => n.kind === "Host").length, 1);
	assert.equal(h.nodes().filter((n) => n.kind === "ScrollView").length, 1);
	assert.equal(
		h.nodes().find((n) => n.kind === "Frame").props.insetMode,
		"standalone",
	);
	const host = h.nodes().find((n) => n.kind === "Host");
	assert.equal(host.props.style.width, 320);
	assert.equal(host.props.style.height, 568);
	const scroller = host.props.children.props.children[0];
	const footer = host.props.children.props.children[1];
	assert.equal(scroller.type.kind, "ScrollView");
	assert.equal(footer.type.kind, "Column");
	assert.equal(
		footer.props.style.paddingBottom,
		12,
		"Frame already owns bottom safe area",
	);
	assert.equal(
		h
			.nodes()
			.filter(
				(n) =>
					n.kind === "Button" &&
					n.props.modifiers.some(
						(m: any) =>
							m.kind === "buttonStyle" && m.options === "glassProminent",
					),
			).length,
		1,
	);
	assert.equal(h.saves(), 0);
});

test("explore is useful offline/loading and never persists a schedule", () => {
	const h = harness(false);
	assert.match(h.text(), /replacement dates/);
	h.press("Explore first");
	assert.deepEqual(h.navigations, ["/(tabs)/home"]);
	assert.equal(h.saves(), 0);
	const retry = harness(false);
	retry.store.loading = false;
	retry.store.error = "Unavailable";
	retry.press("Set up my lenses");
	assert.match(retry.text(), /Connect to set up/);
	retry.press("Retry connection");
	assert.equal(retry.reloads(), 1);
	retry.press("Set up later");
	assert.equal(retry.saves(), 0);
	assert.equal(retry.navigations.length, 1);
});

test("native setup binds both-eye fields, literal date bounds, and preserves drafts through Back", () => {
	const h = harness();
	h.press("Set up my lenses");
	const input = h.nodes().find((n) => n.kind === "Input");
	input.props.onChange("14");
	h.render();
	h.nodes()
		.find((n) => n.kind === "Toggle" && n.props.label.includes("intervals"))
		.props.onChange(true);
	h.render();
	const right = h
		.nodes()
		.find((n) => n.kind === "Input" && n.props.label === "Right eye cycle");
	right.props.onChange("30");
	h.render();
	h.nodes()
		.find((n) => n.kind === "Toggle" && n.props.label.includes("opened dates"))
		.props.onChange(true);
	h.render();
	const dates = h.nodes().filter((n) => n.kind === "Date");
	assert.equal(dates.length, 2);
	for (const date of dates) assert.equal(date.props.maximum, "2026-10-24");
	dates[0].props.onChange("2026-10-02");
	h.render();
	h.press("Back to welcome");
	h.press("Set up my lenses");
	assert.equal(h.model.draft.leftDays, "14");
	assert.equal(h.model.draft.rightDays, "30");
	assert.equal(h.model.draft.leftOpened, "2026-10-02");
	assert.equal(h.saves(), 0);
});

test("validation and a partial save never advance to Ready; complete retry does exactly once", () => {
	const h = harness();
	h.press("Set up my lenses");
	h.press("Save lens schedule");
	assert.match(h.text(), /Your lens schedule/);
	assert.equal(h.haptics(), 0);
	assert.ok(h.focus.includes("Lens replacement cycle"));
	h.model.change("leftDays", "14");
	h.press("Save lens schedule");
	assert.ok(h.prevent.includes(true));
	assert.equal(h.action("Set up later").disabled, true);
	h.press("Set up later");
	assert.equal(h.navigations.length, 0);
	h.finish(false);
	assert.doesNotMatch(h.text(), /Ready for your daily check-in/);
	h.press("Save lens schedule");
	h.finish(true);
	assert.match(h.text(), /Ready for your daily check-in/);
	assert.equal(h.haptics(), 1);
	h.render();
	assert.equal(h.haptics(), 1);
	h.press("Go to Today");
	assert.deepEqual(h.navigations, ["/(tabs)/home"]);
});

test("stale success cannot lend provenance to validation; explicit successful no-op save may finish", () => {
	const h = harness();
	h.model.message = "Changes saved.";
	h.press("Set up my lenses");
	h.press("Save lens schedule");
	assert.doesNotMatch(h.text(), /Ready for your daily check-in/);
	h.model.change("leftDays", "14");
	h.press("Save lens schedule");
	h.finish(true, false);
	assert.match(h.text(), /Ready for your daily check-in/);
	assert.equal(h.haptics(), 0);
});

test("session changes fence old callbacks and late save success; new identity starts at welcome", () => {
	const h = harness();
	const old = h.action("Explore first").onPress;
	h.session.token = "rotated-token";
	old();
	assert.equal(h.navigations.length, 0);
	h.render();
	assert.match(h.text(), /Know when your lenses are due/);
	h.press("Set up my lenses");
	h.model.change("leftDays", "14");
	h.press("Save lens schedule");
	h.session.token = "another-token";
	h.finish(true);
	assert.doesNotMatch(h.text(), /Ready for your daily check-in/);
	assert.equal(h.haptics(), 0);
});

test("validation focus and error announcements are event-driven, not repeated by unrelated editing", () => {
	const h = harness();
	h.press("Set up my lenses");
	h.nodes()
		.find((n) => n.kind === "Toggle" && n.props.label.includes("intervals"))
		.props.onChange(true);
	h.render();
	h.press("Save lens schedule");
	assert.equal(h.focus.length, 1);
	const initialAnnouncements = h.announcements.length;
	h.nodes()
		.find((n) => n.kind === "Input" && n.props.label === "Right eye cycle")
		.props.onChange("30");
	h.render();
	h.render();
	assert.equal(
		h.focus.length,
		1,
		"Editing another field must not steal focus back",
	);
	assert.equal(h.announcements.length, initialAnnouncements);
	h.model.error = "Connection interrupted.";
	h.render();
	h.render();
	assert.equal(
		h.announcements.filter((message) => message === "Connection interrupted.")
			.length,
		1,
	);
	h.press("Save lens schedule");
	assert.equal(
		h.focus.length,
		2,
		"A repeated explicit validation gets fresh focus",
	);
	assert.equal(h.announcements.length, initialAnnouncements + 2);
});

for (const editor of [false, true]) {
	test(`${editor ? "Account" : "Onboarding"} shares real glass hierarchy and honest interval previews`, () => {
		const h = harness(true, editor);
		if (!editor) h.press("Set up my lenses");
		const glass = h
			.nodes()
			.filter(
				(n) =>
					n.kind === "Column" &&
					n.props.modifiers?.some((m: any) => m.kind === "glassEffect"),
			);
		assert.equal(glass.length, 1, "Only the dominant plan card uses glass");
		const material = glass[0].props.modifiers.find(
			(m: any) => m.kind === "glassEffect",
		).options;
		assert.equal(material.glass.variant, "regular");
		assert.equal(material.shape, "roundedRectangle");
		assert.equal(
			glass[0].props.style.backgroundColor,
			undefined,
			"Opaque backgrounds must not mask iOS26 glass",
		);
		assert.match(h.text(), /Draft preview/);
		assert.match(h.text(), /Interval not set/);
		const input = h.nodes().findIndex((n) => n.kind === "Input");
		const toggle = h.nodes().findIndex((n) => n.kind === "Toggle");
		assert.ok(input < toggle, "Required timing leads per-eye configuration");
		const date = h.nodes().findIndex((n) => n.kind === "Date");
		const dateToggle = h
			.nodes()
			.findIndex(
				(n) => n.kind === "Toggle" && n.props.label.includes("opened dates"),
			);
		assert.ok(date < dateToggle);
		h.model.change("leftDays", "14");
		h.render();
		assert.match(h.text(), /Every 14 days/);
		for (const invalid of ["0", "366", "1e2", "-2", "1.5"]) {
			h.model.change("leftDays", invalid);
			h.render();
			assert.match(h.text(), /Invalid interval/);
			assert.doesNotMatch(h.text(), /Every \d+ days/);
		}
		assert.equal(h.saves(), 0, "Preview and changes never persist implicitly");
		assert.equal(h.nodes().filter((n) => n.kind === "Host").length, 1);
		assert.equal(h.nodes().filter((n) => n.kind === "ScrollView").length, 1);
		assert.equal(
			h.nodes().find((n) => n.kind === "Frame").props.insetMode,
			editor ? "stack" : "standalone",
		);
	});
}

test("retained Account field, date-picker and retry callbacks cannot cross a token change and rerender", () => {
	const h = harness(true, true);
	h.model.connectionError = "Offline";
	h.render();
	const oldInput = h.nodes().find((n) => n.kind === "Input").props.onChange;
	const oldDate = h.nodes().find((n) => n.kind === "Date").props.onChange;
	const oldRetry = h.action("Retry connection").onPress;
	h.session.token = "rotated-session";
	h.render();
	oldInput("14");
	oldDate("2026-10-02");
	oldRetry();
	assert.equal(h.model.draft.leftDays, "");
	assert.equal(h.model.draft.leftOpened, "");
	assert.equal(h.reloads(), 0);
	h.nodes()
		.find((n) => n.kind === "Input")
		.props.onChange("30");
	h.render();
	assert.equal(
		h.model.draft.leftDays,
		"30",
		"New-session controls remain usable",
	);
});

test("an actual open EditorDate transaction cannot commit across Account token rotation", () => {
	const h = harness(true, true, "26.0", true);
	h.press("Lenses open date: Choose date");
	const picker = h.nodes().find((n) => n.kind === "Picker" && n.props.visible);
	assert.ok(picker, "The real EditorDate transaction opened");
	const oldDone = picker.props.onDone;
	h.session.token = "rotated-during-picker";
	h.render();
	assert.equal(
		h.nodes().some((n) => n.kind === "Picker" && n.props.visible),
		false,
		"Session-keyed presentation closes the old transaction",
	);
	oldDone("2026-10-02");
	h.render();
	assert.equal(h.model.draft.leftOpened, "");
	h.press("Lenses open date: Choose date");
	h.nodes()
		.find((n) => n.kind === "Picker" && n.props.visible)
		.props.onDone("2026-10-03");
	h.render();
	assert.equal(
		h.model.draft.leftOpened,
		"2026-10-03",
		"New-session date transactions still commit",
	);
});

test("older iOS keeps a readable replacement-card fallback without simulating Liquid Glass", () => {
	const h = harness(true, true, "18.0");
	const card = h
		.nodes()
		.find(
			(n) =>
				n.kind === "Column" &&
				n.props.modifiers?.some((m: any) => m.kind === "glassEffect"),
		);
	assert.equal(card.props.style.backgroundColor, "#eee");
	assert.equal(card.props.style.borderRadius, 26);
	assert.match(h.text(), /Interval not set/);
});

test("Account glass editor keeps pinned Save, validation focus, feedback and success haptic", () => {
	const h = harness(true, true);
	h.press("Save changes");
	assert.equal(h.saves(), 1);
	assert.equal(h.haptics(), 0);
	assert.ok(h.focus.includes("Lens replacement cycle"));
	h.model.change("leftDays", "30");
	h.press("Save changes");
	assert.equal(h.action("Saving…").disabled, true);
	h.press("Saving…");
	assert.equal(h.saves(), 2);
	h.finish(true);
	assert.equal(h.haptics(), 1);
	assert.equal(
		h.nodes().find((n) => n.kind === "Feedback").props.action.message,
		"Changes saved.",
	);
	h.render();
	assert.equal(h.haptics(), 1);
	const oldSave = h.action("Save changes").onPress;
	h.session.token = "changed-session";
	oldSave();
	assert.equal(h.saves(), 2, "Old-session Save must be inert");
});

test("entry copy explains wear logging and replacement before credentials; no new opt-ins in onboarding", () => {
	const auth = read("app/auth.tsx");
	assert.match(auth, /Know when each lens is due for replacement/);
	assert.match(auth, /Log daily wear with a quick yes or no/);
	const ios = read("components/onboarding/index.tsx");
	assert.doesNotMatch(
		ios,
		/requestPermissions|updatePreferences|authenticate|scheduleNotification|setConsent|ToolbarView/,
	);
	assert.match(ios, /useScheduleSettings\(state\)/);
	assert.match(ios, /usePreventRemove\(model.busy/);
});
