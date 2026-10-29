// biome-ignore-all lint/suspicious/noExplicitAny: Executable native-input hook harness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const walk = (n: any): any[] =>
	Array.isArray(n)
		? n.flatMap(walk)
		: n?.props
			? [n, ...walk(n.props.children)]
			: [];
function harness() {
	let focused = false,
		blurs = 0,
		focuses = 0;
	const native = { value: "14" },
		changes: string[] = [],
		inputRef: any = {};
	const internal = {
		current: {
			focus: () => focuses++,
			blur: () => blurs++,
			clear() {},
			isFocused: () => focused,
			setSelection: async () => {},
		},
	};
	const jsx = (type: unknown, props: any) => ({ type, props });
	const mocks: any = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": { TextInput: "Input", useNativeState: () => native },
		"@expo/ui/swift-ui/modifiers": new Proxy(
			{},
			{ get: (_, name) => (value: unknown) => ({ name, value }) },
		),
		"./native-page": {
			NativeStack: "Stack",
			NativeText: "Text",
			NativeAction: "Done",
		},
		"./presentation/theme": { usePresentationTheme: () => ({ text: "black" }) },
		react: {
			useRef: () => internal,
			useEffect: (fn: any) => fn(),
			useState: () => [
				focused,
				(value: boolean) => {
					focused = value;
				},
			],
			useImperativeHandle: (ref: any, fn: any) => {
				ref.current = fn();
			},
		},
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL("../../src/components/native-input.tsx", import.meta.url),
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
	const props = {
		label: "Right eye cycle",
		value: "14",
		disabled: false,
		error: "",
		keyboardType: "number-pad",
		inputRef,
		onChange: (value: string) => changes.push(value),
	};
	return {
		props,
		native,
		inputRef,
		changes,
		counts: () => ({ focuses, blurs }),
		render: () => walk(exports.default(props)),
	};
}
test("iOS numeric field exposes Done below the focused input without overwriting a native draft", () => {
	const h = harness();
	let nodes = h.render();
	assert.ok(!nodes.some((n) => n.type === "Done"));
	const input = nodes.find((n) => n.type === "Input");
	assert.equal(input.props.returnKeyType, "done");
	assert.equal(input.props.keyboardType, "number-pad");
	h.inputRef.current.focus();
	input.props.onFocus();
	h.props.value = "123";
	h.native.value = "123";
	input.props.onChangeText("123");
	nodes = h.render();
	const done = nodes.find((n) => n.type === "Done");
	assert.ok(done);
	done.props.onPress();
	done.props.onPress();
	assert.deepEqual(h.counts(), { focuses: 1, blurs: 2 });
	assert.equal(h.native.value, "123");
	assert.deepEqual(h.changes, ["123"]);
	input.props.onBlur();
	assert.ok(!h.render().some((n) => n.type === "Done"));
	h.props.value = "24";
	h.render();
	assert.equal(h.native.value, "24");
});
test("disabled fields reject native edits and imperative focus, retain errors and Dynamic Type targets", () => {
	const h = harness();
	h.render()
		.find((n) => n.type === "Input")
		.props.onFocus();
	h.props.disabled = true;
	h.props.error = "Enter a valid interval.";
	const nodes = h.render(),
		input = nodes.find((n) => n.type === "Input");
	h.inputRef.current.focus();
	input.props.onChangeText("99");
	nodes.find((n) => n.type === "Done").props.onPress();
	assert.deepEqual(h.counts(), { focuses: 0, blurs: 0 });
	assert.deepEqual(h.changes, []);
	assert.equal(input.props.editable, false);
	assert.ok(nodes.some((n) => n.props.children === h.props.error));
	assert.ok(
		input.props.modifiers.some(
			(m: any) => m.name === "font" && m.value.textStyle === "body",
		),
	);
	assert.ok(
		input.props.modifiers.some(
			(m: any) => m.name === "frame" && m.value.minHeight === 44,
		),
	);
});
