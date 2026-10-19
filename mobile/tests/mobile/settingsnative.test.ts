import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as calendar from "../../src/components/settings/calendar";

const source = readFileSync(
	new URL("../../src/components/settings/form.tsx", import.meta.url),
	"utf8",
);
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(node: unknown): Node[] {
	if (Array.isArray(node)) return node.flatMap(nodes);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const item = node as Node;
	return [item, ...nodes(item.props.children)];
}
function harness(platform = "ios") {
	const refs: { current: unknown }[] = [];
	let cursor = 0;
	const effects: (() => void)[] = [];
	const dependencies: unknown[][] = [];
	let haptics = 0;
	const announcements: string[] = [];
	const jsx = (type: unknown, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const exports = {} as {
		default: (props: { model: Record<string, unknown> }) => Node;
	};
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react: {
			useRef: (value: unknown) => {
				const index = cursor++;
				if (!refs[index]) refs[index] = { current: value };
				return refs[index];
			},
			useEffect: (effect: () => void, deps: unknown[]) => {
				const index = cursor++;
				const previous = dependencies[index];
				if (
					!previous ||
					deps.some((value, i) => !Object.is(value, previous[i]))
				)
					effects.push(effect);
				dependencies[index] = deps;
			},
		},
		"react-native": {
			AccessibilityInfo: {
				announceForAccessibility: (message: string) =>
					announcements.push(message),
			},
			Platform: { OS: platform },
			View: "View",
			ActivityIndicator: "ActivityIndicator",
		},
		"./native-fields": { __esModule: true, default: "NativeFields" },
		"./section": { __esModule: true, default: "Section" },
		"./switch": { __esModule: true, default: "Switch" },
		"@expo/ui": {
			Button: "Button",
			Column: "Column",
			Host: "Host",
			RNHostView: "RNHostView",
			Picker: { Item: "PickerItem" },
			FieldGroup: { Section: "Section", SectionFooter: "Footer" },
		},
		"../presentation": {
			ScreenFrame: "ScreenFrame",
			SemanticText: "SemanticText",
			PresentationText: "PresentationText",
			DateField: "DateField",
			usePresentationEpoch: () => 0,
			usePresentationTheme: () => ({}),
			notifySuccess: async () => {
				haptics++;
			},
		},
		"../auth/field": { AuthField: "AuthField" },
		"./calendar": calendar,
		"./days": { __esModule: true, default: "Days" },
	};
	runInNewContext(
		ts.transpileModule(source, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	const changes: [string, unknown][] = [];
	let saves = 0;
	const model = {
		draft: {
			leftDays: "14",
			rightDays: "30",
			leftOpened: "",
			rightOpened: "2026-01-01",
			differentIntervals: true,
			differentDates: true,
		},
		disabled: false,
		accountDisabled: false,
		email: "person@example.com",
		timeZone: "UTC",
		error: "",
		message: "",
		busy: false,
		connectionError: "",
		loading: false,
		fieldErrors: {} as Record<string, string>,
		savedEvent: 0,
		change: (key: string, value: unknown) => changes.push([key, value]),
		save: () => {
			saves++;
		},
		resetPassword: () => {},
		signOut: () => {},
		reload: () => {},
	};
	return {
		model,
		changes,
		announcements,
		haptics: () => haptics,
		saves: () => saves,
		render: () => {
			cursor = 0;
			const tree = exports.default({ model });
			effects.splice(0).forEach((effect) => {
				effect();
			});
			return tree;
		},
	};
}

test("Lens editor uses one root native form without account actions", () => {
	const h = harness();
	const tree = h.render();
	assert.equal(tree.type, "ScreenFrame");
	assert.equal(tree.props.scrollOwner, "content");
	assert.equal(tree.props.insetMode, "stack");
	assert.equal(tree.props.title, "Lens setup");
	assert.deepEqual(
		nodes(tree)
			.filter((node) => node.type === "Section")
			.map((node) => node.props.title),
		["Replacement interval", "Current lenses", undefined],
	);
	assert.doesNotMatch(source, /<Card|<ScrollView|LazyColumn/);
	for (const platform of ["ios", "android"])
		assert.equal(
			existsSync(
				new URL(
					`../../src/components/settings/form.${platform}.tsx`,
					import.meta.url,
				),
			),
			false,
		);
});

test("Android uses one supported composed native scroller; iOS retains SwiftUI Form", () => {
	const android = readFileSync(
		new URL(
			"../../src/components/settings/native-fields.android.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const ios = readFileSync(
		new URL("../../src/components/settings/native-fields.tsx", import.meta.url),
		"utf8",
	);
	assert.match(android, /<Column/);
	assert.match(android, /verticalScroll\(\)/);
	assert.doesNotMatch(android, /<ScrollView|<LazyColumn|setTimeout/);
	assert.match(ios, /<FieldGroup>/);
	assert.doesNotMatch(ios, /jetpack-compose/);
});

test("feedback wraps in a bounded RN status area outside every native form row", () => {
	const h = harness();
	h.model.message = "Schedule saved.";
	h.model.error =
		"A long server explanation that must remain readable without clipping.";
	const tree = h.render();
	const sections = nodes(tree).filter((node) => node.type === "Section");
	assert.ok(
		sections.every(
			(section) =>
				!nodes(section).some((node) => node.type === "PresentationText"),
		),
	);
	const status = nodes(tree).find(
		(node) => node.props.accessibilityLiveRegion === "assertive",
	);
	assert.ok(status);
	assert.equal(status.props.accessibilityRole, "alert");
	assert.ok(
		nodes(status).some((node) => node.props.children === h.model.error),
	);
	assert.ok(
		nodes(status).some((node) => node.props.children === "Schedule saved."),
	);
	assert.equal(
		nodes(tree).filter((node) => node.type === "RNHostView").length,
		0,
	);
});

test("blank and per-eye dates remain controlled and preserve explicit clearing", () => {
	const h = harness();
	const dates = nodes(h.render()).filter((node) => node.type === "DateField");
	assert.equal(dates.length, 2);
	assert.equal(dates[0].props.value, "");
	assert.equal(dates[1].props.value, "2026-01-01");
	(dates[1].props.onChange as (value: string) => void)("");
	assert.deepEqual(h.changes[0], ["rightOpened", ""]);
	h.model.draft.differentDates = false;
	assert.equal(
		nodes(h.render()).filter((node) => node.type === "DateField").length,
		1,
	);
});

test("schedule haptics fire once only after a newly successful save, never on stale feedback or failure", () => {
	const h = harness();
	h.model.message = "Schedule saved.";
	h.model.savedEvent = 7;
	const save = nodes(h.render()).find(
		(node) => node.props.label === "Save changes",
	);
	assert.ok(save);
	assert.equal(h.haptics(), 0);
	(save.props.onPress as () => void)();
	assert.equal(h.saves(), 1);
	h.render();
	assert.equal(h.haptics(), 0);
	h.model.busy = true;
	h.model.message = "";
	h.render();
	h.model.message = "Schedule saved.";
	h.render();
	assert.equal(h.haptics(), 0, "success feedback waits for completion");
	h.model.busy = false;
	h.model.savedEvent++;
	h.render();
	h.render();
	assert.equal(h.haptics(), 1);
	(save.props.onPress as () => void)();
	h.model.busy = true;
	h.model.message = "";
	h.render();
	h.model.busy = false;
	h.model.error = "Connection lost";
	h.render();
	h.model.error = "";
	h.model.message = "Password reset requested. Check your email.";
	h.render();
	assert.equal(h.haptics(), 1);
});

test("date validation routes error and focus to the offending eye without focusing while saving", () => {
	const h = harness("web");
	const initialDates = nodes(h.render()).filter(
		(node) => node.type === "DateField",
	);
	const focused: string[] = [];
	(initialDates[0].props.inputRef as { current: unknown }).current = {
		focus: () => focused.push("left"),
	};
	(initialDates[1].props.inputRef as { current: unknown }).current = {
		focus: () => focused.push("right"),
	};
	h.model.error = "Right eye needs a valid opened date (YYYY-MM-DD).";
	h.model.fieldErrors = { rightOpened: h.model.error };
	h.model.disabled = true;
	h.render();
	assert.deepEqual(focused, []);
	h.model.disabled = false;
	const dates = nodes(h.render()).filter((node) => node.type === "DateField");
	assert.equal(dates[0].props.error, "");
	assert.equal(dates[1].props.error, h.model.error);
	assert.deepEqual(h.announcements, [h.model.error]);
	assert.deepEqual(focused, ["right"]);
	h.model.error = "Left eye opened date must be no later than today.";
	h.model.fieldErrors = { leftOpened: h.model.error };
	h.render();
	assert.deepEqual(focused, ["right", "left"]);
	h.model.error = "Right eye interval must be 1–365 days.";
	h.model.fieldErrors = { rightDays: h.model.error };
	const intervals = nodes(h.render()).filter(
		(node) => node.type === "DateField",
	);
	assert.ok(intervals.every((node) => node.props.error === ""));
	assert.deepEqual(focused, ["right", "left"]);
	assert.deepEqual(
		h.changes,
		[],
		"validation presentation never changes the draft",
	);
});

test("date-only bridges retain calendar days across time zones and DST", () => {
	const previous = process.env.TZ;
	try {
		for (const zone of [
			"America/Los_Angeles",
			"Pacific/Kiritimati",
			"Europe/Berlin",
		]) {
			process.env.TZ = zone;
			for (const day of ["2026-03-08", "2026-11-01", "2026-01-01"]) {
				assert.equal(calendar.localDateString(calendar.localDate(day)), day);
				assert.equal(
					calendar.composeDateString(new Date(calendar.composeDate(day))),
					day,
				);
			}
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});
