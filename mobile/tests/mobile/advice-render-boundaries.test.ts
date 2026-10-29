// biome-ignore-all lint/suspicious/noExplicitAny: Strict render-tree harness, not native device evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as chatLayout from "../../src/components/advice/chat-layout";

const require = createRequire(import.meta.url);
const nativeTree = React.createContext(false);
function RN({ children }: any) {
	assert.equal(
		React.useContext(nativeTree),
		false,
		"RN child inside native tree",
	);
	return React.createElement("div", null, children);
}
function Native({ children, label }: any) {
	assert.equal(React.useContext(nativeTree), true, "Native child without Host");
	return React.createElement("div", null, label, children);
}
function Host({ children }: any) {
	assert.equal(
		React.useContext(nativeTree),
		false,
		"Host directly inside native tree",
	);
	return React.createElement(nativeTree.Provider, { value: true }, children);
}
function Bridge({ children }: any) {
	assert.equal(React.useContext(nativeTree), true);
	return React.createElement(nativeTree.Provider, { value: false }, children);
}
function load(file: string, mocks: Record<string, any>) {
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/advice/${file}`, import.meta.url),
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
				if (name === "react/jsx-runtime") return require(name);
				assert.ok(name in mocks, `Unexpected dependency: ${name}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
function render(
	panel: string | null,
	reply: "answer" | "pending" | "error" | "empty",
) {
	let hook = 0;
	const hooks = {
		...React,
		useEffect() {},
		useState(value: any) {
			const index = hook++;
			return [
				index === 1 ? panel : typeof value === "function" ? value() : value,
				() => {},
			];
		},
		useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
			snapshot(),
	};
	const nativePage = {
		NativeContent: Host,
		NativeSection: Native,
		NativeRow: Native,
		NativeStack: Native,
		PageText: Native,
		NativeDisclosure: Native,
		PagePicker: Native,
	};
	const { AdviceAction } = load("advice-action.tsx", {
		"@expo/ui": { Host, Button: Native, Icon: Native },
		"@expo/ui/swift-ui/modifiers": {
			accessibilityLabel() {},
			buttonStyle() {},
			frame() {},
		},
	});
	const { EducationSettings } = load("education-settings.tsx", {
		react: { ...React, useState: (value: any) => [value, () => {}] },
		"../../lib/advice-chat-api": {
			providerReason: () => "Dedicated server key missing",
		},
		"../native-page": nativePage,
		"./advice-controls": { Button: Native, Toggle: Native },
		"./source-link": { SourceLink: Native },
	});
	const catalogue = {
		questions: [{ id: "cleaning", question: "How do I clean contacts?" }],
		disclaimer: "Education only",
		safety_notice: "Seek care for symptoms",
		presentation: {
			topics: [{ id: "cleaning", label: "Cleaning" }],
			lens_action: "Remove lenses for symptoms",
			caution: "Not diagnosis",
			triage: [
				{ level: "urgent", title: "Urgent symptoms", text: "Seek urgent care" },
			],
		},
	};
	const state = {
		catalogue,
		pending: reply === "pending",
		draft: "Preserved draft",
		catalogueLoading: false,
		exchanges:
			reply === "empty"
				? []
				: [
						{
							key: "turn",
							label: "How do contacts work?",
							error: reply === "error" ? "Network unavailable" : null,
							answer:
								reply === "answer"
									? {
											title: "AI reply",
											paragraphs: ["General lens explanation"],
											urgency: "unknown",
											related_question_ids: [],
											sources: [
												{
													title: "CDC",
													url: "https://www.cdc.gov/contact-lenses/",
												},
											],
										}
									: null,
						},
					],
	};
	const advice = {
		getState: () => state,
		subscribe() {},
		setDraft() {},
		clear() {},
		mount() {},
		dispose() {},
		loadCatalogue() {},
		syncIdentity() {},
	};
	const education = {
		getState: () => ({
			language: "en",
			enabled: false,
			busy: false,
			adultAck: false,
			externalConsent: false,
			status: {
				topics: [],
				provider: {
					configured: false,
					available: false,
					reason: "missing_dedicated_key",
				},
				disclosure: {
					version: "v3",
					text: "Current question only",
					terms_url: "https://ai.google.dev/gemini-api/terms",
				},
			},
		}),
		subscribe() {},
		options() {},
		load() {},
		mount() {},
		dispose() {},
		syncIdentity() {},
		setLanguage() {},
		setAdultAck() {},
		setExternalConsent() {},
	};
	const { default: Screen } = load("advice-screen.tsx", {
		react: hooks,
		"react-native": {
			View: RN,
			Text: RN,
			ScrollView: RN,
			TextInput: RN,
			KeyboardAvoidingView: RN,
			ActivityIndicator: RN,
			Platform: { OS: "ios" },
			useColorScheme: () => "light",
			useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }),
			StyleSheet: { create: (v: any) => v, hairlineWidth: 1 },
			Linking: { openURL: async () => {} },
		},
		"@expo/ui": {
			RNHostView: Bridge,
			BottomSheet: ({ children, isPresented }: any) =>
				isPresented ? React.createElement(Host, null, children) : null,
		},
		"react-native-safe-area-context": {
			useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
		},
		"../../lib/advice-api": { isSafeAdviceURL: () => true },
		"../../lib/advice-controller": { createAdviceController: () => advice },
		"../../lib/api": { request() {}, sessionStore: { account: null } },
		"../../lib/advice-chat-api": {
			chatAPI: () => ({}),
			chatAdviceAPI: () => ({}),
		},
		"../../lib/education-controller": {
			createEducationController: () => education,
		},
		"../native-page": nativePage,
		"./advice-action": { AdviceAction },
		"./education-settings": { EducationSettings },
		"./chat-layout": chatLayout,
	});
	return renderToStaticMarkup(React.createElement(Screen));
}

for (const reply of ["answer", "pending", "error", "empty"] as const) {
	test(`Advice ${reply} server state has valid RN/native boundaries`, () => {
		const html = render(null, reply);
		assert.match(html, /Oculog Assistant/);
		if (reply === "answer") assert.match(html, /General lens explanation/);
		if (reply === "error") assert.match(html, /Network unavailable/);
	});
}
for (const panel of ["settings", "safety", "questions", "about"]) {
	test(`Advice ${panel} panel has valid presentation and render-tree boundaries`, () => {
		const html = render(panel, "answer");
		assert.match(html, /Done/);
		if (panel === "settings")
			assert.match(html, /Dedicated server key missing/);
	});
}
