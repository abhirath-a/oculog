import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, any> };
const jsx = (type: unknown, props: Record<string, unknown>) => ({
	type,
	props,
});
function walk(tree: any): Node[] {
	if (Array.isArray(tree)) return tree.flatMap(walk);
	if (!tree?.props) return [];
	return [tree, ...walk(tree.props.children)];
}
function load(file: string, mocks: Record<string, unknown>) {
	const exports: Record<string, (props: any) => Node> = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/${file}`, import.meta.url),
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
				if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	return exports;
}
const ListItem = Object.assign("ListItem", {
	HeadlineContent: "Headline",
	SupportingContent: "Supporting",
});

test("Android overview keeps every ListItem modifier a map in idle/busy/idle; native enabled state owns actions", () => {
	let edits = 0;
	const presentation = {
		ScreenFrame: "Screen",
		SemanticText: "Text",
		PresentationText: "RNText",
		usePresentationEpoch: () => "light:0",
		usePresentationTheme: () => ({ surface: "surface" }),
	};
	const { default: render } = load("settings/overview.android.tsx", {
		"@expo/ui": { Button: "Button" },
		"@expo/ui/jetpack-compose": { Host: "Host", ListItem },
		"@expo/ui/jetpack-compose/modifiers": {
			fillMaxWidth: () => ({ $type: "fillMaxWidth" }),
		},
		"react-native": { View: "View", useColorScheme: () => "light" },
		"../presentation": presentation,
		"./native-fields": { default: "Scroller" },
		"./material-section.android": { MaterialSection: "Group" },
	});
	for (const busy of [false, true, false]) {
		const tree = render({
			model: {
				email: "test@example.test",
				timeZone: "GMT",
				accountDisabled: busy,
			},
			summary: "Left · 30 days; Right · 14 days",
			onEdit: () => edits++,
		});
		const items = walk(tree).filter((n) => n.type === ListItem);
		assert.equal(items.length, 2);
		for (const item of items) {
			assert.equal(item.props.modifiers.length, 1);
			assert.equal(item.props.modifiers[0].$type, "fillMaxWidth");
			assert.ok(!walk(item.props.children).some((n) => n.type === ListItem));
		}
		const edit = walk(tree).find((n) => n.props.label === "Lens setup")!;
		assert.equal(edit.props.disabled, busy);
		assert.equal(typeof edit.props.onPress, "function");
		assert.ok(
			walk(tree).some(
				(n) => n.props.children === "Left · 30 days\nRight · 14 days",
			),
		);
	}
	assert.equal(edits, 0);
});

test("Android groups compose controls directly; one scroller and no implicit headline wrappers", () => {
	const section = readFileSync(
		new URL(
			"../../src/components/settings/material-section.android.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const scroller = readFileSync(
		new URL(
			"../../src/components/settings/native-fields.android.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const home = readFileSync(
		new URL(
			"../../src/components/home/HomeContent.android.tsx",
			import.meta.url,
		),
		"utf8",
	);
	assert.doesNotMatch(section, /<ListItem|FieldGroup/);
	assert.equal((scroller.match(/verticalScroll\(\)/g) ?? []).length, 1);
	assert.doesNotMatch(home, /<FieldGroup|ToolbarView|ScrollView/);
	assert.match(home, /width: "100%"/);
	assert.match(scroller, /background\(theme.background\)/);
	assert.doesNotMatch(scroller, /useMaterialColors/);
});
