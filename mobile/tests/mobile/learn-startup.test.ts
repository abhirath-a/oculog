// biome-ignore-all lint/suspicious/noExplicitAny: Rendering-boundary harness, not native visual validation.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as model from "../../src/components/learning/hub-model";

const require = createRequire(import.meta.url);
const nativeTree = React.createContext(false);
function RN({ children }: any) {
	assert.equal(
		React.useContext(nativeTree),
		false,
		"RN view placed inside a native UI tree",
	);
	return React.createElement("div", null, children);
}
function Native({ children }: any) {
	assert.equal(React.useContext(nativeTree), true, "Native view needs a Host");
	return React.createElement("div", null, children);
}
function Host({ children }: any) {
	assert.equal(React.useContext(nativeTree), false, "Nested Host");
	return React.createElement(nativeTree.Provider, { value: true }, children);
}
const hooks = {
	...React,
	useEffect() {},
	useMemo: (fn: () => unknown) => fn(),
	useState: (initial: any) => [initial === 0 ? 250 : initial, () => {}],
	useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) =>
		snapshot(),
};
function load(path: string, mocks: Record<string, any>) {
	const exports: any = {};
	const code = readFileSync(
		new URL(`../../src/components/learning/${path}`, import.meta.url),
		"utf8",
	);
	runInNewContext(
		ts.transpileModule(code, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
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
const rn = {
	Platform: { OS: "ios" },
	View: RN,
	Text: RN,
	ScrollView: RN,
	Pressable: RN,
	ActivityIndicator: RN,
	StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
	useColorScheme: () => "light",
	Linking: { openURL: async () => {} },
};
const lessons = Array.from({ length: 5 }, (_, index) => ({
	id: `lesson-${index}`,
	title: `Lesson ${index}`,
	text: "Read the lesson.",
	questions: [],
}));
const status = { lessons, progress: {}, recommended_question: null };
const controller = {
	subscribe() {},
	getSnapshot: () => ({ status, busy: false, error: null }),
	getState: () => ({
		status,
		busy: false,
		error: null,
		pending: null,
		resetUncertain: false,
	}),
};
function harness() {
	const { TopicMap } = load("topic-map.tsx", {
		react: hooks,
		"react-native": rn,
		"@expo/ui": { Host, Column: Native, Row: Native },
		"./topic-node": {
			TopicNode: ({ title }: any) => React.createElement(Native, null, title),
		},
	});
	return load("hub-screen.tsx", {
		react: hooks,
		"react-native": rn,
		"@expo/ui/swift-ui": {
			Host,
			Button: ({ label }: any) => React.createElement(Native, null, label),
		},
		"@expo/ui/swift-ui/modifiers": Object.fromEntries(
			[
				"buttonBorderShape",
				"buttonStyle",
				"controlSize",
				"tint",
				"disabled",
			].map((name) => [name, (value: unknown) => ({ name, value })]),
		),
		"expo-crypto": { randomUUID: () => "test-id" },
		"expo-router": { useFocusEffect() {} },
		"../../lib/api": {
			request() {
				throw Error("No network in render");
			},
			sessionStore: { isValid: false },
		},
		"../../lib/learning-api": { learningAPI: () => ({ status() {} }) },
		"../../lib/learning-controller": {
			createLearningController: () => controller,
		},
		"./hub-controller": { createHubController: () => controller },
		"./hub-model": model,
		"../presentation/screen-frame": { ScreenFrame: RN },
		"../presentation/text": { PresentationText: RN },
		"./topic-map": { TopicMap },
	});
}

test("Learn hub starts with RN cards outside the native topic map Host", () => {
	const Hub = harness().default;
	const html = renderToStaticMarkup(
		React.createElement(Hub, { onBrowse() {}, onProducts() {} }),
	);
	assert.match(html, /Your learning path/);
	assert.match(html, /Lesson 4/);
	assert.match(html, /Start practice/);
});

test("inline practice starts in an RN frame, not a SwiftUI Form", () => {
	const { LearningPane } = harness();
	const html = renderToStaticMarkup(
		React.createElement(LearningPane, { onBack() {} }),
	);
	assert.match(html, /Continue learning/);
});

test("native-tree guard rejects the original RN-inside-Host crash pattern", () => {
	assert.throws(
		() =>
			renderToStaticMarkup(
				React.createElement(Host, null, React.createElement(RN)),
			),
		/RN view placed inside/,
	);
});

const nativePage = {
	NativePage: Host,
	NativeSection: Native,
	NativeRow: Native,
	NativeStack: Native,
	NativeText: Native,
	NativeAction: ({ label }: any) => React.createElement(Native, null, label),
};

test("Account overview is a presenter, not a recursive copy of Settings", () => {
	const { default: Overview } = load("../settings/overview-content.tsx", {
		"../native-page": nativePage,
		"./editor-link": {
			__esModule: true,
			default: () => React.createElement(Native, null, "Edit lens setup"),
		},
		"./overview-summary": {
			supportingLines: () => ["Left: 14 days", "Right: 14 days"],
		},
	});
	const html = renderToStaticMarkup(
		React.createElement(Overview, {
			model: {
				email: "synthetic@example.test",
				timeZone: "GMT",
				accountDisabled: false,
			},
			summary: "Both eyes · 14 days",
			onEdit() {},
		}),
	);
	assert.match(html, /synthetic@example.test/);
	assert.match(html, /Edit lens setup/);
	assert.match(html, /Sign out/);
});

test("Account loading and error cards cross explicit RNHostView boundaries", () => {
	for (const loading of [true, false]) {
		const { default: Settings } = load("../settings/screen.tsx", {
			react: hooks,
			"react-native": rn,
			"@expo/ui": {
				RNHostView: ({ children }: any) => {
					assert.equal(React.useContext(nativeTree), true);
					return React.createElement(
						nativeTree.Provider,
						{ value: false },
						children,
					);
				},
			},
			"expo-router": { useRouter: () => ({ push() {} }) },
			"../../lib/api": {
				sessionStore: { account: { id: "test" }, token: "synthetic" },
			},
			"../../lib/store": {
				useStore: () => ({
					account: { id: "test", email: "synthetic@example.test" },
					loading,
					pending: false,
				}),
			},
			"../native-page": nativePage,
			"./overview": { default: Native },
			"./summary": { lensSummary() {} },
			"./use-schedule-settings": {
				confirmedSignOut() {},
				useScheduleSettings() {},
			},
			"../ui": { useAction: () => ({ busy: false, error: "" }) },
		});
		const html = renderToStaticMarkup(React.createElement(Settings));
		assert.match(html, loading ? /Loading your lens settings/ : /Couldn/);
		assert.match(html, /Sign out/);
	}
});
