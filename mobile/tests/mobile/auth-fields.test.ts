import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const ui = "../../node_modules/@expo/ui/";
const source = read("../../src/components/auth/field.tsx");
type Node = {
	type: string;
	props: Record<string, unknown>;
};
const jsx = (type: string, props: Record<string, unknown>): Node => ({
	type,
	props,
});
function load(source: string, mocks: Record<string, unknown>) {
	const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
	runInNewContext(
		ts.transpileModule(source, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			__DEV__: false,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	return exports;
}
function installedModifiers(names: string[], platform: string) {
	// Execute the installed modifier factories, not replacements with guessed shapes.
	const code = read(`${ui}src/${platform}/modifiers/index.ts`);
	const ast = ts.createSourceFile(
		"modifiers.ts",
		code,
		ts.ScriptTarget.Latest,
		true,
	);
	const selected = ast.statements.filter(
		(statement) =>
			(ts.isFunctionDeclaration(statement) &&
				names.includes(statement.name?.getText(ast) ?? "")) ||
			(ts.isVariableStatement(statement) &&
				statement.declarationList.declarations.some((declaration) =>
					names.includes(declaration.name.getText(ast)),
				)),
	);
	return load(
		read(`${ui}src/swift-ui/modifiers/createModifier.ts`) +
			selected.map((statement) => statement.getText(ast)).join("\n"),
		{},
	);
}
const swift = installedModifiers(
	["font", "accessibilityLabel", "textFieldStyle", "frame"],
	"swift-ui",
);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function harness(platform: string) {
	const effects: (() => void)[] = [];
	const states: {
		value: string;
	}[] = [];
	const refs: {
		current: {
			focus(): void;
		} | null;
	}[] = [];
	const mocks = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": {
			Column: "Column",
			OutlinedTextField: Object.assign("OutlinedTextField", { Label: "Label" }),
			RNHostView: "RNHostView",
			TextInput: "TextInput",
			useNativeState: (value: string) => {
				const state = { value };
				states.push(state);
				return state;
			},
		},
		"@expo/ui/swift-ui/modifiers": swift,
		"react-native": { Platform: { OS: platform } },
		react: {
			useImperativeHandle: (
				ref:
					| {
							current: unknown;
					  }
					| undefined,
				create: () => unknown,
			) => {
				if (ref) ref.current = create();
			},
			useRef: () => {
				const ref = { current: null };
				refs.push(ref);
				return ref;
			},
			useEffect: (effect: () => void) => effects.push(effect),
		},
		"../presentation": {
			SemanticText: "SemanticText",
			usePresentationTheme: () => ({ divider: "gray", text: "black" }),
		},
		"../ui": { Field: "Field" },
	};
	return {
		effects,
		states,
		refs,
		render: load(read("../../src/components/auth/field.tsx"), mocks).AuthField,
	};
}
test("iOS auth uses native rounded field decoration, Dynamic Type and one compact target without universal borders", () => {
	for (const secure of [true, false]) {
		const h = harness("ios");
		let changed = "";
		const tree = h.render({
			label: secure ? "New password" : "Interval · days",
			value: "saved",
			secure,
			disabled: true,
			autoComplete: secure ? "new-password" : undefined,
			onChange: (value: string) => {
				changed = value;
			},
		});
		const field = (tree.props.children as Node[]).find(
			(node) => node.type === "TextInput",
		);
		assert.ok(field);
		assert.equal(field.props.secureTextEntry, secure);
		assert.equal(field.props.editable, false);
		assert.equal(field.props.value, h.states[0]);
		h.states[0].value = "old";
		for (const effect of h.effects) effect();
		assert.equal(h.states[0].value, "saved");
		(field.props.onChangeText as (value: string) => void)("typed");
		assert.equal(changed, "typed");
		const modifiers = plain(field.props.modifiers) as {
			$type: string;
			label?: string;
			textStyle?: string;
		}[];
		assert.deepEqual(modifiers.slice(0, 2), [
			{
				$type: "accessibilityLabel",
				label: secure ? "New password" : "Interval · days",
			},
			{ $type: "font", textStyle: "body" },
		]);
		assert.equal("fontSize" in (field.props.textStyle as object), false);
		assert.equal(field.props.style, undefined);
		assert.deepEqual(modifiers.slice(2), [
			{ $type: "textFieldStyle", style: "roundedBorder" },
			{ $type: "frame", minHeight: 44 },
		]);
		assert.equal(field.props.autoCorrect, false);
		assert.equal(field.props.autoCapitalize, "none");
		assert.equal(field.props.autoComplete, secure ? "new-password" : undefined);
	}
});
