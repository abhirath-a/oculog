import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SimpleState } from "../../shared/simple-domain";
import * as addIntent from "../../src/components/home/add-intent";
import * as homeModel from "../../src/components/home/model";
import * as controller from "../../src/lib/simple-controller";

type Element = { type: unknown; props: Record<string, unknown>; key?: unknown };
function jsx(
	type: unknown,
	props: Record<string, unknown>,
	key?: unknown,
): Element {
	return { type, props, key };
}
function isElement(node: unknown): node is Element {
	return !!node && typeof node === "object" && "props" in node;
}
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isElement(node)) return [];
	return [node, ...elements(node.props.children)];
}
function text(node: unknown): string {
	if (Array.isArray(node)) return node.map(text).join("");
	if (isElement(node)) return text(node.props.children);
	return node == null ? "" : String(node);
}
function invoke(node: Element, name: string, ...args: unknown[]) {
	const callback = node.props[name];
	assert.equal(typeof callback, "function");
	return (callback as (...values: unknown[]) => unknown)(...args);
}
type MutationBody = { eye?: string; quantity?: number };
function fixture(): SimpleState {
	return {
		today: "2026-04-01",
		timeZone: "UTC",
		eyes: ["left", "right"].map((eye) => ({
			id: null,
			eye: eye as "left" | "right",
			replacementDays: 14,
			openedOn: "2026-03-20",
			dueOn: "2026-04-03",
			spareCount: 2,
			daysRemaining: 2,
		})),
		daily: { localDate: "2026-04-01", worn: null },
	};
}

// Execute the real TSX with lightweight view/hook doubles, not a native device.
function homeHarness() {
	const state = fixture();
	const calls: { route: string; body: MutationBody }[] = [];
	const pending: Promise<unknown>[] = [];
	const hooks: unknown[] = [];
	let cursor = 0;
	let paletteEpoch = 0;
	let failRight = false;
	let confirmed = true;
	let confirmations = 0;
	const ui = Object.fromEntries(
		[
			"Button",
			"Card",
			"Choices",
			"Feedback",
			"Field",
			"Page",
			"Toggle",
			"Txt",
		].map((name) => [name, name]),
	);
	const store = {
		state,
		online: true,
		loading: false,
		pending: false,
		error: "",
		account: { email: "test@example.com" },
		mutate: async (route: string, body: MutationBody) => {
			calls.push({ route, body });
			if (route === "add" && body.eye === "right" && failRight)
				throw new Error("Connection lost");
			return true;
		},
	};
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		react: {
			useEffect: (effect: () => void) => effect(),
			useState: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = initial;
				return [
					hooks[index],
					(value: unknown) => {
						hooks[index] = value;
					},
				];
			},
			useRef: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = { current: initial };
				return hooks[index];
			},
		},
		"@expo/ui": {
			Host: "Host",
			Button: "Button",
			Column: "Column",
			Row: "Row",
			FieldGroup: Object.assign(
				(props: Record<string, unknown>) => jsx("FieldGroup", props),
				{ Section: "Section", SectionFooter: "SectionFooter" },
			),
		},
		"@expo/ui/jetpack-compose/modifiers": {
			semantics: (value: unknown) => value,
			fillMaxWidth: (fraction?: number) => ({
				$type: "fillMaxWidth",
				fraction,
			}),
			weight: (value: number) => ({ $type: "weight", value }),
		},
		"@expo/ui/swift-ui/modifiers": {
			frame: (value: unknown) => value,
			accessibilityLabel: (value: string) => ({ label: value }),
			accessibilityValue: (value: string) => ({ value }),
			accessibilityAddTraits: (value: string[]) => ({ traits: value }),
		},
		"../presentation": {
			ScreenFrame: "ScreenFrame",
			NativeSheet: "NativeSheet",
			SemanticText: "SemanticText",
			PresentationText: "PresentationText",
			notifySuccess: async () => {},
			usePresentationEpoch: () => paletteEpoch,
			usePresentationTheme: () => ({ background: "white", primary: "teal" }),
		},
		"./presentation": {
			ScreenFrame: "ScreenFrame",
			NativeSheet: "NativeSheet",
			PresentationText: "PresentationText",
			notifySuccess: async () => {},
		},
		"expo-router": { useRouter: () => ({ push: () => {} }) },
		"./home/add-intent": addIntent,
		"./home/AddContactsForm": { __esModule: true, default: "AddContactsForm" },
		"./model": homeModel,
		"./daily-choice": { DailyChoice: "DailyChoice" },
		"./home/daily-choice": { DailyChoice: "DailyChoice" },
		"react-native": {
			Platform: { OS: "android" },
			useColorScheme: () => "light",
			useWindowDimensions: () => ({ width: 550, height: 960, fontScale: 1 }),
			ScrollView: "ScrollView",
			Text: "Text",
			View: "View",
		},
		"../lib/api": {
			sessionStore: { account: { id: "owner" }, token: "token" },
		},
		"../lib/simple-controller": controller,
		"../lib/store": { useStore: () => store },
		"./ui": {
			...ui,
			styles: { row: {} },
			useColors: () => ({ bg: "white", text: "black", danger: "red" }),
			confirm: async () => {
				confirmations++;
				return confirmed;
			},
			useAction: () => ({
				busy: false,
				run: (fn: () => Promise<unknown>) => {
					const result = fn().catch(() => false);
					pending.push(result);
					return result;
				},
			}),
		},
	};
	mocks["../ui"] = mocks["./ui"];
	mocks["./AddContactsForm"] = mocks["./home/AddContactsForm"];
	const sheetExports = {} as { default: (props: unknown) => Element };
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/home/AddContactsSheet.tsx",
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
			exports: sheetExports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./home/AddContactsSheet"] = {
		__esModule: true,
		default: sheetExports.default,
	};
	const homeExports = {} as {
		default: (props: unknown) => Element;
		EyeCard: (props: unknown) => Element;
		DailyLogSection: (props: unknown) => Element;
	};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL("../../src/components/home/HomeContent.tsx", import.meta.url),
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
			exports: homeExports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./home/HomeContent"] = {
		__esModule: true,
		default: homeExports.default,
	};
	const source = readFileSync(
		new URL("../../src/components/simple-home.tsx", import.meta.url),
		"utf8",
	);
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;
	const exports = {} as {
		default: () => Element;
		EyeCard: (props: unknown) => Element;
		DailyLogSection: (props: unknown) => Element;
	};
	runInNewContext(output, {
		exports,
		require: (name: string) => {
			assert.ok(name in mocks, `Unexpected dependency ${name}`);
			return mocks[name];
		},
	});
	Object.assign(exports, homeExports, { default: exports.default });
	function expandContent(node: unknown): unknown {
		if (Array.isArray(node)) return node.map(expandContent);
		if (!isElement(node)) return node;
		if (node.type === homeExports.default)
			return expandContent(homeExports.default(node.props));
		if (node.type === sheetExports.default)
			return expandContent(sheetExports.default(node.props));
		return {
			...node,
			props: { ...node.props, children: expandContent(node.props.children) },
		};
	}
	return {
		exports,
		state,
		calls,
		render: () => {
			cursor = 0;
			return expandContent(exports.default()) as Element;
		},
		flush: async () => {
			await Promise.all(pending.splice(0));
		},
		failRight: (value: boolean) => {
			failRight = value;
		},
		confirm: (value: boolean) => {
			confirmed = value;
		},
		confirmations: () => confirmations,
		refreshPalette: () => {
			paletteEpoch++;
		},
	};
}
function find(node: Element, type: string, title?: string) {
	const found = elements(node).find(
		(element) =>
			(element.type === type ||
				(typeof element.type === "function" && element.type.name === type)) &&
			(title === undefined ||
				element.props.title === title ||
				element.props.label === title),
	);
	assert.ok(found, `${type} ${title ?? ""} should be present`);
	return found;
}

