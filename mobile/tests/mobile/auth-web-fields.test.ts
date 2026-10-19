import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { webTypography } from "../../src/components/presentation/web-typography";

type Element = { type: string; props: Record<string, unknown> };
function render(props: Record<string, unknown>) {
	const jsx = (type: string, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const mocks: Record<string, unknown> = {
		"../presentation/web-typography": { webTypography },
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react: {
			useId: () => "auth-email",
			useRef: () => ({ current: null }),
			useState: () => [true, () => {}],
			useImperativeHandle: () => {},
		},
		"../presentation": {
			usePresentationTheme: () => ({
				text: "black",
				surface: "white",
				primary: "blue",
				error: "red",
				divider: "gray",
			}),
		},
	};
	const exports = {} as {
		FormField: (props: Record<string, unknown>) => Element;
	};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/auth/form-field.web.tsx",
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
	return exports.FormField(props).props.children as Element[];
}

test("web auth associates labels and field feedback and preserves autofill and focus visibility", () => {
	const [label, input, help] = render({
		label: "Password",
		value: "short",
		secure: true,
		autoComplete: "new-password",
		error: "Password must be at least 8 characters.",
	});
	assert.equal(label.type, "label");
	assert.equal(label.props.htmlFor, input.props.id);
	assert.equal(input.type, "input");
	assert.equal(input.props.type, "password");
	assert.equal(input.props.autoComplete, "new-password");
	assert.equal(input.props["aria-invalid"], true);
	assert.equal(input.props["aria-describedby"], help.props.id);
	assert.equal(help.props.children, "Password must be at least 8 characters.");
	assert.equal(
		(input.props.style as { outline: string }).outline,
		"2px solid blue",
	);
});

test("web auth forwards edits and Enter without submitting during IME composition or when disabled", () => {
	let value = "";
	let submitted = 0;
	let prevented = 0;
	const props = {
		label: "Email",
		keyboardType: "email-address",
		onChange: (next: string) => {
			value = next;
		},
		onSubmitEditing: () => submitted++,
	};
	const [, input] = render(props);
	assert.equal(input.props.type, "email");
	(input.props.onChange as (event: unknown) => void)({
		currentTarget: { value: "person@example.com" },
	});
	assert.equal(value, "person@example.com");
	const key = (field: Element, isComposing: boolean) =>
		(field.props.onKeyDown as (event: unknown) => void)({
			key: "Enter",
			nativeEvent: { isComposing },
			preventDefault: () => prevented++,
		});
	key(input, true);
	assert.equal(submitted, 0);
	key(input, false);
	assert.equal(submitted, 1);
	assert.equal(prevented, 1);
	const [, disabled] = render({ ...props, disabled: true });
	key(disabled, false);
	assert.equal(disabled.props.disabled, true);
	assert.equal(submitted, 1);
});
