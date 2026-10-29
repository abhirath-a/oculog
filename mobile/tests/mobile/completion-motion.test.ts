// biome-ignore-all lint/suspicious/noExplicitAny: Executable native JSX harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const read = (file: string) =>
	readFileSync(
		new URL(`../../src/components/onboarding/${file}`, import.meta.url),
		"utf8",
	);

test("Ready is an explicit stage, not a timed or animated auto-navigation", () => {
	const flow = read("index.tsx"),
		page = read("page.tsx");
	assert.match(flow, /move\("ready"\)/);
	assert.match(flow, /label="Go to Today"/);
	assert.match(flow, /label="Review setup"/);
	assert.match(flow, /model.savedEvent > pending.savedEvent/);
	assert.doesNotMatch(
		flow + page,
		/setTimeout|requestAnimationFrame|Animated\.|withSpring|completion-policy|completion-shared/,
	);
});

test("native completion actions honor disabled state and retain an accessible intrinsic target", () => {
	const jsx = (type: unknown, props: any) => ({ type, props });
	const modifiers = new Proxy(
		{},
		{ get: (_, name) => (value: unknown) => ({ name, value }) },
	);
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": { Button: "Button", Text: "Text" },
		"@expo/ui/swift-ui/modifiers": modifiers,
		react: {},
		"react-native": {},
		"../home/today-design": {},
		"../presentation/screen-frame": {},
		"../presentation/theme": {
			usePresentationTheme: () => ({ primary: "blue" }),
		},
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(read("page.tsx"), {
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
	for (const disabled of [false, true]) {
		let presses = 0;
		const tree = exports.OnboardingAction({
			label: "Go to Today",
			primary: true,
			disabled,
			onPress: () => presses++,
		});
		tree.props.onPress();
		assert.equal(presses, disabled ? 0 : 1);
		assert.equal(tree.props.disabled, disabled);
		assert.equal(tree.props.variant, "filled");
		assert.equal(tree.props.children.props.children, "Go to Today");
		assert.ok(
			tree.props.children.props.modifiers.some(
				(m: any) => m.name === "frame" && m.value.minHeight === 44,
			),
		);
		assert.ok(
			tree.props.children.props.modifiers.some(
				(m: any) => m.name === "fixedSize" && m.value.vertical,
			),
		);
	}
});
