import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { SimpleState } from "../../shared/simple-domain";
import * as model from "../../src/components/home/model";

type Element = { type: unknown; props: Record<string, unknown> };
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const element = node as Element;
	return [element, ...elements(element.props.children)];
}
const state: SimpleState = {
	today: "2026-04-01",
	timeZone: "UTC",
	daily: { localDate: "2026-04-01", worn: null },
	eyes: ["left", "right"].map((eye) => ({
		id: null,
		eye: eye as "left" | "right",
		replacementDays: 14,
		openedOn: "2026-03-01",
		dueOn: "2026-03-15",
		daysRemaining: -17,
		spareCount: 0,
	})),
};
function presenter(platform: "ios" | "android") {
	const source = readFileSync(
		new URL("../../src/components/home/HomeContent.tsx", import.meta.url),
		"utf8",
	);
	const jsx = (type: unknown, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const modifiers = Object.fromEntries(
		[
			"frame",
			"accessibilityLabel",
			"accessibilityValue",
			"accessibilityAddTraits",
			"semantics",
			"selectable",
			"selectableGroup",
			"weight",
		].map((name) => [name, (...args: unknown[]) => ({ name, args })]),
	);
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"react-native": {
			Platform: { OS: platform },
			useColorScheme: () => "dark",
			useWindowDimensions: () => ({ width: 390, fontScale: 1 }),
		},
		"../presentation": {
			SemanticText: "SemanticText",
			usePresentationEpoch: () => 0,
			usePresentationTheme: () => ({ background: "#000", primary: "#008080" }),
		},
		"./model": model,
		"@expo/ui": {
			Host: "Host",
			Column: "Column",
			Row: "Row",
			Button: "Button",
			FieldGroup: Object.assign(function FieldGroup() {}, {
				Section: "Section",
				SectionFooter: "SectionFooter",
			}),
		},
		"@expo/ui/swift-ui/modifiers": modifiers,
		"@expo/ui/jetpack-compose/modifiers": {
			...modifiers,
			fillMaxWidth: (fraction?: number) => ({
				$type: "fillMaxWidth",
				fraction,
			}),
		},
	};
	const choiceExports: Record<string, (props: unknown) => Element> = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL("../../src/components/home/daily-choice.tsx", import.meta.url),
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
			exports: choiceExports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./daily-choice"] = choiceExports;
	const exports: Record<string, (props: unknown) => Element> = {};
	runInNewContext(
		ts.transpileModule(source, {
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
	function expand(node: unknown): unknown {
		if (Array.isArray(node)) return node.map(expand);
		if (!node || typeof node !== "object" || !("props" in node)) return node;
		const element = node as Element;
		if (
			typeof element.type === "function" &&
			[
				exports.EyeCard,
				exports.DailyLogSection,
				choiceExports.DailyChoice,
			].includes(element.type as (props: unknown) => Element)
		)
			return expand(
				(element.type as (props: unknown) => Element)(element.props),
			);
		return {
			...element,
			props: { ...element.props, children: expand(element.props.children) },
		};
	}
	return {
		source,
		render: (props: model.HomeContentProps) =>
			expand(exports.default(props)) as Element,
	};
}
const base = {
	state,
	disabled: false,
	pairedEyes: false,
	onLog: (_value: boolean) => {},
	onReplace: (_eye: "left" | "right") => {},
	onSettings: () => {},
	onAdd: () => {},
};
for (const platform of ["ios", "android"] as const) {
	test(`${platform} shares one native scrollable group and vertically ordered intrinsic eye rows`, () => {
		const { source, render } = presenter(platform);
		assert.doesNotMatch(
			source,
			/<View|<RNHostView|<Txt|GlassEffect|Card\s+from|height:/,
		);
		const tree = render(base);
		assert.equal(tree.type, "Host");
		assert.equal(tree.props.colorScheme, "dark");
		assert.equal((tree.props.style as { flex: number }).flex, 1);
		if (platform === "android") assert.equal(tree.props.seedColor, undefined);
		const nodes = elements(tree);
		assert.equal(nodes.filter((node) => node.type === "Host").length, 1);
		assert.deepEqual(
			nodes
				.filter((node) => node.type === "Section")
				.map((node) => node.props.title),
			[undefined, "Lenses", undefined],
		);
		const text = nodes
			.filter((node) => node.type === "SemanticText")
			.map((node) => node.props.children)
			.join(" ");
		assert.match(text, /17 days overdue/);
		assert.match(text, /Replace on 2026-03-15/);
		assert.match(text, /17 days overdue/);
		assert.match(text, /Add spares to replace this lens/);
		assert.match(text, /Calendar deadlines do not change when you record No/);
		assert.equal(
			nodes.filter((node) => String(node.props.label).startsWith("Replace "))
				.length,
			0,
		);
		assert.equal(
			nodes.filter((node) => node.props.label === "Add spares").length,
			1,
		);
	});
	test(`${platform} daily choices are controlled, explicit, accessible and disabled callbacks cannot write`, () => {
		const { render } = presenter(platform);
		for (const worn of [null, true, false]) {
			const written: boolean[] = [];
			const props = {
				...base,
				state: { ...state, daily: { ...state.daily, worn } },
				onLog: (value: boolean) => written.push(value),
			};
			const choices = elements(render(props)).filter((node) =>
				["Yes", "No"].includes(String(node.props.label)),
			);
			assert.deepEqual(
				choices.map((node) => node.props.variant === "filled"),
				[worn === true, worn === false],
			);
			const mods = (node: Element) =>
				(node.props.modifiers ?? []) as { name: string; args: unknown[] }[];
			if (platform === "android") {
				assert.ok(
					elements(render(props)).some((node) =>
						mods(node).some((mod) => mod.name === "selectableGroup"),
					),
				);
				assert.deepEqual(
					choices.map(
						(node) =>
							mods(node).find((mod) => mod.name === "selectable")?.args[0],
					),
					[worn === true, worn === false],
				);
				for (const choice of choices) {
					const selection = mods(choice).find(
						(mod) => mod.name === "selectable",
					);
					assert.equal(selection?.args[2], "radioButton");
					assert.equal(typeof selection?.args[1], "function");
				}
			} else {
				assert.deepEqual(
					choices.map((node) =>
						mods(node).some(
							(mod) =>
								mod.name === "accessibilityAddTraits" &&
								(mod.args[0] as string[]).includes("isSelected"),
						),
					),
					[worn === true, worn === false],
				);
				assert.deepEqual(
					choices.map(
						(node) =>
							mods(node).find((mod) => mod.name === "accessibilityValue")
								?.args[0],
					),
					[
						worn === true ? "Selected" : "Not selected",
						worn === false ? "Selected" : "Not selected",
					],
				);
			}
			for (const choice of choices) (choice.props.onPress as () => void)();
			assert.deepEqual(written, [true, false]);
			for (const choice of elements(
				render({ ...props, disabled: true }),
			).filter((node) => ["Yes", "No"].includes(String(node.props.label)))) {
				assert.equal(choice.props.disabled, true);
				(choice.props.onPress as () => void)();
				const selection = mods(choice).find((mod) => mod.name === "selectable");
				if (selection) (selection.args[1] as () => void)();
			}
			assert.deepEqual(written, [true, false]);
		}
	});
}

test("web renders actual RN-web radio controls with checked and disabled DOM semantics", () => {
	const require = createRequire(import.meta.url);
	const source = readFileSync(
		new URL("../../src/components/home/daily-choice.tsx", import.meta.url),
		"utf8",
	);
	const rn = require("react-native-web");
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": require("react/jsx-runtime"),
		"react-native": { ...rn, Platform: { OS: "web" } },
		"@expo/ui": {},
		"@expo/ui/jetpack-compose/modifiers": {},
		"@expo/ui/swift-ui/modifiers": {},
		"../presentation": {
			usePresentationTheme: () => ({
				primary: "#146",
				onPrimary: "#fff",
				text: "#111",
				surface: "#fff",
			}),
		},
	};
	const exports: Record<
		string,
		(props: {
			worn: boolean | null;
			disabled: boolean;
			onLog: (value: boolean) => void;
		}) => ReturnType<typeof createElement>
	> = {};
	runInNewContext(
		ts.transpileModule(source, {
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
	for (const worn of [null, true, false]) {
		for (const disabled of [false, true]) {
			const written: boolean[] = [];
			const tree = exports.DailyChoice({
				worn,
				disabled,
				onLog: (value) => written.push(value),
			});
			const html = renderToStaticMarkup(tree);
			assert.match(html, /role="radiogroup"/);
			assert.match(html, /aria-label="Did you wear lenses today\?"/);
			assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
			assert.deepEqual(
				Array.from(
					html.matchAll(/aria-checked="(true|false)"/g),
					(match) => match[1],
				),
				[String(worn === true), String(worn === false)],
			);
			assert.equal(
				(html.match(/aria-disabled="true"/g) ?? []).length,
				disabled ? 2 : 0,
			);
			assert.match(html, /aria-label="Did you wear lenses today: Yes"/);
			assert.match(html, /aria-label="Did you wear lenses today: No"/);
			const controls = elements(tree).filter(
				(node) => node.props.accessibilityRole === "radio",
			);
			for (const control of controls) (control.props.onPress as () => void)();
			assert.deepEqual(written, disabled ? [] : [true, false]);
		}
	}
});

test("only the explicit Android Compose Home overrides shared native presentation", () => {
	assert.equal(
		existsSync(
			new URL(
				"../../src/components/home/HomeContent.android.tsx",
				import.meta.url,
			),
		),
		true,
	);
	for (const path of ["HomeContent.ios.tsx", "AddContactsForm.android.tsx"])
		assert.equal(
			existsSync(new URL(`../../src/components/home/${path}`, import.meta.url)),
			false,
		);
});
