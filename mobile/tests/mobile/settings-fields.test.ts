import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Node = { type: unknown; props: Record<string, any> };
function nodes(value: unknown): Node[] {
	if (Array.isArray(value)) return value.flatMap(nodes);
	if (!value || typeof value !== "object" || !("props" in value)) return [];
	const node = value as Node;
	return [node, ...nodes(node.props.children)];
}

function harness(platform: "ios" | "android" | "web") {
	const hooks: any[] = [];
	const deps: unknown[][] = [];
	let cursor = 0,
		focuses = 0,
		blurs = 0,
		fontScale = 1;
	const effects: (() => void)[] = [];
	const jsx = (type: unknown, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const field =
		platform === "web"
			? "input"
			: { Label: "Label", SupportingText: "SupportingText" };
	const native = {
		Button: "Button",
		HStack: "HStack",
		VStack: "VStack",
		Text: "Text",
		TextField: field,
		useNativeState: (value: string) => {
			const i = cursor++;
			hooks[i] ??= { value };
			return hooks[i];
		},
	};
	const react = {
		useId: () => "days",
		useRef: () => {
			const i = cursor++;
			hooks[i] ??= {
				current: {
					focus: async () => {
						focuses++;
					},
					blur: async () => {
						blurs++;
					},
				},
			};
			return hooks[i];
		},
		useState: (value: unknown) => {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = value;
			return [
				hooks[i],
				(next: unknown) => {
					hooks[i] = next;
				},
			];
		},
		useEffect: (effect: () => void, next: unknown[]) => {
			const i = cursor++;
			if (!deps[i] || next.some((v, k) => !Object.is(v, deps[i][k])))
				effects.push(effect);
			deps[i] = next;
		},
	};
	const modifiers = new Proxy(
		{},
		{ get: (_, key) => (value: unknown) => ({ [key]: value }) },
	);
	const mocks: Record<string, unknown> = {
		react,
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"react-native": { useWindowDimensions: () => ({ fontScale }) },
		"@expo/ui/swift-ui": native,
		"@expo/ui/jetpack-compose": native,
		"@expo/ui/swift-ui/modifiers": modifiers,
		"@expo/ui/jetpack-compose/modifiers": modifiers,
		"../presentation": {
			SemanticText: "SemanticText",
			usePresentationTheme: () => ({}),
		},
	};
	const exports = {} as { default: (props: unknown) => Node };
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					`../../src/components/settings/days${platform === "web" ? "" : `.${platform}`}.tsx`,
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
			requestAnimationFrame: (fn: () => void) => {
				fn();
				return 1;
			},
			cancelAnimationFrame: () => {},
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	const changes: string[] = [];
	const props = {
		validationEvent: 0,
		label: "Right eye · days",
		value: "",
		disabled: false,
		error: "",
		onChange: (value: string) => changes.push(value),
	};
	return {
		props,
		changes,
		field,
		focuses: () => focuses,
		blurs: () => blurs,
		scale: (value: number) => {
			fontScale = value;
		},
		render: () => {
			cursor = 0;
			const tree = exports.default(props);
			effects.splice(0).forEach((effect) => {
				effect();
			});
			return nodes(tree);
		},
	};
}

test("iOS interval field has no explicit native toolbar dependency", () => {
	const source = readFileSync(
		new URL("../../src/components/settings/days.ios.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /\bToolbar(?:Item)?\b/);
});

test("iOS focused Done only blurs, preserves native draft, and has an accessible growing target below the field", async () => {
	const h = harness("ios");
	h.props.value = "12";
	let tree = h.render();
	assert.ok(!tree.some((node) => node.type === "Button"));
	const input = tree.find((node) => node.type === h.field)!;
	input.props.text.value = "123";
	input.props.onTextChange("123");
	input.props.onFocusChange(true);
	tree = h.render();
	const done = tree.find((node) => node.type === "Button")!;
	assert.ok(
		done.props.modifiers.some(
			(m: any) => m.accessibilityLabel === `Done editing ${h.props.label}`,
		),
	);
	const label = nodes(done.props.children).find(
		(node) => node.props.children === "Done",
	)!;
	assert.ok(
		label.props.modifiers.some(
			(m: any) => m.frame?.minHeight >= 44 && m.frame?.minWidth >= 44,
		),
	);
	assert.ok(
		label.props.modifiers.some((m: any) => m.font?.textStyle === "body"),
	);
	assert.ok(
		label.props.modifiers.some((m: any) => m.fixedSize?.vertical === true),
	);
	assert.ok(
		!label.props.modifiers.some((m: any) => m.frame?.height !== undefined),
	);
	assert.ok(
		!tree.find((node) => node.type === "HStack")?.props.children.includes(done),
		"Done is outside the horizontal field row",
	);
	await done.props.onPress();
	await done.props.onPress();
	assert.equal(h.blurs(), 2, "each press calls the actual native ref blur");
	assert.equal(h.focuses(), 0);
	assert.equal(
		input.props.text.value,
		"123",
		"Done does not overwrite native text with the prop value",
	);
	assert.deepEqual(h.changes, ["123"], "Done does not write the draft");
	h.props.disabled = true;
	tree = h.render();
	assert.ok(
		tree
			.find((node) => node.type === "Button")!
			.props.modifiers.some((m: any) => m.disabled === true),
	);
	assert.ok(
		tree
			.find((node) => node.type === h.field)!
			.props.modifiers.some((m: any) => m.disabled === true),
	);
	assert.equal(input.props.text.value, "123");
	assert.deepEqual(h.changes, ["123"], "disabling does not write the draft");
	input.props.onFocusChange(false);
	assert.ok(!h.render().some((node) => node.type === "Button"));
	h.props.value = "24";
	h.render();
	assert.equal(
		input.props.text.value,
		"24",
		"external value synchronization remains intact",
	);
});

test("web refocuses the same invalid interval on each explicit validation event", () => {
	const h = harness("web");
	h.render();
	h.props.error = "Interval: enter a whole number from 1 to 365.";
	h.render();
	assert.equal(h.focuses(), 1);
	h.props.validationEvent++;
	h.render();
	assert.equal(h.focuses(), 2);
});

for (const platform of ["ios", "android"] as const) {
	test(`${platform} numeric field focuses inline validation and explicitly dismisses with Done`, async () => {
		const h = harness(platform);
		h.render();
		h.props.error = "Right interval: enter a whole number from 1 to 365.";
		h.props.disabled = true;
		h.render();
		assert.equal(h.focuses(), 0);
		h.props.disabled = false;
		let tree = h.render();
		await Promise.resolve();
		assert.equal(h.focuses(), 1);
		h.props.validationEvent++;
		h.render();
		await Promise.resolve();
		assert.equal(
			h.focuses(),
			2,
			"a repeated validation request refocuses the same error",
		);
		assert.ok(tree.some((node) => node.props.children === h.props.error));
		const input = tree.find((node) => node.type === h.field)!;
		if (platform === "ios") {
			input.props.onFocusChange(true);
			tree = h.render();
			const done = tree.find((node) => node.type === "Button")!;
			assert.ok(done);
			await done.props.onPress();
			input.props.onFocusChange(false);
			assert.ok(!h.render().some((node) => node.type === "Button"));
			h.scale(2);
			assert.ok(
				!h.render().some((node) => node.type === "HStack"),
				"large text uses a vertical row",
			);
		} else {
			assert.equal(input.props.keyboardOptions.imeAction, "done");
			await input.props.keyboardActions.onDone("");
		}
		assert.equal(h.blurs(), platform === "android" ? 3 : 1);
		assert.deepEqual(
			h.changes,
			[],
			"dismissal and validation never change the draft",
		);
	});
}
