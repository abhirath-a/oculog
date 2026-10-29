// biome-ignore-all lint/suspicious/noExplicitAny: Strict JSX harness captures native adapter contracts, not device appearance.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createHubController } from "../../src/components/learning/hub-controller";
import {
	hubSelection,
	initialPracticeSelection,
	lifetimeSummary,
	recommendationReasons,
	topicRows,
} from "../../src/components/learning/hub-model";
import type { LearningStatus } from "../../src/lib/learning-api";

const require = createRequire(import.meta.url);
const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");
function load(path: string, mocks: Record<string, any>) {
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(source(path), {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			require(name: string) {
				assert.ok(name in mocks, `Unexpected import ${name}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
const { buttonActionColors } = load("components/button-action-colors.ts", {
	"react-native": { useColorScheme: () => "light" },
});
function status(count = 5): LearningStatus {
	const lessons = Array.from({ length: count }, (_, index) => ({
		id: `topic-${index}`,
		title: `Topic ${index} with a full accessible title`,
		text: "Read source before choices",
		reference: {
			chunk_id: "source",
			content_sha256: "a".repeat(64),
			url: "https://www.cdc.gov/contact-lenses/",
			quote: "Source quotation",
		},
		questions: [
			{
				id: `question-${index}`,
				lesson_id: `topic-${index}`,
				prompt: "Which statement?",
				options: [
					{ id: "a", text: "One" },
					{ id: "b", text: "Two" },
				],
			},
		],
	}));
	return {
		version: 1,
		generation: 0,
		policy_revision: "rules",
		source_bank_revision: "bank",
		corpus_revision: "corpus",
		review_status: "source-grounded-not-clinician-validated",
		lessons,
		progress: {},
		recommended_question: lessons[2]?.questions[0]
			? { ...lessons[2].questions[0], reason: "unanswered" }
			: null,
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

test("hub selection uses matching recommendation, preserves explicit selection, and handles actual counts", () => {
	for (const count of [1, 3, 5, 8]) {
		const value = status(count);
		assert.equal(
			hubSelection(value, null)?.id,
			count > 2 ? "topic-2" : "topic-0",
		);
		assert.equal(hubSelection(value, "topic-0")?.id, "topic-0");
		assert.deepEqual(topicRows(value.lessons).flat(), value.lessons);
		assert.equal(topicRows(value.lessons).length, Math.ceil(count / 2));
		assert.match(
			lifetimeSummary(value),
			new RegExp(`0 of ${count} questions tried`),
		);
	}
	const value = status();
	const question = value.lessons[0]?.questions[0];
	assert.ok(question);
	value.recommended_question = {
		...question,
		lesson_id: "missing",
		reason: "due_review",
	};
	assert.equal(hubSelection(value, null)?.id, "topic-0");
});
test("practice params select only a question within the loaded matching public lesson", () => {
	const value = status();
	assert.equal(initialPracticeSelection(value).lesson, null);
	assert.equal(
		initialPracticeSelection(value, "unknown", "question-0").question,
		null,
	);
	assert.equal(
		initialPracticeSelection(value, "topic-0", "question-1").question,
		null,
	);
	assert.equal(
		initialPracticeSelection(value, "topic-0", "question-0").question,
		value.lessons[0]?.questions[0],
	);
});
test("lifetime saved summary uses actual attempts and correct counts, not mastery or daily progress", () => {
	const value = status(3);
	value.progress["question-0"] = {
		attempts: 7,
		correct: 2,
		last_correct: false,
		last_time: 1,
		review_due: 1,
	};
	assert.equal(
		lifetimeSummary(value),
		"Lifetime saved practice · 1 of 3 questions tried · 2 correct answers of 7 attempts",
	);
});
test("read-only hub coalesces duplicate loads, retains stale snapshot on refresh failure, and recovers", async () => {
	const pending = deferred<LearningStatus>();
	let calls = 0;
	const controller = createHubController(
		() => {
			calls++;
			return pending.promise;
		},
		() => "account:token",
	);
	const first = controller.load();
	void controller.load();
	assert.equal(calls, 1);
	assert.equal(controller.getSnapshot().status, null);
	pending.resolve(status());
	await first;
	assert.equal(calls, 2);
	const cached = controller.getSnapshot().status;
	assert.ok(cached);
	let refreshes = 0;
	const broken = createHubController(
		async () => {
			if (++refreshes === 2) throw new Error("Offline");
			return cached;
		},
		() => "account:token",
	);
	await broken.load();
	await broken.load();
	assert.equal(broken.getSnapshot().status, cached);
	assert.equal(broken.getSnapshot().error, "Offline");
	await broken.load();
	assert.equal(broken.getSnapshot().error, null);
	assert.equal(broken.getSnapshot().status, cached);
	assert.deepEqual(
		Object.keys(controller).sort(),
		[
			"getSnapshot",
			"subscribe",
			"syncIdentity",
			"load",
			"activate",
			"dispose",
		].sort(),
	);
});
test("account AND token changes immediately clear status and reject deferred responses", async () => {
	for (const next of ["other:token", "account:other-token", null]) {
		let owner: string | null = "account:token";
		const pending = deferred<LearningStatus>();
		const controller = createHubController(
			() => pending.promise,
			() => owner,
		);
		const operation = controller.load();
		owner = next;
		assert.equal(controller.syncIdentity(), true);
		assert.equal(controller.getSnapshot().status, null);
		pending.resolve(status());
		await operation;
		assert.equal(controller.getSnapshot().status, null);
	}
});
test("hub checks identity again on response and disposal fences old requests", async () => {
	let owner = "account:token";
	const pending = deferred<LearningStatus>();
	const controller = createHubController(
		() => pending.promise,
		() => owner,
	);
	const operation = controller.load();
	owner = "account:new-token";
	pending.resolve(status());
	await operation;
	assert.equal(controller.getSnapshot().status, null);
	const second = deferred<LearningStatus>();
	const disposed = createHubController(
		() => second.promise,
		() => owner,
	);
	const request = disposed.load();
	disposed.dispose();
	second.resolve(status());
	await request;
	assert.equal(disposed.getSnapshot().status, null);
});
test("focus returning after a saved practice answer drains exactly one trailing fresh snapshot", async () => {
	const oldRefresh = deferred<LearningStatus>();
	const freshRefresh = deferred<LearningStatus>();
	const old = status(8),
		fresh = status(8);
	fresh.progress["question-0"] = {
		attempts: 1,
		correct: 1,
		last_correct: true,
		last_time: 1,
		review_due: 1,
	};
	let calls = 0;
	const controller = createHubController(
		() => (++calls === 1 ? oldRefresh.promise : freshRefresh.promise),
		() => "account:token",
	);
	const navigation = controller.load();
	// Start practice, save an answer, then focus Learn while its old GET is pending.
	for (let i = 0; i < 6; i++) void controller.load();
	assert.equal(calls, 1);
	oldRefresh.resolve(old);
	await Promise.resolve();
	assert.equal(calls, 2);
	assert.equal(controller.getSnapshot().busy, true);
	freshRefresh.resolve(fresh);
	await navigation;
	assert.equal(controller.getSnapshot().status, fresh);
	assert.equal(controller.getSnapshot().busy, false);
	assert.equal(calls, 2);
});
test("queued refresh drains after failure and keeps stale data/error if the trailing request fails", async () => {
	const pending = deferred<LearningStatus>();
	let calls = 0;
	const cached = status();
	const controller = createHubController(
		() => {
			calls++;
			if (calls === 1) return Promise.resolve(cached);
			if (calls === 2) return pending.promise;
			return Promise.reject(new Error("Still offline"));
		},
		() => "account:token",
	);
	await controller.load();
	const refresh = controller.load();
	void controller.load();
	pending.reject(new Error("Offline"));
	await refresh;
	assert.equal(calls, 3);
	assert.equal(controller.getSnapshot().status, cached);
	assert.equal(controller.getSnapshot().error, "Still offline");
});
test("old-owner queued work cannot flush or consume a new owner's queue; dispose never replays", async () => {
	for (const next of ["other:token", "account:new-token"]) {
		let owner = "account:token",
			calls = 0;
		const requests = Array.from({ length: 3 }, () =>
			deferred<LearningStatus>(),
		);
		const controller = createHubController(
			() => {
				const request = requests[calls++];
				assert.ok(request);
				return request.promise;
			},
			() => owner,
		);
		const old = controller.load();
		void controller.load();
		owner = next;
		controller.syncIdentity();
		const current = controller.load();
		void controller.load();
		const [oldRequest, currentRequest, trailingRequest] = requests;
		assert.ok(oldRequest && currentRequest && trailingRequest);
		oldRequest.resolve(status(1));
		await old;
		assert.equal(calls, 2);
		assert.equal(controller.getSnapshot().status, null);
		currentRequest.resolve(status(3));
		await Promise.resolve();
		assert.equal(calls, 3);
		const latest = status(8);
		trailingRequest.resolve(latest);
		await current;
		assert.equal(controller.getSnapshot().status, latest);
	}
	const pending = deferred<LearningStatus>();
	let calls = 0;
	const controller = createHubController(
		() => {
			calls++;
			return pending.promise;
		},
		() => "account:token",
	);
	const operation = controller.load();
	void controller.load();
	controller.dispose();
	await controller.load();
	pending.resolve(status());
	await operation;
	assert.equal(calls, 1);
	assert.equal(controller.getSnapshot().status, null);
	controller.activate();
	assert.equal(calls, 1);
});
function renderHub(
	snapshot: {
		status: LearningStatus | null;
		busy: boolean;
		error: string | null;
	},
	selection: string | null = null,
) {
	const actions: any[] = [],
		nodes: any[] = [],
		focus: (() => void)[] = [];
	let loads = 0,
		stateIndex = 0;
	const calls: any[] = [];
	const wrapper = ({ children }: any) =>
		React.createElement("section", null, children);
	const exports = load("components/learning/hub-screen.tsx", {
		"react/jsx-runtime": require("react/jsx-runtime"),
		react: {
			...React,
			useMemo: (f: any) => f(),
			useState: (initial: any) => {
				const index = stateIndex++;
				return [
					index === 2 && selection
						? { owner: null, lessonID: selection }
						: initial,
					index === 1
						? (target: any) => calls.push([target.lesson, target.question])
						: () => {},
				];
			},
			useEffect() {},
			useCallback: (f: any) => f,
			useSyncExternalStore: () => snapshot,
		},
		"expo-crypto": { randomUUID: () => "attempt" },
		"react-native": {
			View: wrapper,
			Text: wrapper,
			ScrollView: wrapper,
			ActivityIndicator: wrapper,
			Pressable: (props: any) => {
				actions.push({ ...props, label: props.children[0].props.children });
				return wrapper(props);
			},
			useColorScheme: () => "light",
			StyleSheet: { create: (s: any) => s },
		},
		"@expo/ui/swift-ui": {
			Host: wrapper,
			Button: (props: any) => {
				actions.push({
					...props,
					emphasis: props.modifiers.some(
						(m: any) =>
							m.name === "buttonStyle" && m.value === "glassProminent",
					)
						? "primary"
						: undefined,
				});
				return React.createElement("button", null, props.label);
			},
		},
		"@expo/ui/swift-ui/modifiers": Object.fromEntries(
			[
				"buttonBorderShape",
				"buttonStyle",
				"controlSize",
				"tint",
				"disabled",
			].map((name) => [name, (value: any) => ({ name, value })]),
		),
		"../../lib/learning-controller": { createLearningController() {} },
		"../presentation/screen-frame": { ScreenFrame: wrapper },
		"../presentation/text": { PresentationText: wrapper },
		"./topic-map": {
			TopicMap: ({ rows, selectedID, onSelect }: any) =>
				rows.flat().map((row: any) => {
					nodes.push({
						...row,
						selected: row.id === selectedID,
						onPress: () => onSelect(row.id),
					});
					return React.createElement("span", { key: row.id }, row.title);
				}),
		},
		"expo-router": { useFocusEffect: (f: any) => focus.push(f) },
		"../../lib/api": { request() {}, sessionStore: {} },
		"../../lib/learning-api": { learningAPI: () => ({ status() {} }) },
		"./hub-controller": {
			createHubController: () => ({
				activate() {},
				load() {
					loads++;
				},
				subscribe() {},
				getSnapshot() {},
			}),
		},
		"./hub-model": {
			hubSelection,
			lifetimeSummary,
			recommendationReasons,
			topicRows,
		},
		"../native-page": {
			NativePage: wrapper,
			NativeDisclosure: ({ expanded, children, label }: any) =>
				React.createElement(
					"details",
					{ open: expanded },
					React.createElement("summary", null, label),
					expanded ? children : null,
				),
			NativeSection: wrapper,
			NativeRow: wrapper,
			NativeStack: wrapper,
			PageText: wrapper,
			NativeAction: (props: any) => {
				actions.push(props);
				return React.createElement("button", { type: "button" }, props.label);
			},
		},
		"./topic-node": {
			TopicNode: (props: any) => {
				nodes.push(props);
				return React.createElement("button", {
					type: "button",
					"aria-label": props.title,
					"aria-pressed": props.selected,
				});
			},
		},
	});
	const html = renderToStaticMarkup(
		React.createElement(exports.default, {
			onPractice: (...args: any[]) => calls.push(args),
			onBrowse: () => calls.push("browse"),
			onProducts: () => calls.push("products"),
		}),
	);
	return {
		html,
		actions,
		nodes,
		calls,
		focus,
		get loads() {
			return loads;
		},
	};
}
test("actual hub renders all available topics, one filled CTA and only matching recommendation", () => {
	const rendered = renderHub({ status: status(), busy: false, error: null });
	assert.equal(rendered.nodes.length, 5);
	assert.equal(rendered.nodes.filter((item) => item.selected).length, 1);
	assert.equal(
		rendered.actions.filter((item) => item.emphasis === "primary").length,
		1,
	);
	assert.match(rendered.html, /Try an unanswered question/);
	rendered.actions.find((item) => item.label === "Start practice").onPress();
	assert.deepEqual(rendered.calls, [["topic-2", "question-2"]]);
	const chosen = renderHub(
		{ status: status(), busy: false, error: null },
		"topic-0",
	);
	assert.doesNotMatch(
		chosen.html.slice(
			chosen.html.indexOf("SELECTED LESSON"),
			chosen.html.indexOf("Recommended for you"),
		),
		/Try an unanswered question/,
	);
	assert.match(chosen.html, /Recommended for you/);
	chosen.actions.find((item) => item.label === "Start practice").onPress();
	assert.deepEqual(chosen.calls, [["topic-0", undefined]]);
	const refresh = chosen.focus[0];
	assert.ok(refresh);
	refresh();
	refresh();
	assert.equal(chosen.loads, 2);
});
test("loading/failure never fabricates zero progress; Products and bare browse always accessible", () => {
	for (const snapshot of [
		{ status: null, busy: true, error: null },
		{ status: null, busy: false, error: "Offline" },
	]) {
		const rendered = renderHub(snapshot);
		assert.doesNotMatch(rendered.html, /questions tried|Start practice/);
		rendered.actions
			.find((item) => item.label === "Product catalogue")
			.onPress();
		rendered.actions.find((item) => item.label === "All lessons").onPress();
		assert.deepEqual(rendered.calls, ["products", "browse"]);
	}
	assert.match(
		renderHub({ status: status(), busy: false, error: "Offline" }).html,
		/Saved practice may be outdated/,
	);
});
test("actual iOS topic adapter uses universal native button, native circle, accent and selected accessibility", () => {
	const records: Record<string, any> = {};
	const control = (name: string) => (props: any) => {
		records[name] = props;
		return React.createElement("span", null, props.children);
	};
	const modifiers = Object.fromEntries(
		[
			"accessibilityAddTraits",
			"accessibilityHidden",
			"accessibilityLabel",
			"buttonBorderShape",
			"buttonStyle",
			"controlSize",
			"frame",
			"tint",
		].map((name) => [name, (...args: any[]) => ({ name, args })]),
	);
	const sdk = load(
		"../node_modules/@expo/ui/src/universal/Button/index.ios.tsx",
		{
			"react/jsx-runtime": require("react/jsx-runtime"),
			"@expo/ui/swift-ui": { Button: control("SwiftButton") },
			"@expo/ui/swift-ui/modifiers": modifiers,
			"../modifierUtils": load(
				"../node_modules/@expo/ui/src/universal/modifierUtils.ts",
				{},
			),
			"../transformStyle": {
				transformToModifiers: (_style: any, _props: any, extra: any) => extra,
			},
			"./types": {},
		},
	);
	const adapter = load("components/learning/topic-node.tsx", {
		"react/jsx-runtime": require("react/jsx-runtime"),
		"@expo/ui": {
			Button: (props: any) => {
				records.Button = props;
				return React.createElement(sdk.Button, props);
			},
			Icon: control("Icon"),
		},
		"@expo/ui/swift-ui/modifiers": modifiers,
		"../button-action-colors": {
			useButtonActionColors: () => buttonActionColors(false),
		},
		"./topic-node.types": { topicSymbols: ["book"] },
	});
	let pressed = 0;
	renderToStaticMarkup(
		React.createElement(adapter.TopicNode, {
			title: "A full long topic name",
			index: 0,
			selected: true,
			onPress: () => pressed++,
		}),
	);
	assert.equal(records.Button.variant, "outlined");
	records.Button.onPress();
	assert.equal(pressed, 1);
	assert.ok(
		records.Button.modifiers.some(
			(m: any) => m.name === "accessibilityAddTraits",
		),
	);
	assert.ok(
		records.Button.modifiers.some(
			(m: any) => m.name === "buttonBorderShape" && m.args[0] === "circle",
		),
	);
	assert.ok(
		records.Button.modifiers.some(
			(m: any) =>
				m.name === "accessibilityLabel" &&
				m.args[0].includes("A full long topic name"),
		),
	);
	assert.ok(
		records.Button.modifiers.some(
			(m: any) =>
				m.name === "tint" && m.args[0] === buttonActionColors(false).accent,
		),
	);
	assert.ok(
		records.Button.modifiers.some(
			(m: any) =>
				m.name === "frame" && m.args[0].width === 56 && m.args[0].height === 56,
		),
	);
	assert.ok(
		records.SwiftButton.modifiers.some(
			(m: any) =>
				m.name === "frame" && m.args[0].width === 56 && m.args[0].height === 56,
		),
	);
	assert.ok(
		records.SwiftButton.modifiers.some(
			(m: any) => m.name === "controlSize" && m.args[0] === "large",
		),
	);
	assert.equal(records.Icon.size, 24);
	assert.ok(
		records.Icon.modifiers.some(
			(m: any) => m.name === "accessibilityHidden" && m.args[0] === true,
		),
	);
	assert.ok(!records.Icon.modifiers.some((m: any) => m.name === "frame"));
});
test("route ownership preserves /products, relocates practice, guards identity and keeps Advice chat-only", () => {
	assert.equal(
		existsSync(new URL("../../src/app/learn.tsx", import.meta.url)),
		false,
	);
	assert.equal(
		existsSync(new URL("../../src/app/(tabs)/products.tsx", import.meta.url)),
		false,
	);
	const hub = source("app/(tabs)/learn.tsx"),
		practice = source("app/practice.tsx");
	for (const route of [hub, practice]) {
		assert.match(route, /!store.ready/);
		assert.match(route, /!store.account/);
		assert.match(route, /key=\{store.account.id\}/);
	}
	assert.match(hub, /onBrowse=\{\(\) => router.push\("\/practice"\)\}/);
	assert.match(hub, /router.push\("\/products"\)/);
	assert.match(practice, /typeof params.lesson === "string"/);
	assert.match(practice, /typeof params.question === "string"/);
	assert.match(source("app/products.tsx"), /insetMode="stack"/);
	assert.doesNotMatch(
		source("components/advice/advice-screen.tsx"),
		/onPractice|Practice hygiene lessons/,
	);
});
