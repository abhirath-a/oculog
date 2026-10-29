// biome-ignore-all lint/suspicious/noExplicitAny: Executable native JSX harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const walk = (node: any): any[] =>
	Array.isArray(node)
		? node.flatMap(walk)
		: node?.props
			? [node, ...walk(node.props.children)]
			: [];
function harness() {
	const effects: (() => void)[] = [];
	const changes: any[] = [];
	const model: any = {
		draft: {
			leftDays: "14",
			rightDays: "30",
			leftOpened: "2026-03-01",
			rightOpened: "",
			differentIntervals: true,
			differentDates: true,
		},
		today: "2026-03-08",
		disabled: false,
		fieldErrors: {},
		validationEvent: 0,
		error: "",
		canLeave: () => true,
	};
	let current = true;
	const jsx = (type: unknown, props: any) => ({ type, props });
	const mocks: any = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": Object.fromEntries(
			["Button", "Column", "Icon", "Row", "Text"].map((k) => [k, k]),
		),
		"@expo/ui/swift-ui/modifiers": new Proxy(
			{},
			{ get: (_, name) => (value: unknown) => ({ name, value }) },
		),
		react: {
			useCallback: (fn: any) => fn,
			useRef: (current: any) => ({ current }),
			useEffect: (fn: any) => effects.push(fn),
		},
		"react-native": {
			Platform: { OS: "ios", Version: "26.0" },
			AccessibilityInfo: { announceForAccessibility() {} },
		},
		"../native-input": { __esModule: true, default: "Input" },
		"../native-page": { PageToggle: "Toggle" },
		"../presentation/theme": { usePresentationTheme: () => ({}) },
		"./editor-date": { __esModule: true, default: "Date" },
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/settings/lens-setup-fields.tsx",
					import.meta.url,
				),
				"utf8",
			),
			{
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			},
		).outputText,
		{
			exports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	return {
		model,
		changes,
		stale: () => {
			current = false;
		},
		render: () => {
			const tree = exports.LensSetupFields({
				model,
				current: () => current,
				change: (...args: any[]) => changes.push(args),
			});
			effects.splice(0).forEach((fn) => fn());
			return walk(tree);
		},
	};
}
test("native lens setup binds per-eye drafts, literal account date bounds and guarded toggles", () => {
	const h = harness(),
		nodes = h.render();
	const inputs = nodes.filter((n) => n.type === "Input"),
		dates = nodes.filter((n) => n.type === "Date"),
		toggles = nodes.filter((n) => n.type === "Toggle");
	assert.deepEqual(
		inputs.map((n) => n.props.value),
		["14", "30"],
	);
	assert.deepEqual(
		dates.map((n) => n.props.value),
		["2026-03-01", ""],
	);
	assert.ok(
		inputs.every(
			(n) => n.props.keyboardType === "number-pad" && n.props.maxLength === 3,
		),
	);
	assert.ok(dates.every((n) => n.props.maximum === h.model.today));
	inputs[0].props.onChange("21");
	dates[1].props.onChange("2026-03-02");
	toggles[0].props.onChange(false);
	assert.deepEqual(h.changes, [
		["leftDays", "21"],
		["rightOpened", "2026-03-02"],
		["differentIntervals", false],
	]);
	h.model.disabled = true;
	inputs[0].props.onChange("99");
	assert.equal(h.changes.length, 3);
	assert.ok(
		h
			.render()
			.filter((n) => ["Input", "Date", "Toggle"].includes(n.type))
			.every((n) => n.props.disabled),
	);
});
test("retained fields cannot edit after identity loss or while the controller lock is held", () => {
	const h = harness(),
		nodes = h.render();
	h.model.canLeave = () => false;
	nodes.find((n) => n.type === "Input").props.onChange("30");
	h.model.canLeave = () => true;
	h.stale();
	for (const node of nodes.filter((n) =>
		["Input", "Date", "Toggle"].includes(n.type),
	))
		node.props.onChange("changed");
	assert.deepEqual(h.changes, []);
});
