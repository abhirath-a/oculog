// biome-ignore-all lint/suspicious/noExplicitAny: Strict native JSX harness; no device/fidelity claim.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { todayPress } from "../../src/components/home/today-tokens";
import * as hubModel from "../../src/components/learning/hub-model";
import { safeLearningURL } from "../../src/lib/learning-api";

const require = createRequire(import.meta.url);
function load(path: string, mocks: Record<string, any>) {
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/${path}`, import.meta.url),
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
				assert.ok(name in mocks, `Unexpected native practice import ${name}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
test("actual native practice tree retains evidence and warning before genuine disabled native choices", () => {
	const jsx = { "react/jsx-runtime": require("react/jsx-runtime") };
	const buttons: any[] = [];
	const wrapper = ({ children }: any) =>
		React.createElement("section", null, children);
	const modifiers = Object.fromEntries(
		[
			"accessibilityAddTraits",
			"buttonStyle",
			"controlSize",
			"fixedSize",
			"font",
			"disabled",
			"foregroundStyle",
			"frame",
			"multilineTextAlignment",
			"padding",
			"tint",
		].map((name) => [name, (...args: any[]) => ({ name, args })]),
	);
	const action = load("home/today-action.tsx", {
		...jsx,
		"@expo/ui": {
			Button: (props: any) => {
				buttons.push(props);
				return wrapper(props);
			},
			Text: wrapper,
		},
		"@expo/ui/swift-ui/modifiers": modifiers,
		"../button-action-colors": {
			useButtonActionColors: () => ({
				accent: "teal",
				onAccent: "white",
				muted: "gray",
			}),
		},
		"./today-tokens": { todayPress },
	});
	const reference = {
		chunk_id: "source",
		content_sha256: "a".repeat(64),
		url: "https://www.cdc.gov/contact-lenses/",
		quote: "Official source quotation",
	};
	const question = {
		id: "q",
		lesson_id: "lesson",
		prompt: "Question prompt",
		options: [
			{ id: "a", text: "First statement" },
			{ id: "b", text: "Other statement" },
		],
	};
	const status = {
		lessons: [
			{
				id: "lesson",
				title: "Full lesson title",
				text: "Read the lesson source first",
				reference,
				questions: [question],
			},
		],
		progress: {},
		recommended_question: null,
	};
	const state = {
		status,
		feedback: {
			correct: false,
			explanation: "Feedback remains visible",
			reference,
		},
		busy: false,
		pending: null,
		resetUncertain: false,
		error: null,
	};
	const slots = ["lesson", question, false];
	let cursor = 0,
		answers = 0;
	const screen = load("learning/learning-screen.tsx", {
		...jsx,
		react: {
			...React,
			useEffect() {},
			useRef: () => ({ current: false }),
			useMemo: (f: any) => f(),
			useState: (initial: any) => [
				cursor < slots.length
					? slots[cursor++]
					: initial === false
						? true
						: initial,
				() => {},
			],
			useSyncExternalStore: () => state,
		},
		"expo-crypto": { randomUUID: () => "attempt" },
		"react-native": {
			Linking: { openURL: async () => {} },
			View: wrapper,
			Text: wrapper,
			ScrollView: wrapper,
			useColorScheme: () => "light",
			StyleSheet: { create: (s: unknown) => s },
		},
		"@expo/ui/swift-ui": {
			Host: wrapper,
			HStack: wrapper,
			Text: wrapper,
			Button: (props: any) => {
				buttons.push(props);
				return React.createElement(
					"button",
					null,
					props.label ?? props.children,
				);
			},
		},
		"@expo/ui/swift-ui/modifiers": modifiers,
		"../../lib/api": { request() {}, sessionStore: {} },
		"../../lib/learning-api": { learningAPI: () => ({}), safeLearningURL },
		"../../lib/learning-controller": {
			createLearningController: () => ({
				subscribe() {},
				getSnapshot() {},
				answer() {
					answers++;
				},
			}),
		},
		"./hub-model": hubModel,
		"../native-page": {
			NativePage: wrapper,
			NativeStack: wrapper,
			PageText: wrapper,
			NativeAction: action.TodayAction,
		},
	});
	const html = renderToStaticMarkup(React.createElement(screen.default));
	assert.match(html, /Full lesson title/);
	assert.match(html, /Official source quotation/);
	assert.match(html, /Not quite/);
	assert.match(html, /Feedback remains visible/);
	assert.ok(
		html.indexOf("Other options are not care instructions") <
			html.indexOf("First statement"),
	);
	const choices = buttons.filter((button) =>
		button.modifiers?.some((m: any) => m.name === "disabled"),
	);
	assert.equal(choices.length, 2);
	for (const choice of choices) {
		assert.ok(
			choice.modifiers.some(
				(m: any) => m.name === "buttonStyle" && m.args[0] === "plain",
			),
		);
		assert.ok(choice.modifiers.some((m: any) => m.name === "disabled"));
		choice.onPress();
	}
	assert.equal(answers, 0);
	assert.ok(
		buttons.every((button) =>
			button.modifiers.some((modifier: any) => modifier.name === "buttonStyle"),
		),
	);
});
