// biome-ignore-all lint/suspicious/noExplicitAny: Strict VM/native render harness verifies actual page composition without a device.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as chatLayout from "../../src/components/advice/chat-layout";
import * as tokens from "../../src/components/home/today-tokens";
import * as overviewSummary from "../../src/components/settings/overview-summary";
import * as safeURL from "../../src/lib/advice-api";
import * as productData from "../../src/lib/product-mocks";

const require = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, any>) {
	const exports: any = {};
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
			require(name: string) {
				assert.ok(name in mocks, `Unexpected import ${name} in ${file}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
function harness() {
	const records: Record<string, any[]> = {};
	const control = (name: string) => (props: any) => {
		records[name] ??= [];
		records[name].push(props);
		return React.createElement("div", null, props.children);
	};
	const api: any = Object.fromEntries(
		[
			"Host",
			"Column",
			"Row",
			"Text",
			"Button",
			"Switch",
			"Picker",
			"ScrollView",
			"Icon",
			"BottomSheet",
			"RNHostView",
		].map((name) => [name, control(name)]),
	);
	api.FieldGroup = Object.assign(control("Form"), {
		Section: control("Section"),
	});
	api.Picker.Item = control("PickerItem");
	const label = control("DisclosureLabel");
	const Disclosure = Object.assign(
		(props: any) => {
			records.Disclosure ??= [];
			records.Disclosure.push(props);
			const children = React.Children.toArray(
				props.children,
			) as React.ReactElement<any>[];
			return React.createElement(
				"div",
				null,
				children.filter((child) => props.isExpanded || child.type === label),
			);
		},
		{ Label: label },
	);
	api.BottomSheet = (props: any) =>
		props.isPresented ? React.createElement("div", null, props.children) : null;
	const modifiers = Object.fromEntries(
		[
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
			"foregroundStyle",
			"glassEffect",
			"scrollDismissesKeyboard",
		].map((name) => [name, (...args: any[]) => ({ name, args })]),
	);
	const theme = {
		usePresentationTheme: () => ({
			background: "#000",
			surface: "#111",
			text: "#fff",
			secondary: "#aaa",
			primary: "#acf",
			onPrimary: "#000",
			error: "#faa",
		}),
	};
	const mocks: any = {
		react: React,
		"react/jsx-runtime": require("react/jsx-runtime"),
		"@expo/ui": api,
		"@expo/ui/swift-ui": { DisclosureGroup: Disclosure },
		"@expo/ui/swift-ui/modifiers": modifiers,
		"../../lib/api": {
			sessionStore: { account: { id: "synthetic" }, token: "token" },
		},
		"../../lib/store": { useStore: () => ({ account: { id: "synthetic" } }) },
		"../presentation/screen-frame": { ScreenFrame: control("ScreenFrame") },
		"../presentation/theme": theme,
		"./presentation/theme": theme,
		"./today-tokens": tokens,
		"react-native": {
			Platform: { OS: "ios", Version: "26.0" },
			View: control("MeasuredBoundary"),
			Linking: { openURL: async () => {} },
			AccessibilityInfo: { announceForAccessibility() {} },
		},
	};
	mocks["../button-action-colors"] = load("button-action-colors.ts", {
		"react-native": { useColorScheme: () => "light" },
	});
	mocks["./today-design-base"] = load("home/today-design-base.tsx", mocks);
	mocks["./today-action"] = load("home/today-action.tsx", mocks);
	mocks["./home/today-design"] = load("home/today-design.tsx", mocks);
	mocks["./presentation/screen-frame"] = {
		ScreenFrame: control("ScreenFrame"),
	};
	// Drive the actual measured page boundary with a finite layout proposal.
	mocks["../native-page"] = load("native-page.tsx", {
		...mocks,
		react: {
			...React,
			useState: (initial: any) =>
				React.useState(
					initial === null ? { width: 393, height: 680 } : initial,
				),
		},
	});
	mocks["../native-input"] = { __esModule: true, default: control("Input") };
	mocks["../../lib/advice-api"] = safeURL;
	mocks["../../lib/product-mocks"] = productData;
	mocks["./retailer-link"] = load("products/retailer-link-base.tsx", mocks);
	mocks["./overview-summary"] = overviewSummary;
	mocks["./editor-link"] = {
		__esModule: true,
		default: load("settings/editor-link.tsx", mocks).default,
	};
	mocks["./editor-date"] = { __esModule: true, default: control("Date") };
	mocks["../home/today-feedback"] = {
		__esModule: true,
		default: control("Feedback"),
	};
	mocks["../presentation/haptics"] = { notifySuccess: async () => {} };
	mocks["../home/today-design"] = mocks["./home/today-design"];
	mocks["../onboarding/page"] = load("onboarding/page.tsx", {
		...mocks,
		"../home/today-design": mocks["./home/today-design"],
		react: {
			...React,
			useState: (initial: any) =>
				React.useState(
					initial === null ? { width: 393, height: 680 } : initial,
				),
		},
	});
	mocks["./lens-setup-fields"] = load("settings/lens-setup-fields.tsx", mocks);
	const render = (component: any, props: any = {}) =>
		renderToStaticMarkup(React.createElement(component, props));
	return { mocks, records, render, load: (file: string) => load(file, mocks) };
}
const buttonLabel = (props: any): string => props.children.props.children;
const model = (disabled: boolean) => ({
	draft: {
		leftDays: "14",
		rightDays: "30",
		leftOpened: "2026-04-01",
		rightOpened: "",
		differentIntervals: true,
		differentDates: true,
	},
	disabled,
	accountDisabled: disabled,
	email: "a-very-long-account-name@example.synthetic.invalid",
	timeZone: "Pacific/Kiritimati",
	today: "2026-04-04",
	fieldErrors: {},
	savedEvent: 0,
	validationEvent: 0,
	error: "",
	accountError: "",
	message: "",
	loading: false,
	busy: false,
	connectionError: "",
	canLeave: () => true,
	save() {},
	signOut() {},
	reload() {},
	change() {},
});

test("Products renders one real iOS Form, grouped rows and always-visible essential hazards without cards", () => {
	const h = harness();
	const html = h.render(h.load("products/products-screen.tsx").default);
	assert.equal(h.records.Host.length, 1);
	assert.equal(h.records.Form.length, 1);
	assert.equal(h.records.ScrollView, undefined);
	assert.deepEqual(
		h.records.Section.map((section) => section.title),
		["Before choosing", "Product types"],
	);
	for (const product of productData.mockProducts) {
		assert.ok(html.includes(product.name));
		assert.ok(html.includes(product.cons[0]));
		assert.ok(html.includes(product.pros[0]));
		if (product.pros[1]) assert.equal(html.includes(product.pros[1]), false);
	}
	assert.ok(h.records.Disclosure.every((row) => row.isExpanded === false));
	assert.ok(h.records.Column.every((row) => !row.style?.borderWidth));
});

test("Settings Account is static native text; edit/sign-out are bounded actions and disabled callbacks are guarded", () => {
	for (const disabled of [true, false]) {
		const h = harness();
		let edits = 0;
		let signouts = 0;
		const m = { ...model(disabled), signOut: () => signouts++ };
		const html = h.render(h.load("settings/overview-content.tsx").default, {
			model: m,
			summary: "Both eyes · 14 days\nNo open lenses",
			onEdit: () => edits++,
		});
		assert.equal(h.records.Host.length, 1);
		assert.equal(h.records.Form.length, 1);
		assert.ok(html.includes(m.email));
		assert.ok(html.includes(m.timeZone));
		assert.ok(html.includes("Left: 14 days"));
		assert.ok(html.includes("Right: 14 days"));
		assert.deepEqual(h.records.Button.map(buttonLabel), [
			"Edit lens setup",
			"Sign out",
		]);
		assert.deepEqual(
			h.records.Button.map((button) => button.variant),
			["filled", "outlined"],
		);
		for (const button of h.records.Button) button.onPress();
		assert.equal(edits, disabled ? 0 : 1);
		assert.equal(signouts, disabled ? 0 : 1);
		assert.equal(h.records.Input, undefined);
		assert.equal(h.records.Disclosure, undefined);
	}
});

test("lens editor keeps per-eye fields controlled, server date bounds, one scroller, one primary and save guards", () => {
	for (const disabled of [true, false]) {
		const h = harness();
		let saves = 0;
		const changes: any[] = [];
		const m = {
			...model(disabled),
			save: () => saves++,
			change: (...args: any[]) => changes.push(args),
		};
		h.render(h.load("settings/editor-form.tsx").default, { model: m });
		assert.equal(h.records.Host.length, 1);
		assert.equal(h.records.Form, undefined);
		assert.equal(h.records.ScrollView.length, 1);
		assert.deepEqual(
			h.records.Input.map((input) => input.value),
			["14", "30"],
		);
		assert.deepEqual(
			h.records.Date.map((date) => date.value),
			["2026-04-01", ""],
		);
		assert.ok(
			h.records.Date.every(
				(date) => date.maximum === m.today && date.disabled === disabled,
			),
		);
		assert.equal(
			h.records.Button.filter((button) => button.variant === "filled").length,
			1,
		);
		h.records.Button.find(
			(button) => buttonLabel(button) === "Save changes",
		).onPress();
		assert.equal(saves, disabled ? 0 : 1);
		for (const toggle of h.records.Switch) toggle.onValueChange(!toggle.value);
		assert.equal(changes.length, disabled ? 0 : 2);
	}
});

test("Advice retains a bounded controlled composer and disables duplicate sends while pending", () => {
	const h = harness();
	Object.assign(
		h.mocks["react-native"],
		Object.fromEntries(
			[
				"ActivityIndicator",
				"KeyboardAvoidingView",
				"ScrollView",
				"Text",
				"TextInput",
				"View",
			].map((name) => [
				name,
				(props: any) => {
					h.records[name] ??= [];
					h.records[name].push(props);
					return React.createElement("div", null, props.children);
				},
			]),
		),
	);
	Object.assign(h.mocks["react-native"], {
		StyleSheet: { create: (s: any) => s },
		useColorScheme: () => "light",
		useWindowDimensions: () => ({ fontScale: 1, width: 393, height: 680 }),
	});
	h.mocks["react-native-safe-area-context"] = {
		useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
	};
	h.mocks["../../lib/advice-chat-api"] = {
		chatAPI: () => ({}),
		chatAdviceAPI: () => ({}),
	};
	h.mocks["./chat-layout"] = chatLayout;
	h.mocks["./advice-action"] = {
		AdviceAction: (props: any) => {
			h.records.AdviceAction ??= [];
			h.records.AdviceAction.push(props);
			return React.createElement("button", null, props.label);
		},
	};
	const catalogue = JSON.parse(
		readFileSync(
			new URL("../../../backend/advice.json", import.meta.url),
			"utf8",
		),
	);
	const chatState = {
		catalogue,
		catalogueLoading: false,
		catalogueError: "",
		draft: "A question",
		pending: true,
		exchanges: [],
		notice: "",
	};
	const educationState = {
		language: "en",
		enabled: false,
		status: null,
		error: null,
		loading: false,
	};
	let sends = 0;
	h.mocks["../../lib/advice-controller"] = {
		createAdviceController: () => ({
			sendMessage: () => {
				sends++;
			},
			subscribe: () => () => {},
			getState: () => chatState,
		}),
	};
	h.mocks["../../lib/education-controller"] = {
		createEducationController: () => ({
			subscribe: () => () => {},
			getState: () => educationState,
			options() {},
		}),
	};
	h.mocks["../../lib/education-api"] = {
		educationAPI: () => ({}),
		educationAdviceAPI: () => ({}),
	};
	h.mocks["../../lib/api"] = {
		sessionStore: { account: { id: "synthetic" }, token: "synthetic-token" },
	};
	h.mocks["./advice-controls"] = h.load("advice/advice-controls-base.tsx");
	h.mocks["./education-answer"] = { EducationAnswer: () => null };
	h.mocks["./education-settings"] = { EducationSettings: () => null };
	h.mocks["./source-link"] = { SourceLink: () => null };
	h.render(h.load("advice/advice-screen.tsx").default, {
		onPractice() {},
	});
	assert.equal(h.records.TextInput.length, 1);
	assert.equal(h.records.TextInput[0].maxLength, 1000);
	assert.equal(h.records.TextInput[0].multiline, true);
	assert.equal(h.records.TextInput[0].value, "A question");
	const send = h.records.AdviceAction.find(
		(action) => action.label === "Send question",
	);
	assert.ok(send);
	assert.equal(send.disabled, true);
	send.onPress();
	send.onPress();
	assert.equal(sends, 0, "pending requests reject duplicate send callbacks");
	assert.equal(h.records.ScrollView.length, 1);
});

test("iOS numeric editor retains explicit Done/blur, semantic type, focus handles and disabled edit guards", () => {
	let focused = false;
	let blurs = 0;
	let focuses = 0;
	const changes: string[] = [];
	const inputRef: any = { current: null };
	const internal = {
		current: {
			focus: () => focuses++,
			blur: () => blurs++,
			clear() {},
			isFocused: () => focused,
			setSelection: async () => {},
		},
	};
	const jsx = (type: any, props: any) => ({ type, props });
	const mocks: any = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": {
			TextInput: "Input",
			useNativeState: (value: string) => ({ value }),
		},
		"@expo/ui/swift-ui/modifiers": Object.fromEntries(
			["accessibilityLabel", "font", "frame"].map((name) => [
				name,
				(...args: any[]) => ({ name, args }),
			]),
		),
		"./native-page": {
			NativeStack: "Stack",
			NativeText: "Text",
			NativeAction: "Action",
		},
		"./presentation/theme": { usePresentationTheme: () => ({ text: "#fff" }) },
		react: {
			useEffect: (fn: any) => fn(),
			useRef: () => internal,
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
	const Input = load("native-input.tsx", mocks).default;
	const walk = (node: any): any[] =>
		Array.isArray(node)
			? node.flatMap(walk)
			: node?.props
				? [node, ...walk(node.props.children)]
				: [];
	const props = {
		label: "Left eye · days",
		value: "14",
		disabled: false,
		inputRef,
		keyboardType: "number-pad",
		onChange: (value: string) => changes.push(value),
	};
	let tree = Input(props);
	let input = walk(tree).find((node) => node.type === "Input");
	assert.equal(
		walk(tree).some((node) => node.type === "Action"),
		false,
	);
	assert.equal(
		input.props.modifiers.find((modifier: any) => modifier.name === "font")
			.args[0].textStyle,
		"body",
	);
	assert.equal(
		input.props.modifiers.find((modifier: any) => modifier.name === "frame")
			.args[0].minHeight,
		44,
	);
	inputRef.current.focus();
	assert.equal(focuses, 1);
	input.props.onFocus();
	tree = Input(props);
	const done = walk(tree).find((node) => node.type === "Action");
	assert.equal(
		done.props.label,
		"Done editing Left eye · days",
		"NativeAction renders only label; field context must not be passed in an ignored prop",
	);
	done.props.onPress();
	assert.equal(blurs, 1);
	assert.deepEqual(changes, []);
	input.props.onChangeText("30");
	assert.deepEqual(changes, ["30"]);
	tree = Input({ ...props, disabled: true });
	inputRef.current.focus();
	assert.equal(focuses, 1);
	input = walk(tree).find((node) => node.type === "Input");
	input.props.onChangeText("40");
	walk(tree)
		.find((node) => node.type === "Action")
		.props.onPress();
	assert.equal(blurs, 1);
	assert.deepEqual(changes, ["30"]);
});

test("new page compositions have no RN controls or per-action Hosts beneath their measured boundary", () => {
	for (const path of [
		"advice/education-answer.tsx",
		"advice/education-settings.tsx",
		"products/products-screen.tsx",
		"settings/overview-content.tsx",
	]) {
		const source = readFileSync(
			new URL(`../../src/components/${path}`, import.meta.url),
			"utf8",
		);
		assert.doesNotMatch(
			source,
			/<View|<Pressable|<ScrollView|<Host|RNHostView|ToolbarView|numberOfLines/,
		);
	}
	const source = readFileSync(
		new URL("../../src/components/native-page.tsx", import.meta.url),
		"utf8",
	);
	assert.match(source, /onLayout/);
	assert.match(source, /Number.isFinite/);
	assert.doesNotMatch(source, /useWindowDimensions/);
});