test("eye row uses server remaining days and omits replacement without spares", () => {
	const harness = homeHarness();
	const settings = {
		...harness.state.eyes[0],
		spareCount: 0,
		daysRemaining: -1,
	};
	const card = harness.exports.EyeCard({
		settings,
		disabled: false,
		onReplace: () => {},
	});
	assert.match(text(card), /1 day overdue/);
	assert.match(text(card), /Replace on 2026-04-03/);
	assert.equal(
		elements(card).filter((node) => node.type === "Button").length,
		0,
	);
	assert.match(text(card), /Spares: 0/);
});

test("shared daily choices offer only Yes/No, unknown selects neither, and disabled callbacks cannot write", () => {
	for (const platform of ["android", "ios", "web"]) {
		const exports = {} as { DailyChoice: (props: unknown) => Element };
		const mocks: Record<string, unknown> = {
			"react/jsx-runtime": { jsx, jsxs: jsx },
			"@expo/ui": { Button: "Button", Column: "Column" },
			"@expo/ui/jetpack-compose/modifiers": {
				selectableGroup: () => ({ group: true }),
				selectable: (selected: boolean) => ({ selected }),
				semantics: (value: unknown) => value,
			},
			"@expo/ui/swift-ui/modifiers": {
				frame: (value: unknown) => value,
				accessibilityLabel: (label: string) => ({ label }),
				accessibilityValue: (value: string) => ({ value }),
				accessibilityAddTraits: (traits: string[]) => ({ traits }),
			},
			"react-native": {
				Platform: { OS: platform },
				View: "View",
				Pressable: "Pressable",
				Text: "Text",
			},
			"../presentation": {
				usePresentationTheme: () => ({
					primary: "teal",
					surface: "white",
					text: "black",
					onPrimary: "white",
				}),
			},
		};
		runInNewContext(
			ts.transpileModule(
				readFileSync(
					new URL(
						"../../src/components/home/daily-choice.tsx",
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
				require: (name: string) => {
					assert.ok(name in mocks, name);
					return mocks[name];
				},
			},
		);
		for (const worn of [null, true, false]) {
			for (const disabled of [false, true]) {
				const writes: boolean[] = [];
				const tree = exports.DailyChoice({
					worn,
					disabled,
					onLog: (value: boolean) => writes.push(value),
				});
				const buttons = elements(tree).filter(
					(node) => node.type === (platform === "web" ? "Pressable" : "Button"),
				);
				assert.deepEqual(
					buttons.map((node) =>
						platform === "web" ? text(node) : node.props.label,
					),
					["Yes", "No"],
				);
				buttons.forEach((button, index) => {
					const selected = worn === (index === 0);
					if (platform === "web") {
						assert.equal(button.props.accessibilityRole, "radio");
						assert.equal(
							(button.props.accessibilityState as { checked: boolean }).checked,
							selected,
						);
					} else {
						assert.equal(
							button.props.variant,
							selected ? "filled" : "outlined",
						);
						const mods = button.props.modifiers as {
							selected?: boolean;
							value?: string;
						}[];
						assert.equal(
							platform === "android"
								? mods[0].selected
								: mods[2].value === "Selected",
							selected,
						);
					}
					assert.equal(button.props.disabled, disabled);
					invoke(button, "onPress");
				});
				assert.deepEqual(writes, disabled ? [] : [true, false]);
			}
		}
	}
});

test("daily choice preserves unknown, Yes and No and forwards explicit writes", () => {
	const harness = homeHarness();
	const logged: boolean[] = [];
	const render = () =>
		harness.exports.DailyLogSection({
			state: harness.state,
			disabled: false,
			onLog: (worn: boolean) => logged.push(worn),
		});
	let card = render();
	assert.match(text(card), /Not recorded/);
	assert.equal(find(card, "DailyChoice").props.worn, null);
	assert.equal(find(card, "DailyChoice").props.disabled, false);
	invoke(find(card, "DailyChoice"), "onLog", false);
	invoke(find(card, "DailyChoice"), "onLog", true);
	assert.deepEqual(logged, [false, true]);
	for (const worn of [false, true]) {
		harness.state.daily.worn = worn;
		card = render();
		assert.equal(find(card, "DailyChoice").props.worn, worn);
		assert.match(text(card), worn ? /Recorded: Yes/ : /Recorded: No/);
	}
	const disabledCard = harness.exports.DailyLogSection({
		state: harness.state,
		disabled: true,
		onLog: () => {},
	});
	assert.equal(find(disabledCard, "DailyChoice").props.disabled, true);
});

test("Add both retry writes only the unfinished eye for the same intent", async () => {
	const harness = homeHarness();
	invoke(find(harness.render(), "Button", "Add spares"), "onPress");
	harness.failRight(true);
	let form = find(harness.render(), "AddContactsForm");
	assert.equal(form.props.locked, false);
	invoke(form, "onAdd");
	await harness.flush();
	harness.failRight(false);
	assert.equal(find(harness.render(), "Host").key, 0);
	harness.refreshPalette();
	assert.equal(
		find(harness.render(), "Host").key,
		1,
		"only native content boundary changes key",
	);
	assert.equal(
		find(harness.render(), "AddContactsForm").props.locked,
		true,
		"partial-eye ledger remains in the unkeyed owner",
	);
	let sheet = find(harness.render(), "NativeSheet");
	assert.equal(
		sheet.props.presented,
		true,
		"partial failure must not close the sheet",
	);
	invoke(sheet, "onDismiss");
	assert.equal(find(harness.render(), "NativeSheet").props.presented, false);
	invoke(find(harness.render(), "Button", "Add spares"), "onPress");
	form = find(harness.render(), "AddContactsForm");
	assert.equal(form.props.locked, true);
	assert.equal(form.props.quantity, "1");
	invoke(form, "onAdd");
	await harness.flush();
	sheet = find(harness.render(), "NativeSheet");
	assert.equal(
		sheet.props.presented,
		false,
		"only full success closes the sheet",
	);
	assert.deepEqual(
		harness.calls.map((call) => call.body.eye),
		["left", "right", "right"],
	);
	assert.ok(
		harness.calls.every(
			(call) => call.route === "add" && call.body.quantity === 1,
		),
	);
});

test("replacement has one confirmation and cancellation does not mutate", async () => {
	const harness = homeHarness();
	const card = elements(harness.render()).find(
		(element) =>
			typeof element.type === "function" && element.type.name === "EyeCard",
	);
	assert.ok(card);
	harness.confirm(false);
	invoke(card, "onReplace", "left");
	await harness.flush();
	assert.equal(harness.calls.length, 0);
	harness.confirm(true);
	invoke(card, "onReplace", "left");
	await harness.flush();
	assert.equal(harness.confirmations(), 2);
	assert.deepEqual(
		harness.calls.map((call) => call.route),
		["replace"],
	);
	assert.equal(harness.calls[0].body.eye, "left");
});
