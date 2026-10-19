import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { webTypography } from "../../src/components/presentation/web-typography";

type Element = { type: string; props: Record<string, any> };

function field(props: Record<string, unknown>) {
	const ref = {
		current: {
			focus() {
				focused++;
			},
			blur() {
				blurred++;
			},
		},
	};
	let focused = 0;
	let blurred = 0;
	const mocks: Record<string, unknown> = {
		"./web-typography": { webTypography },
		"react/jsx-runtime": {
			jsx: (type: string, props: Element["props"]) => ({ type, props }),
			jsxs: (type: string, props: Element["props"]) => ({ type, props }),
		},
		react: {
			useId: () => "field-test",
			useRef: () => ref,
			useState: () => [false, () => {}],
			useImperativeHandle: (
				target: { current: unknown },
				create: () => unknown,
			) => {
				if (target) target.current = create();
			},
		},
		"react-native": { TextInput: "TextInput", View: "View" },
		"./text": { PresentationText: "PresentationText" },
		"./theme": {
			usePresentationTheme: () => ({
				text: "black",
				surface: "white",
				secondary: "gray",
				primary: "blue",
				error: "red",
				divider: "gray",
			}),
		},
	};
	const exports: { NativeField?: (props: Record<string, unknown>) => Element } =
		{};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/presentation/native-field.web.tsx",
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
				assert.ok(name in mocks, `Unexpected runtime import ${name}`);
				return mocks[name];
			},
		},
	);
	const tree = exports.NativeField!({
		label: "Password",
		value: "saved",
		onChange() {},
		...props,
	});
	return {
		tree,
		input: (tree.props.children as Element[]).find(
			(node) => node?.type === "TextInput",
		)!,
		focused: () => focused,
		blurred: () => blurred,
	};
}

test("web NativeField preserves ref, controlled value, errors, autofill and Next/Done semantics", () => {
	for (const returnKeyType of ["next", "done"]) {
		const inputRef = {
			current: null as null | { focus(): void; blur(): void },
		};
		const writes: string[] = [];
		const submitted: string[] = [];
		let focused = 0;
		let blurred = 0;
		const h = field({
			inputRef,
			secure: true,
			autoComplete: "current-password",
			returnKeyType,
			error: "Invalid password",
			keyboardType: "email-address",
			onChange: (value: string) => writes.push(value),
			onSubmitEditing: (value: string) => submitted.push(value),
			onFocus: () => focused++,
			onBlur: () => blurred++,
		});
		const p = h.input.props;
		assert.equal(p.value, "saved");
		assert.equal(p.secureTextEntry, true);
		assert.equal(p.autoComplete, "current-password");
		assert.equal(p.keyboardType, "email-address");
		assert.equal(p.autoCapitalize, "none");
		assert.equal(p.autoCorrect, false);
		assert.equal(
			p.submitBehavior,
			returnKeyType === "next" ? "submit" : "blurAndSubmit",
		);
		assert.equal(p["aria-invalid"], true);
		assert.equal(p["aria-describedby"], "field-test-error");
		const alert = h.tree.props.children[2] as Element;
		assert.equal(alert.props.nativeID, p["aria-describedby"]);
		assert.equal(alert.props.accessibilityRole, "alert");
		p.onChangeText("typed");
		p.onSubmitEditing();
		p.onFocus();
		p.onBlur();
		assert.deepEqual(writes, ["typed"]);
		assert.deepEqual(submitted, ["saved"]);
		assert.equal(focused, 1);
		assert.equal(blurred, 1);
		inputRef.current!.focus();
		inputRef.current!.blur();
		assert.equal(h.focused(), 1);
		assert.equal(h.blurred(), 1);
	}
});

test("web NativeField blocks disabled writes, submit and focus and retains multiline metrics", () => {
	const inputRef = { current: null as null | { focus(): void } };
	const h = field({
		inputRef,
		disabled: true,
		multiline: true,
		onChange() {
			assert.fail("disabled write");
		},
		onSubmitEditing() {
			assert.fail("disabled submit");
		},
	});
	h.input.props.onChangeText("ignored");
	h.input.props.onSubmitEditing();
	inputRef.current!.focus();
	assert.equal(h.focused(), 0);
	assert.equal(h.input.props.editable, false);
	assert.equal(h.input.props.style.minHeight, 88);
	assert.equal(h.input.props.submitBehavior, "newline");
});

test("actual web NativeField renders accessible browser input without evaluating native SDK modules", () => {
	const result = spawnSync(
		process.execPath,
		[
			"--import",
			"tsx",
			"--input-type=module",
			"-e",
			String.raw`
import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const evaluated = new Set();
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier === "react-native" ? "react-native-web" : specifier, context);
  const web = result.url.replace(/\.(tsx?|jsx?)$/, ".web.$1");
  const url = web !== result.url && web.startsWith("file:") && existsSync(fileURLToPath(web)) ? web : result.url;
  evaluated.add(url);
  return { ...result, url };
}});
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { NativeField } = require("./src/components/presentation/native-field");
const html = renderToStaticMarkup(React.createElement(NativeField, { label: "Password", value: "saved", secure: true, autoComplete: "current-password", error: "Invalid", onChange() {} }));
assert.match(html, /type="password"/);
assert.match(html, /autoComplete="current-password"/i);
assert.match(html, /aria-label="Password"/);
assert.match(html, /aria-invalid="true"/);
assert.match(html, /aria-describedby="[^"]+-error"/);
assert.match(html, /role="alert"/);
assert.ok(![...evaluated].some(url => /@expo\/ui\/src\/(swift-ui|jetpack-compose)\//.test(url)), "native SDK evaluated");
`,
		],
		{
			cwd: new URL("../../", import.meta.url),
			encoding: "utf8",
			timeout: 30_000,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
});
