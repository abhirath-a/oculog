// biome-ignore-all lint/suspicious/noExplicitAny: VM hook harness exercises the overlay's effects and native boundary.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function harness(platform = "ios", bottomInset = 83) {
	let cursor = 0;
	const hooks: any[] = [];
	const effects: (() => void)[] = [];
	const timers = new Map<number, () => void>();
	const announcements: string[] = [];
	let nextTimer = 0;
	const jsx = (type: any, props: any) => ({ type, props });
	const props = {
		action: { busy: false, error: "", message: "" },
		addAction: { busy: false, error: "", message: "" },
		visible: true,
	};
	const mocks: any = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": { Column: "Column", Host: "Host" },
		"react-native": {
			View: "View",
			Platform: { OS: platform },
			AccessibilityInfo: {
				announceForAccessibility: (text: string) => announcements.push(text),
			},
		},
		"react-native-safe-area-context": {
			useSafeAreaInsets: () => ({ bottom: bottomInset }),
		},
		"./today-feedback-surface": { __esModule: true, default: "Surface" },
		react: {
			useState(initial: any) {
				const i = cursor++;
				if (!(i in hooks)) hooks[i] = initial;
				return [
					hooks[i],
					(next: any) => {
						hooks[i] = next;
					},
				];
			},
			useEffect(effect: () => any, deps: any[]) {
				const i = cursor++;
				if (
					hooks[i] &&
					deps.every((value, index) => Object.is(value, hooks[i].deps[index]))
				)
					return;
				effects.push(() => {
					hooks[i]?.cleanup?.();
					hooks[i] = { deps, cleanup: effect() };
				});
			},
		},
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/home/today-feedback.tsx",
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
			require(name: string) {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
			setTimeout(fn: () => void) {
				const id = ++nextTimer;
				timers.set(id, fn);
				return id;
			},
			clearTimeout(id: number) {
				timers.delete(id);
			},
		},
	);
	return {
		props,
		timers,
		announcements,
		render() {
			cursor = 0;
			const tree = exports.default(props);
			for (const effect of effects.splice(0)) effect();
			return tree;
		},
	};
}
function nodes(tree: any): any[] {
	if (Array.isArray(tree)) return tree.flatMap(nodes);
	return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}

test("Today feedback floats above the tab area without moving content, measures its native Host, and auto-dismisses success", () => {
	const h = harness();
	assert.equal(h.render(), null);
	h.props.action.message = "Daily log saved.";
	h.render();
	let tree = h.render();
	assert.equal(tree.props.style.position, "absolute");
	assert.equal(
		tree.props.style.bottom,
		99,
		"native iOS tab/safe-area obstruction plus 16pt gap",
	);
	tree.props.onLayout({ nativeEvent: { layout: { width: 361 } } });
	tree = h.render();
	const host = nodes(tree).find((node) => node.type === "Host");
	assert.equal(host.props.style.width, 361);
	assert.equal(host.props.matchContents.vertical, true);
	assert.ok(
		nodes(tree).some((node) => node.props.notice?.text === "Daily log saved."),
	);
	assert.equal(
		nodes(tree).some((node) => node.props.label === "Dismiss"),
		false,
		"success stays compact and dismisses automatically",
	);
	assert.deepEqual(h.announcements, ["Daily log saved."]);
	assert.equal(h.timers.size, 1);
	for (const timer of h.timers.values()) timer();
	assert.equal(h.render(), null);
});

test("pending feedback cannot be dismissed, errors remain available, and newer actions replace old messages", () => {
	const h = harness();
	h.render();
	h.props.action.busy = true;
	h.render();
	let tree = h.render();
	tree.props.onLayout({ nativeEvent: { layout: { width: 361 } } });
	tree = h.render();
	assert.ok(
		nodes(tree).some((node) => node.props.notice?.text === "Saving changes…"),
	);
	assert.equal(
		nodes(tree).some((node) => node.props.label === "Dismiss"),
		false,
	);
	assert.equal(h.timers.size, 0);
	h.props.action.busy = false;
	h.props.action.error = "Delivery unconfirmed. Retry the same request.";
	h.render();
	tree = h.render();
	assert.ok(
		nodes(tree).some(
			(node) => node.props.notice?.text === h.props.action.error,
		),
	);
	assert.equal(h.timers.size, 0);
	nodes(tree)
		.find((node) => node.type === "Surface")
		.props.onDismiss();
	assert.equal(h.render(), null);
	h.props.addAction.busy = true;
	h.render();
	tree = h.render();
	assert.ok(
		nodes(tree).some((node) => node.props.notice?.text === "Adding spares…"),
	);
	h.props.visible = false;
	assert.equal(h.render(), null, "sheet owns feedback while it is open");
});

test("toast follows changing native iOS safe areas without adding Android's already-applied tab inset", () => {
	for (const [platform, inset, expected] of [
		["ios", 34, 50],
		["ios", 83, 99],
		["ios", 0, 16],
	] as const) {
		const h = harness(platform, inset);
		h.render();
		h.props.action.message = "Saved";
		h.render();
		assert.equal(h.render().props.style.bottom, expected);
	}
});

test("iOS toast uses native material and SF symbols rather than an outlined card", () => {
	const jsx = (type: any, props: any) => ({ type, props });
	const modifiers = Object.fromEntries(
		[
			"background",
			"buttonStyle",
			"controlSize",
			"fixedSize",
			"font",
			"frame",
			"padding",
			"shadow",
			"tint",
		].map((name) => [name, (...args: any[]) => ({ name, args })]),
	);
	const mocks: any = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		"@expo/ui": Object.fromEntries(
			["Button", "Column", "Icon", "Row", "Text"].map((name) => [name, name]),
		),
		"@expo/ui/swift-ui": { ProgressView: "ProgressView" },
		"@expo/ui/swift-ui/modifiers": {
			...modifiers,
			shapes: { roundedRectangle: (value: any) => value },
		},
		"../presentation/theme": {
			usePresentationTheme: () => ({
				text: "#fff",
				primary: "#acf",
				error: "#faa",
			}),
		},
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/home/today-feedback-surface.tsx",
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
			require(name: string) {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	for (const kind of ["success", "pending", "error"]) {
		let dismissed = 0;
		const tree = exports.default({
			notice: { kind, text: "Status" },
			onDismiss: () => dismissed++,
		});
		assert.equal(tree.props.style.borderWidth, undefined);
		assert.equal(
			tree.props.modifiers.find(
				(modifier: any) => modifier.name === "background",
			).args[0].material,
			"regular",
		);
		const all = nodes(tree);
		assert.equal(
			all.some((node) => node.type === "ProgressView"),
			kind === "pending",
		);
		assert.equal(
			all.some((node) => node.props.name === "checkmark.circle.fill"),
			kind === "success",
		);
		const dismiss = all.find((node) => node.type === "Button");
		assert.equal(!!dismiss, kind === "error");
		if (dismiss) {
			assert.equal(dismiss.props.variant, "outlined");
			dismiss.props.onPress();
			assert.equal(dismissed, 1);
		}
	}
});

test("Home no longer inserts transient action notifications above the lens list", () => {
	const source = readFileSync(
		new URL("../../src/components/home/screen.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(source, /<Feedback/);
	assert.match(source, /<TodayFeedback/);
	assert.match(
		source,
		/Showing your last records\. Reconnect before saving\./,
		"persistent connection safety notice remains visible",
	);
});
