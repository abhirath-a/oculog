// biome-ignore-all lint/suspicious/noExplicitAny: Strict VM harness checks actual native adapter props and callback guards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as calendar from "../../src/components/presentation/date-only";

const jsx = (type: any, props: any) => ({ type, props });
function load(path: string, mocks: Record<string, any>) {
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/${path}`, import.meta.url),
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
			require(name: string) {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	return exports.default;
}
const react = {
	useEffect: (effect: any) => effect(),
	useRef: (initial: any) => ({ current: initial }),
	useState: (initial: any) => [initial, () => {}],
	useImperativeHandle: (ref: any, create: any) => {
		if (ref) ref.current = create();
	},
};
function nodes(tree: any): any[] {
	return Array.isArray(tree)
		? tree.flatMap(nodes)
		: tree?.props
			? [tree, ...nodes(tree.props.children)]
			: [];
}
const native = {
	NativeStack: "Stack",
	NativeText: "Text",
	NativeAction: "Action",
};

test("native date triggers distinguish Left/Right even for equal or missing dates, without a redundant static label", () => {
	let opened = 0;
	const EditorDate = load("settings/editor-date.tsx", {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react,
		"../native-page": native,
		"../presentation/date-only": {
			...calendar,
			createDateOnlySession: (
				...args: Parameters<typeof calendar.createDateOnlySession>
			) => {
				opened++;
				return calendar.createDateOnlySession(...args);
			},
		},
		"../presentation/theme": { usePresentationPaletteHold() {} },
		"./editor-date-picker": { DateFieldPicker: "Picker" },
	});
	for (const value of ["", "2026-04-01"]) {
		const names: string[] = [];
		for (const eye of ["left", "right"]) {
			const label = `Opened on · ${eye} lens`;
			const changes: string[] = [];
			const tree = EditorDate({
				label,
				value,
				maximum: "2026-04-04",
				disabled: true,
				onChange: (next: string) => changes.push(next),
			});
			const picker = nodes(tree).find((node) => node.type === "Picker");
			const action = picker.props.anchor;
			names.push(action.props.label);
			assert.equal(action.props.label, `${label}: ${value || "Choose date"}`);
			assert.equal(
				nodes(tree).some(
					(node) => node.type === "Text" && node.props.children === label,
				),
				false,
			);
			action.props.onPress();
			for (const clear of nodes(tree).filter((node) => node.type === "Action"))
				clear.props.onPress();
			assert.deepEqual(changes, []);
		}
		assert.notEqual(names[0], names[1]);
	}
	assert.equal(opened, 0, "disabled date actions never start a transaction");
});
