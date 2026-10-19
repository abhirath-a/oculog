import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: string; props: Record<string, any> };
const jsx = (type: string, props: Record<string, any>) => ({ type, props });
function elements(node: any): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node?.props) return [];
	return [node, ...elements(node.props.children)];
}
function harness() {
	const hooks: any[] = [];
	const effects: (() => void)[] = [];
	let cursor = 0;
	let hideCalls = 0;
	let expandCalls = 0;
	const completions: (() => void)[] = [];
	let closeCalls = 0;
	let dismissCalls = 0;
	const changes: string[] = [];
	const props = {
		presented: true,
		busy: false,
		disabled: false,
		locked: false,
		eye: "both",
		quantity: "3",
		error: "",
		reloading: false,
		action: { busy: false, error: "", message: "" },
		onRequestClose: () => closeCalls++,
		onDismiss: () => dismissCalls++,
		onEyeChange: (value: string) => changes.push(value),
		onQuantityChange: (value: string) => changes.push(value),
		onAdd: () => changes.push("add"),
		onReload: () => {},
	};
	const components = Object.fromEntries(
		["Column", "Host", "ModalBottomSheet", "OutlinedTextField", "Text"].map(
			(name) => [name, name],
		),
	);
	const mocks: Record<string, any> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": {
			Button: "Button",
			Picker: Object.assign(() => {}, { Item: "Item" }),
		},
		"@expo/ui/jetpack-compose": {
			...components,
			TextField: { Label: "Label" },
			useNativeState: (value: string) => {
				const i = cursor++;
				hooks[i] ??= { value };
				return hooks[i];
			},
		},
		"@expo/ui/jetpack-compose/modifiers": Object.fromEntries(
			["fillMaxWidth", "padding", "semantics", "verticalScroll"].map((name) => [
				name,
				(...args: any[]) => ({ name, args }),
			]),
		),
		"../presentation/theme": {
			usePresentationTheme: () => ({}),
			usePresentationPaletteHold: () => {},
		},
		"./model": { additionHint: () => "Each eye saves separately." },
		react: {
			useState: (initial: any) => {
				const i = cursor++;
				hooks[i] ??= initial;
				return [
					hooks[i],
					(v: any) => {
						hooks[i] = v;
					},
				];
			},
			useRef: (initial: any) => {
				const i = cursor++;
				hooks[i] ??= { current: initial };
				return hooks[i];
			},
			useEffect: (effect: () => any, deps: any[]) => {
				const i = cursor++;
				if (hooks[i] && deps.every((d, n) => Object.is(d, hooks[i].deps[n])))
					return;
				effects.push(() => {
					hooks[i]?.cleanup?.();
					hooks[i] = { deps, cleanup: effect() };
				});
			},
		},
	};
	const source = readFileSync(
		new URL(
			"../../src/components/home/AddContactsSheet.android.tsx",
			import.meta.url,
		),
		"utf8",
	);
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;
	const exports: any = {};
	runInNewContext(output, {
		exports,
		require: (name: string) => {
			assert.ok(name in mocks, name);
			return mocks[name];
		},
	});
	function render() {
		cursor = 0;
		const tree = exports.default(props);
		const modal = elements(tree).find((n) => n.type === "ModalBottomSheet");
		if (modal)
			modal.props.ref.current = {
				hide: () => {
					hideCalls++;
					return new Promise<void>((resolve) => completions.push(resolve));
				},
				expand: async () => {
					expandCalls++;
				},
			};
		else if (hooks[1]) hooks[1].current = null;
		for (const effect of effects.splice(0)) effect();
		return tree;
	}
	return {
		props,
		render,
		completions,
		changes,
		hideCalls: () => hideCalls,
		expandCalls: () => expandCalls,
		closeCalls: () => closeCalls,
		dismissCalls: () => dismissCalls,
		source,
	};
}
const modal = (tree: Element) =>
	elements(tree).find((n) => n.type === "ModalBottomSheet");

test("Android Add retains its modal until hide completes, with one persistent non-sizing Host", async () => {
	const h = harness();
	assert.ok(modal(h.render()));
	h.props.presented = false;
	assert.ok(modal(h.render()));
	assert.equal(h.hideCalls(), 1);
	assert.ok(modal(h.render()), "still alive before native completion");
	h.completions.shift()?.();
	await Promise.resolve();
	const tree = h.render();
	assert.equal(modal(tree), undefined);
	assert.equal(tree.type, "Host");
	assert.equal(tree.props.matchContents, undefined);
	assert.doesNotMatch(h.source, /<RNHostView|key=\{|setTimeout/);
	h.props.presented = true;
	h.render();
	assert.ok(modal(h.render()), "reopens without replacing the root Host");
});

test("a stale hide completion cannot remove a reopened Add sheet", async () => {
	const h = harness();
	h.render();
	h.props.presented = false;
	h.render();
	h.props.presented = true;
	h.render();
	assert.equal(
		h.expandCalls(),
		1,
		"must also reverse native hide, not just retain a hidden modal",
	);
	h.completions.shift()?.();
	await Promise.resolve();
	assert.ok(modal(h.render()));
});

test("busy Add blocks every native dismissal and form edit and shows one operation-specific status", () => {
	const h = harness();
	h.props.busy = h.props.disabled = h.props.action.busy = true;
	const tree = h.render();
	const sheet = modal(tree)!;
	assert.equal(sheet.props.sheetGesturesEnabled, false);
	assert.equal(sheet.props.properties.shouldDismissOnBackPress, false);
	assert.equal(sheet.props.properties.shouldDismissOnClickOutside, false);
	sheet.props.onDismissRequest();
	const close = elements(tree).find(
		(n) => n.type === "Button" && n.props.label === "Close",
	)!;
	close.props.onPress();
	assert.equal(close.props.disabled, true);
	assert.equal(h.dismissCalls(), 0);
	assert.equal(h.closeCalls(), 0);
	const field = elements(tree).find((n) => n.type === "OutlinedTextField")!;
	field.props.onValueChange("8");
	assert.equal(field.props.enabled, false);
	assert.deepEqual(h.changes, []);
	assert.equal(
		elements(tree).filter((n) => n.props.children === "Adding spares…").length,
		1,
	);
});

test("partial retry keeps inputs locked and exposes actual errors without claiming failure", () => {
	const h = harness();
	h.props.locked = true;
	h.props.action.error =
		"Delivery is unconfirmed. Retry to check the same request.";
	const tree = h.render();
	const field = elements(tree).find((n) => n.type === "OutlinedTextField")!;
	field.props.onValueChange("9");
	assert.equal(field.props.enabled, false);
	assert.deepEqual(h.changes, []);
	assert.ok(
		elements(tree).some(
			(n) => n.props.label === "Finish adding spares" && !n.props.disabled,
		),
	);
	assert.ok(
		elements(tree).some((n) => n.props.children === h.props.action.error),
	);
});
