import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as dateOnly from "../../src/components/presentation/date-only";
type Element = {
	type: unknown;
	props: Record<string, unknown>;
	key?: unknown;
};
const jsx = (
	type: unknown,
	props: Record<string, unknown>,
	key?: unknown,
): Element => ({
	type,
	props,
	key,
});
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const element = node as Element;
	return [
		element,
		...elements(element.props.children),
		...elements(element.props.anchor),
	];
}
function find(tree: Element, type: string, label?: string): Element {
	const found = elements(tree).find(
		(node) =>
			node.type === type && (label === undefined || node.props.label === label),
	);
	assert.ok(found, `${type} ${label ?? ""}`);
	return found;
}
function invoke(node: Element, name: string, ...args: unknown[]) {
	const fn = node.props[name];
	assert.equal(typeof fn, "function");
	return (fn as (...values: unknown[]) => unknown)(...args);
}
const theme = {
	background: "background",
	surface: "surface",
	text: "text",
	secondary: "secondary",
	divider: "divider",
	primary: "primary",
	onPrimary: "onPrimary",
	error: "error",
};
function harness(
	file: string,
	platform: string,
	overrides: Record<string, unknown> = {},
) {
	const hooks: unknown[] = [];
	let cursor = 0;
	let revision = 0;
	let effects: (() => void)[] = [];
	const modifier = (kind: string) => (value: unknown) => ({ kind, value });
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		react: {
			createElement: (
				type: unknown,
				props: Record<string, unknown>,
				...children: unknown[]
			) => jsx(type, { ...props, ...(children.length ? { children } : {}) }),
			useId: () => "date-test",
			useEffect: (effect: () => void, deps: unknown[]) => {
				const index = cursor++;
				const previous = hooks[index] as unknown[] | undefined;
				if (!previous || deps.some((dep, i) => dep !== previous[i]))
					effects.push(effect);
				hooks[index] = deps;
			},
			useRef: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = { current: initial };
				return hooks[index];
			},
			useState: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = initial;
				return [
					hooks[index],
					(value: unknown) => {
						if (!Object.is(hooks[index], value)) revision++;
						hooks[index] = value;
					},
				];
			},
			useImperativeHandle: (
				ref:
					| {
							current: unknown;
					  }
					| undefined,
				factory: () => unknown,
			) => {
				if (ref) ref.current = factory();
			},
		},
		"@expo/ui": {
			Button: "Button",
			Column: "Column",
			Row: "Row",
			Spacer: "Spacer",
			Host: "Host",
			Text: "NativeText",
			BottomSheet: "BottomSheet",
			RNHostView: "RNHostView",
			Picker: Object.assign(
				(props: Record<string, unknown>) => jsx("Picker", props),
				{ Item: "PickerItem" },
			),
		},
		"@expo/ui/community/datetime-picker": {
			__esModule: true,
			default: "DateTimePicker",
		},
		"@expo/ui/jetpack-compose": {
			Text: "ComposeText",
			Column: "ComposeColumn",
			RNHostView: "RNHostView",
		},
		"@expo/ui/jetpack-compose/modifiers": {
			semantics: modifier("semantics"),
			fillMaxWidth: modifier("fillMaxWidth"),
			onSizeChanged: modifier("onSizeChanged"),
			defaultMinSize: modifier("defaultMinSize"),
		},
		"@expo/ui/swift-ui/modifiers": {
			accessibilityLabel: modifier("label"),
			accessibilityAddTraits: modifier("traits"),
			frame: modifier("frame"),
			font: modifier("font"),
			foregroundStyle: modifier("foreground"),
			interactiveDismissDisabled: modifier("interactiveDismissDisabled"),
			textFieldStyle: modifier("textFieldStyle"),
		},
		"react-native": {
			Platform: { OS: platform },
			Keyboard: { dismiss: () => {} },
			View: "View",
			Text: "Text",
			Pressable: "Pressable",
			KeyboardAvoidingView: "KeyboardAvoidingView",
			ScrollView: "ScrollView",
			StyleSheet: { create: (styles: unknown) => styles },
			useWindowDimensions: () => ({ height: 900, width: 400, fontScale: 1 }),
			PlatformColor: (color: string) => color,
		},
		"react-native-safe-area-context": {
			useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
		},
		"./date-only": dateOnly,
		"./date-field-picker": { DateFieldPicker: "DateFieldPicker" },
		"./theme": {
			usePresentationTheme: () => theme,
			usePresentationEpoch: () => 0,
			usePresentationPaletteHold: () => {},
		},
		"../brand/wordmark": { BrandWordmark: "BrandWordmark" },
		"./text": { PresentationText: "PresentationText" },
		"./semantic-text": { SemanticText: "SemanticText" },
		...overrides,
	};
	const exports: Record<string, (...args: unknown[]) => unknown> = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/presentation/${file}`, import.meta.url),
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
			require: (name: string) => {
				assert.ok(name in mocks, `Unexpected dependency ${name}`);
				return mocks[name];
			},
		},
	);
	return {
		revision: () => revision,
		call: (name: string, ...args: unknown[]) => {
			cursor = 0;
			const result = exports[name](...args);
			const pending = effects;
			effects = [];
			for (const effect of pending) effect();
			return result;
		},
	};
}
test("native date field always stacks label and trigger without intrinsic calendar width", () => {
	for (const fontScale of [1, 2]) {
		const h = harness("date-field.tsx", "ios", {
			"react-native": {
				Platform: { OS: "ios" },
				View: "View",
				useWindowDimensions: () => ({ fontScale }),
			},
		});
		const tree = h.call("DateField", {
			label: "Opened on",
			value: "",
			maximum: "2026-03-08",
			disabled: false,
			onChange() {},
		}) as Element;
		const header = (tree.props.children as Element[])[0];
		assert.equal(tree.type, "Column");
		assert.equal(header.type, "SemanticText");
	}
});
for (const platform of ["ios"]) {
	test(`${platform} actual DateField preserves blank, maximum, calendar conversion, confirmation and clearing`, () => {
		const h = harness("date-field.tsx", platform);
		const writes: string[] = [];
		const props = {
			label: "Opened on",
			value: "",
			maximum: "2026-03-08",
			disabled: false,
			onChange: (value: string) => writes.push(value),
		};
		const render = () => h.call("DateField", props) as Element;
		let tree = render();
		assert.equal(find(tree, "DateFieldPicker").props.visible, false);
		invoke(find(tree, "Button", "Choose date"), "onPress");
		tree = render();
		let picker = find(tree, "DateFieldPicker");
		assert.equal(picker.props.visible, true);
		assert.equal(picker.props.maximum, props.maximum);
		assert.equal(picker.props.value, props.maximum);
		assert.deepEqual(writes, [], "opening blank must not fill it");
		invoke(picker, "onSelect", "2026-03-01");
		assert.deepEqual(writes, []);
		invoke(picker, "onDone");
		invoke(picker, "onDone");
		assert.deepEqual(writes, ["2026-03-01"], "duplicate Done writes once");
		invoke(picker, "onDismiss");
		props.value = writes[0];
		render();
		invoke(find(render(), "Button", props.value), "onPress");
		picker = find(render(), "DateFieldPicker");
		assert.equal(picker.props.value, props.value);
		invoke(picker, "onSelect", "2026-02-01");
		invoke(picker, "onCancel");
		invoke(picker, "onDone");
		invoke(picker, "onDismiss");
		assert.equal(writes.length, 1, "cancel invalidates late Done");
		invoke(find(render(), "Button", props.value), "onPress");
		picker = find(render(), "DateFieldPicker");
		assert.equal(
			picker.props.value,
			props.value,
			"reopen discards cancelled draft",
		);
		invoke(picker, "onDismiss");
		invoke(picker, "onDone");
		assert.equal(writes.length, 1, "outside dismissal is cancel");
		invoke(find(render(), "Button", "Clear opened on"), "onPress");
		assert.deepEqual(writes, ["2026-03-01", ""]);
	});
	test(`${platform} actual DateField disabled trigger and clear callbacks never write or open a picker`, () => {
		const h = harness("date-field.tsx", platform);
		const writes: string[] = [];
		const props = {
			label: "Opened on",
			value: "2026-01-01",
			maximum: "2026-04-01",
			disabled: true,
			onChange: (value: string) => writes.push(value),
		};
		const tree = h.call("DateField", props) as Element;
		for (const button of elements(tree).filter(
			(node) => node.type === "Button",
		)) {
			assert.equal(button.props.disabled, true);
			invoke(button, "onPress");
		}
		assert.deepEqual(writes, []);
		assert.equal(
			elements(h.call("DateField", props)).some(
				(node) => node.type === "DateTimePicker",
			),
			false,
		);
	});
}
test("iOS wheel A → B → A updates rendered selection without committing until Done", () => {
	const h = harness("date-field.tsx", "ios");
	const modifier = (value: unknown) => value;
	const adapter = harness("date-field-picker.tsx", "ios", {
		"@expo/ui/swift-ui": {
			BottomSheet: "BottomSheet",
			DatePicker: "DatePicker",
			Button: "Button",
			ScrollView: "ScrollView",
			VStack: "VStack",
		},
		"@expo/ui/swift-ui/modifiers": {
			accessibilityLabel: modifier,
			datePickerStyle: modifier,
			frame: modifier,
			padding: modifier,
		},
	});
	const writes: string[] = [];
	const a = "2026-03-01";
	const b = "2026-03-02";
	const props = {
		label: "Opened on",
		value: a,
		maximum: "2026-03-08",
		disabled: false,
		onChange: (next: string) => writes.push(next),
	};
	const render = () => h.call("DateField", props) as Element;
	const native = () =>
		adapter.call(
			"DateFieldPicker",
			find(render(), "DateFieldPicker").props,
		) as Element;
	const selection = (tree: Element) =>
		dateOnly.dateOnlyFromDate(find(tree, "DatePicker").props.selection as Date);
	const wheel = (tree: Element, next: string) => {
		const date = dateOnly.dateOnlyToLocal(next);
		const picker = find(tree, "DatePicker");
		// Installed DatePickerView.swift suppresses events equal to props.selection.
		if ((picker.props.selection as Date).getTime() === date.getTime())
			return tree;
		const before = h.revision();
		invoke(picker, "onDateChange", date);
		assert.ok(h.revision() > before, "selection must schedule a React render");
		return native();
	};
	const open = () => {
		invoke(find(render(), "Button", props.value), "onPress");
		const tree = native();
		assert.equal(find(tree, "BottomSheet").props.isPresented, true);
		assert.equal(selection(tree), a, "each open starts from committed value");
		return tree;
	};
	let tree = open();
	tree = wheel(tree, b);
	assert.equal(selection(tree), b);
	tree = wheel(tree, a);
	assert.equal(selection(tree), a);
	assert.deepEqual(writes, []);
	invoke(find(tree, "Button", "Done"), "onPress");
	invoke(find(tree, "Button", "Done"), "onPress");
	assert.deepEqual(writes, [a]);
	invoke(find(tree, "BottomSheet"), "onDismiss");
	tree = wheel(open(), b);
	invoke(find(tree, "Button", "Cancel"), "onPress");
	invoke(find(tree, "Button", "Done"), "onPress");
	assert.deepEqual(writes, [a]);
	invoke(find(tree, "BottomSheet"), "onDismiss");
	const cancelled = tree;
	tree = open();
	invoke(
		find(cancelled, "DatePicker"),
		"onDateChange",
		dateOnly.dateOnlyToLocal(b),
	);
	invoke(find(cancelled, "BottomSheet"), "onDismiss");
	assert.equal(selection(native()), a);
	assert.equal(find(native(), "BottomSheet").props.isPresented, true);
	tree = wheel(tree, b);
	invoke(find(tree, "BottomSheet"), "onIsPresentedChange", false);
	invoke(find(tree, "BottomSheet"), "onDismiss");
	invoke(find(tree, "Button", "Done"), "onPress");
	assert.deepEqual(writes, [a], "outside dismissal never commits");
	tree = open();
	invoke(find(tree, "Button", "Done"), "onPress");
	assert.deepEqual(writes, [a, a]);
});
test("native date callbacks cannot commit while pending and stale sessions cannot close a new picker", () => {
	const h = harness("date-field.tsx", "ios");
	const writes: string[] = [];
	const props = {
		label: "Opened on",
		value: "2026-03-01",
		maximum: "2026-03-08",
		disabled: false,
		onChange: (next: string) => writes.push(next),
	};
	const render = () => h.call("DateField", props) as Element;
	invoke(find(render(), "Button", props.value), "onPress");
	let picker = find(render(), "DateFieldPicker");
	invoke(picker, "onSelect", "2026-03-02");
	props.disabled = true;
	render();
	invoke(picker, "onDone");
	assert.deepEqual(writes, []);
	invoke(picker, "onDismiss");
	props.disabled = false;
	render();
	invoke(find(render(), "Button", props.value), "onPress");
	const previous = picker;
	picker = find(render(), "DateFieldPicker");
	invoke(previous, "onCancel");
	invoke(previous, "onDismiss");
	assert.equal(find(render(), "DateFieldPicker").props.visible, true);
	invoke(picker, "onDone");
	assert.deepEqual(writes, [props.value]);
});
for (const platform of ["ios"]) {
	test(`${platform} actual native date adapter uses verified modal API and date-only bridge`, () => {
		const modifier = (value: unknown) => value;
		const h = harness(`date-field-picker.tsx`, platform, {
			"@expo/ui/swift-ui": {
				BottomSheet: "BottomSheet",
				DatePicker: "DatePicker",
				Button: "Button",
				ScrollView: "ScrollView",
				VStack: "VStack",
			},
			"@expo/ui/swift-ui/modifiers": {
				accessibilityLabel: modifier,
				datePickerStyle: modifier,
				frame: modifier,
				padding: modifier,
			},
			"@expo/ui/jetpack-compose": { DatePickerDialog: "DatePickerDialog" },
		});
		const selected: string[] = [];
		const done: (string | undefined)[] = [];
		let cancels = 0;
		let dismisses = 0;
		const props = {
			anchor: jsx("Anchor", {}),
			label: "Opened on",
			visible: true,
			value: "2026-03-01",
			maximum: "2026-03-08",
			onSelect: (next: string) => selected.push(next),
			onDone: (next?: string) => done.push(next),
			onCancel: () => cancels++,
			onDismiss: () => dismisses++,
		};
		let tree = h.call("DateFieldPicker", props) as Element;
		{
			const picker = find(tree, "DatePicker");
			assert.equal(
				dateOnly.dateOnlyFromDate(picker.props.selection as Date),
				props.value,
			);
			invoke(picker, "onDateChange", dateOnly.dateOnlyToLocal("2026-03-02"));
			assert.deepEqual(selected, ["2026-03-02"]);
			assert.deepEqual(done, []);
			invoke(find(tree, "Button", "Done"), "onPress");
			assert.deepEqual(done, [undefined]);
			invoke(find(tree, "BottomSheet"), "onIsPresentedChange", false);
			invoke(find(tree, "BottomSheet"), "onDismiss");
		}
		assert.equal(cancels, 1);
		assert.equal(dismisses, 1);
	});
}
test("actual sheet owns the RN bridge, sizes to content and reports busy dismissal without closing requests", () => {
	for (const platform of ["ios"]) {
		const h = harness("native-sheet.tsx", platform);
		let dismisses = 0;
		const tree = h.call("NativeSheet", {
			presented: true,
			busy: true,
			title: "Add spares",
			onRequestClose: () => assert.fail("busy close"),
			onDismiss: () => dismisses++,
			children: jsx("View", { children: "Draft" }),
		}) as Element;
		assert.equal(tree.type, "BottomSheet");
		assert.equal(tree.props.isPresented, true);
		assert.equal(
			tree.props.snapPoints,
			undefined,
			"no arbitrary fullscreen detent",
		);
		assert.equal(find(tree, "RNHostView").props.matchContents, true);
		assert.equal(find(tree, "Button", "Close").props.disabled, true);
		invoke(find(tree, "Button", "Close"), "onPress");
		assert.equal(tree.props.shouldDismissOnBackPress, undefined);
		assert.equal(tree.props.shouldDismissOnClickOutside, undefined);
		assert.deepEqual(JSON.parse(JSON.stringify(tree.props.modifiers)), [
			{ kind: "interactiveDismissDisabled", value: true },
		]);
		invoke(tree, "onDismiss");
		assert.equal(
			dismisses,
			1,
			"busy dismissal is reported so the caller can preserve its draft",
		);
		assert.equal(
			elements(tree).filter((node) => node.type === "ScrollView").length,
			1,
		);
	}
});
test("sheet keys only its native presentation and rejects dismissal callbacks from an obsolete palette boundary", () => {
	let epoch = 0;
	let dismisses = 0;
	const holds: boolean[] = [];
	const h = harness("native-sheet.tsx", "ios", {
		"./theme": {
			usePresentationTheme: () => theme,
			usePresentationEpoch: () => epoch,
			usePresentationPaletteHold: (busy: boolean) => holds.push(busy),
		},
	});
	const props = {
		presented: true,
		busy: true,
		title: "Add spares",
		onRequestClose: () => {},
		onDismiss: () => dismisses++,
		children: jsx("View", {}),
	};
	const old = h.call("NativeSheet", props) as Element;
	assert.equal(old.key, 0);
	props.busy = false;
	epoch = 1;
	const current = h.call("NativeSheet", props) as Element;
	assert.equal(current.key, 1);
	assert.deepEqual(holds, [true, false]);
	invoke(old, "onDismiss");
	assert.equal(
		dismisses,
		0,
		"a replaced Host cannot close the new presentation",
	);
	invoke(current, "onDismiss");
	assert.equal(dismisses, 1);
});
test("actual ScreenFrame has one scroll owner, no empty headings, and no doubled tab bottom inset", () => {
	for (const platform of ["ios"]) {
		const h = harness("screen-frame.tsx", platform);
		const props = {
			title: "Today",
			insetMode: "tabs",
			scrollOwner: "frame",
			children: jsx("Host", {}),
		};
		let tree = h.call("ScreenFrame", props) as Element;
		const scroll = find(tree, "ScrollView");
		assert.equal(
			elements(tree).filter((node) => node.type === "ScrollView").length,
			1,
		);
		assert.equal(
			(
				scroll.props.contentContainerStyle as {
					paddingTop: number;
				}
			).paddingTop,
			12,
		);
		assert.equal(
			(
				scroll.props.contentContainerStyle as {
					paddingBottom: number;
				}
			).paddingBottom,
			20,
		);
		props.scrollOwner = "content";
		tree = h.call("ScreenFrame", props) as Element;
		assert.equal(
			elements(tree).some((node) => node.type === "ScrollView"),
			false,
		);
		props.title = "";
		props.insetMode = "standalone";
		tree = h.call("ScreenFrame", props) as Element;
		assert.equal(
			elements(tree).some((node) => node.type === "PresentationText"),
			false,
		);
		props.title = "Reset password";
		props.insetMode = "stack";
		assert.equal(
			elements(h.call("ScreenFrame", props)).some(
				(node) => node.type === "PresentationText",
			),
			false,
			"stack owns the native heading",
		);
	}
});
test("actual semantic typography uses Dynamic Type, semantic colors, heading traits and RN ramps without scaling caps", () => {
	const h = harness("text.tsx", "ios");
	const props = {
		children: "Welcome",
		role: "largeTitle",
		tone: "secondary",
		heading: true,
		accessibilityLabel: "Welcome to Oculog",
	};
	const native = h.call("SemanticText", props) as Element;
	const mods = JSON.parse(JSON.stringify(native.props.modifiers));
	assert.deepEqual(mods[0], {
		kind: "font",
		value: { textStyle: "largeTitle" },
	});
	assert.deepEqual(mods[1], {
		kind: "foreground",
		value: { type: "hierarchical", style: "secondary" },
	});
	assert.deepEqual(mods[2], { kind: "traits", value: ["isHeader"] });
	const rn = h.call("PresentationText", props) as Element;
	assert.equal(rn.props.dynamicTypeRamp, "largeTitle");
	assert.equal(rn.props.allowFontScaling, true);
	assert.equal(rn.props.accessibilityRole, "header");
	assert.equal(rn.props.numberOfLines, undefined);
	assert.equal(rn.props.maxFontSizeMultiplier, undefined);
});
test("actual notifySuccess swallows iOS haptic rejection", async () => {
	let calls = 0;
	const overrides = {
		"expo-haptics": {
			NotificationFeedbackType: { Success: "success" },
			notificationAsync: async (kind: string) => {
				calls++;
				assert.equal(kind, "success");
				throw new Error("Unavailable hardware");
			},
		},
	};
	await harness("haptics.ts", "ios", overrides).call("notifySuccess");
	assert.equal(calls, 1);
});
