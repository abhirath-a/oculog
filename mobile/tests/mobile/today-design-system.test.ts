// biome-ignore-all lint/suspicious/noExplicitAny: VM/native mock props cross an intentionally untyped runtime boundary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as tokens from "../../src/components/home/today-tokens";
const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");
const theme = {
	primary: "#1D655C",
	onPrimary: "#FFFFFF",
	surface: "#FFFFFF",
	text: "#000000",
	secondary: "#636366",
	divider: "#8E8E93",
	background: "#F2F2F7",
};
function loadPath(path: string, mocks: Record<string, unknown>) {
	const exports: Record<string, any> = {};
	runInNewContext(
		ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			require(name: string) {
				assert.ok(name in mocks, `Unexpected import: ${name}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
function load(file: string, mocks: Record<string, unknown>) {
	return loadPath(`../../src/components/home/${file}`, mocks);
}
let dark = false;
const colorHelper = loadPath("../../src/components/button-action-colors.ts", {
	"react-native": { useColorScheme: () => (dark ? "dark" : "light") },
});
const shared = {
	"../button-action-colors": colorHelper,
	react: React,
	"react/jsx-runtime": require("react/jsx-runtime"),
	"./today-tokens": tokens,
	"../presentation/theme": { usePresentationTheme: () => theme },
};
function harness() {
	const records: Record<string, any[]> = {};
	const control = (name: string) => (props: any) => {
		records[name] ??= [];
		records[name].push(props);
		return React.createElement("div", null, props.children);
	};
	const api: Record<string, any> = Object.fromEntries(
		[
			"Host",
			"Text",
			"Column",
			"Row",
			"ScrollView",
			"Button",
			"Collapsible",
		].map((name) => [name, control(name)]),
	);
	api.FieldGroup = Object.assign(control("FieldGroup"), {
		Section: control("Section"),
	});
	const disclosure = Object.assign(control("DisclosureGroup"), {
		Label: control("DisclosureLabel"),
	});
	const modifierNames = [
		"font",
		"fixedSize",
		"frame",
		"disabled",
		"accessibilityAddTraits",
		"buttonStyle",
		"controlSize",
		"multilineTextAlignment",
		"padding",
		"tint",
		"defaultMinSize",
		"fillMaxWidth",
		"semantics",
		"foregroundStyle",
	];
	const modifiers = Object.fromEntries(
		modifierNames.map((name) => [
			name,
			(...args: any[]) => ({ $type: name, args }),
		]),
	);
	const mocks: Record<string, any> = {
		...shared,
		"@expo/ui": api,

		"@expo/ui/swift-ui": { DisclosureGroup: disclosure },
		"@expo/ui/swift-ui/modifiers": modifiers,
	};
	const base = load("today-design-base.tsx", mocks);
	mocks["./today-design-base"] = base;
	mocks["./today-action"] = { TodayAction: control("Action") };
	return { records, api, mocks, base };
}
test("iOS native tree has one bounded Host and real Form/Section/DisclosureGroup; no RN/native bridge imports", () => {
	const { mocks, records } = harness();
	const design = load("today-design.tsx", mocks);
	renderToStaticMarkup(
		React.createElement(
			design.TodaySurface,
			{ width: 361, height: 700 },
			React.createElement(
				design.TodaySection,
				{ title: "Lenses" },
				React.createElement(
					design.TodayRow,
					{},
					React.createElement(design.TodayText, { role: "headline" }, "Left"),
				),
				React.createElement(
					design.TodayDisclosure,
					{ label: "Lens details", expanded: false, onExpandedChange() {} },
					"Metadata",
				),
			),
		),
	);
	assert.equal(records.Host.length, 1);
	assert.equal(records.Host[0].style.width, 361);
	assert.equal(records.Host[0].style.height, 700);
	assert.equal(records.Host[0].matchContents, undefined);
	assert.equal(records.FieldGroup.length, 1);
	assert.equal(records.ScrollView, undefined);
	assert.equal(records.Section[0].title, "Lenses");
	assert.equal(records.DisclosureGroup[0].isExpanded, false);
	const font = records.Text[0].modifiers.find((m: any) => m.$type === "font");
	assert.equal(font.args[0].textStyle, "headline");
	assert.equal(font.args[0].size, undefined);
});
test("sheet native Form inherits its Host constraints, without another Host, RNHostView or window dimensions", () => {
	const { mocks, records, base } = harness();
	const design = load("today-design.tsx", mocks);
	renderToStaticMarkup(
		React.createElement(
			design.TodayForm,
			{},
			React.createElement(design.TodayText, {}, "Quantity"),
		),
	);
	assert.equal(records.Host, undefined);
	assert.equal(records.FieldGroup[0].style.width, "100%");
	assert.equal(records.FieldGroup[0].style.height, "100%");
	for (const [w, h] of [
		[Infinity, 700],
		[361, NaN],
		[0, 700],
		[361, -1],
	])
		assert.throws(() => base.assertTodaySize(w, h), /finite measured parent/);
});
test("iOS universal action applies native glass, controlled selection and a large intrinsic target without a Host", () => {
	for (const emphasis of ["primary", "secondary"]) {
		const { mocks, records } = harness();
		const { TodayAction } = load("today-action.tsx", mocks);
		let writes = 0;
		renderToStaticMarkup(
			React.createElement(TodayAction, {
				label: "Replace left lens",
				emphasis,
				disabled: true,
				selected: true,
				onPress() {
					writes++;
				},
			}),
		);
		assert.equal(records.Host, undefined);
		const button = records.Button[0];
		assert.equal(
			button.variant,
			emphasis === "primary" ? "filled" : "outlined",
		);
		assert.equal(
			button.modifiers.find((m: any) => m.$type === "buttonStyle").args[0],
			"glassProminent",
		);
		assert.equal(
			button.modifiers.find((m: any) => m.$type === "tint").args[0],
			colorHelper.buttonActionColors(dark).muted,
		);
		assert.equal(
			button.modifiers.find((m: any) => m.$type === "controlSize").args[0],
			"large",
		);
		assert.ok(
			button.modifiers.some(
				(m: any) =>
					m.$type === "accessibilityAddTraits" &&
					m.args[0].includes("isSelected"),
			),
		);
		assert.equal(button.disabled, true);
		button.onPress();
		assert.equal(writes, 0);
	}
});
test("actual SDK58 iOS universal Button preserves explicit glass native modifier instead of plain styling", () => {
	const { mocks, records } = harness();
	const modifierUtils = loadPath(
		"../../node_modules/@expo/ui/src/universal/modifierUtils.ts",
		{},
	);
	const swiftButton = (props: any) => {
		records.SwiftButton ??= [];
		records.SwiftButton.push(props);
		return React.createElement("div", null, props.children);
	};
	const sdk = loadPath(
		"../../node_modules/@expo/ui/src/universal/Button/index.ios.tsx",
		{
			...shared,
			"@expo/ui/swift-ui": { Button: swiftButton },
			"@expo/ui/swift-ui/modifiers": mocks["@expo/ui/swift-ui/modifiers"],
			"../modifierUtils": modifierUtils,
			"../transformStyle": {
				transformToModifiers: (
					_style: unknown,
					_props: unknown,
					extra: unknown,
				) => extra,
			},
			"./types": {},
		},
	);
	mocks["@expo/ui"] = { ...mocks["@expo/ui"], Button: sdk.Button };
	const { TodayAction } = load("today-action.tsx", mocks);
	for (const emphasis of ["primary", "secondary"])
		renderToStaticMarkup(
			React.createElement(TodayAction, {
				label: "Set up lenses",
				emphasis,
				onPress() {},
			}),
		);
	assert.equal(
		records.SwiftButton[0].modifiers.filter(
			(m: any) => m.$type === "buttonStyle",
		).length,
		1,
	);
	assert.equal(
		records.SwiftButton[0].modifiers.find((m: any) => m.$type === "buttonStyle")
			.args[0],
		"glass",
	);
	assert.equal(
		records.SwiftButton[1].modifiers.find((m: any) => m.$type === "buttonStyle")
			.args[0],
		"glass",
	);
});
test("enabled vs disabled actual action JSX uses teal semantics in both schemes and guards callbacks", () => {
	for (const scheme of [false, true]) {
		dark = scheme;
		const colors = colorHelper.buttonActionColors(dark);
		for (const platform of ["ios"]) {
			for (const emphasis of ["primary", "secondary"]) {
				for (const disabled of [false, true]) {
					const { mocks, records } = harness();
					const { TodayAction } = load(`today-action.tsx`, mocks);
					let writes = 0;
					const element = TodayAction({
						label: "Long wrapping action",
						emphasis,
						disabled,
						onPress() {
							writes++;
						},
					});
					{
						renderToStaticMarkup(element);
						const button =
							records.Button?.[0] ?? records.Filled?.[0] ?? records.Tonal?.[0];
						assert.equal(
							button.modifiers.find((m: any) => m.$type === "tint").args[0],
							disabled ? colors.muted : colors.accent,
						);
						(button.onPress ?? button.onClick)();
					}
					assert.equal(writes, disabled ? 0 : 1);
				}
			}
		}
	}
	dark = false;
});
test("actual practice confirmation reaches SDK native buttons with red primary, teal Keep and guarded callbacks in both schemes", () => {
	for (const scheme of [false, true]) {
		dark = scheme;
		const colors = colorHelper.buttonActionColors(dark);
		for (const platform of ["ios"]) {
			for (const disabled of [false, true]) {
				const { mocks, records } = harness();
				{
					const utils = loadPath(
						"../../node_modules/@expo/ui/src/universal/modifierUtils.ts",
						{},
					);
					const sdk = loadPath(
						"../../node_modules/@expo/ui/src/universal/Button/index.ios.tsx",
						{
							...shared,
							"@expo/ui/swift-ui": {
								Button: (props: any) => {
									records.Native ??= [];
									records.Native.push(props);
									return React.createElement("div", null, props.children);
								},
							},
							"@expo/ui/swift-ui/modifiers":
								mocks["@expo/ui/swift-ui/modifiers"],
							"../modifierUtils": utils,
							"../transformStyle": {
								transformToModifiers: (_s: any, props: any, extra: any[]) => [
									...extra,
									{ $type: "disabled", args: [props.disabled] },
								],
							},
							"./types": {},
						},
					);
					mocks["@expo/ui"].Button = sdk.Button;
				}
				const { TodayAction } = load(`today-action.tsx`, mocks);
				const actions: Record<string, any> = {};
				let resets = 0,
					slot = 0;
				const wrapper = ({ children }: any) =>
					React.createElement("section", null, children);
				const screen = loadPath(
					"../../src/components/learning/learning-screen.tsx",
					{
						...shared,
						react: {
							...React,
							useEffect() {},
							useRef: () => ({ current: false }),
							useMemo: (f: any) => f(),
							useState: () => [
								[null, null, null, true, false, true][slot++],
								() => {},
							],
							useSyncExternalStore: () => ({
								status: {
									lessons: [],
									progress: {},
									recommended_question: null,
								},
								busy: disabled,
								pending: null,
								resetUncertain: false,
								error: null,
							}),
						},
						"expo-crypto": { randomUUID: () => "attempt" },
						"@expo/ui/swift-ui": {
							Host: wrapper,
							HStack: wrapper,
							Text: wrapper,
							Button: (props: any) => {
								records.Native ??= [];
								records.Native.push(props);
								return React.createElement(
									"div",
									null,
									props.label,
									props.children,
								);
							},
						},
						"@expo/ui/swift-ui/modifiers": mocks["@expo/ui/swift-ui/modifiers"],
						"react-native": {
							Linking: {},
							ScrollView: wrapper,
							View: wrapper,
							Text: wrapper,
							useColorScheme: () => (dark ? "dark" : "light"),
							StyleSheet: { create: (styles: any) => styles, hairlineWidth: 1 },
						},
						"../../lib/api": { request() {}, sessionStore: {} },
						"../../lib/learning-api": { learningAPI: () => ({}) },
						"../../lib/learning-controller": {
							createLearningController: () => ({
								reset() {
									resets++;
								},
							}),
						},
						"./hub-model": {},
						"../native-page": {
							NativePage: wrapper,
							NativeStack: wrapper,
							PageText: wrapper,
							NativeAction: (props: any) => {
								const element = TodayAction(props);
								actions[props.label] = element;
								return element;
							},
						},
					},
				);
				const html = renderToStaticMarkup(React.createElement(screen.default));
				assert.match(html, /Confirm reset/);
				{
					const buttons = records.Native;
					const red = buttons.find((p: any) => p.label === "Confirm reset");
					const keep = buttons.find((p: any) => p.label === "Keep progress");
					assert.equal(red.role, "destructive");
					assert.equal(
						red.modifiers.find((m: any) => m.$type === "tint").args[0],
						"#DC3545",
					);
					assert.equal(
						red.modifiers.find((m: any) => m.$type === "buttonStyle").args[0],
						"borderedProminent",
					);
					assert.equal(
						keep.modifiers.find((m: any) => m.$type === "buttonStyle").args[0],
						"bordered",
					);
					assert.equal(
						red.modifiers.some((m: any) => m.$type === "disabled"),
						disabled,
					);
					red.onPress();
				}
				assert.equal(resets, disabled ? 0 : 1);
			}
		}
	}
	dark = false;
});
function luminance(hex: string) {
	const channels = hex.slice(1).match(/../g);
	assert.ok(channels);
	const rgb = channels
		.map((n) => parseInt(n, 16) / 255)
		.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
	return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
test("light/dark primary and secondary text maintain WCAG normal-text contrast", () => {
	for (const dark of [false, true]) {
		const c = colorHelper.buttonActionColors(dark);
		for (const [fg, bg] of [
			[c.accent, c.secondaryFill],
			[c.onAccent, c.accent],
			[c.danger, c.dangerFill],
			[c.onDanger, c.danger],
		]) {
			const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
			assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5);
		}
	}
});
test("static universal text and rows have no action handler, line cap or decorative border", () => {
	const { base, records } = harness();
	renderToStaticMarkup(
		React.createElement(
			base.TodayRow,
			{ separated: true },
			React.createElement(base.TodayText, {}, "Due today"),
		),
	);
	assert.equal(records.Text[0].onPress, undefined);
	assert.equal(records.Text[0].numberOfLines, undefined);
	assert.equal(records.Column[1].style.height, 0.5);
	assert.equal(records.Column[1].style.borderWidth, undefined);
});
