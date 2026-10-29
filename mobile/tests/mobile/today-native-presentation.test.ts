// biome-ignore-all lint/suspicious/noExplicitAny: VM render harness checks actual platform JSX across SDK boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as model from "../../src/components/home/model";
import * as addModel from "../../src/components/home/today-add-model";
import * as todayModel from "../../src/components/home/today-model";
import * as tokens from "../../src/components/home/today-tokens";

const require = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, any>) {
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/home/${file}`, import.meta.url),
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
				assert.ok(name in mocks, `Unexpected import ${name}`);
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
		["Column", "Row", "Text", "Host", "Button", "ScrollView"].map((name) => [
			name,
			control(name),
		]),
	);
	api.FieldGroup = Object.assign(control("Form"), {
		Section: control("Section"),
	});
	api.Picker = Object.assign(control("Picker"), {
		Item: control("PickerItem"),
	});
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
			"interactiveDismissDisabled",
			"presentationBackground",
			"presentationDetents",
		].map((name) => [name, (...args: any[]) => ({ name, args })]),
	);
	const mocks: any = {
		"react/jsx-runtime": require("react/jsx-runtime"),
		react: React,
		"@expo/ui": api,
		"@expo/ui/swift-ui": {
			DisclosureGroup: Object.assign(control("Disclosure"), {
				Label: control("DisclosureLabel"),
			}),
			BottomSheet: control("Sheet"),
			Group: control("Group"),
		},
		"@expo/ui/swift-ui/modifiers": modifiers,
		"../presentation/theme": {
			usePresentationTheme: () => ({
				background: "#000",
				surface: "#111",
				text: "#fff",
				secondary: "#aaa",
				primary: "#acf",
				onPrimary: "#000",
				error: "#faa",
			}),
			usePresentationPaletteHold() {},
		},
		"./today-tokens": tokens,
		"./today-model": todayModel,
		"./model": model,
		"./today-add-model": addModel,
		"./today-quantity": { __esModule: true, default: control("Quantity") },
	};
	mocks["../button-action-colors"] = load("../button-action-colors.ts", {
		"react-native": { useColorScheme: () => "light" },
	});
	mocks["./today-design-base"] = load("today-design-base.tsx", mocks);
	mocks["./today-action"] = load("today-action.tsx", mocks);
	mocks["./today-design"] = load("today-design.tsx", mocks);
	mocks["./AddContactsForm"] = {
		__esModule: true,
		default: load("AddContactsForm.tsx", mocks).default,
	};
	mocks["../../lib/store"] = {
		useStore: () => ({ online: true, error: "", account: { id: "synthetic" } }),
	};
	mocks["../../lib/api"] = { sessionStore: { token: "synthetic-token" } };
	mocks["./today-wear"] = load("today-wear.ts", mocks);
	mocks["./today-content"] = {
		__esModule: true,
		...load("today-content.tsx", mocks),
	};
	const render = (Component: any, props: any) =>
		renderToStaticMarkup(React.createElement(Component, props));
	return { mocks, records, render, load: (file: string) => load(file, mocks) };
}
function fixture(worn: boolean | null = null) {
	return {
		today: "2026-10-24",
		timeZone: "UTC",
		daily: { localDate: "2026-10-24", worn },
		eyes: ["left", "right"].map((eye) => ({
			id: null,
			eye,
			replacementDays: 30,
			openedOn: "2026-10-12",
			dueOn: "2026-11-11",
			daysRemaining: 18,
			spareCount: 6,
		})),
	};
}
const label = (button: any) => button.children.props.children as string;

test("actual iOS Today composition has native sections, explicit wear and controlled bounded actions", () => {
	for (const worn of [null, true, false]) {
		const h = harness();
		const writes: any[] = [];
		h.render(h.mocks["./today-content"].default, {
			state: fixture(worn),
			disabled: true,
			onReplace: (eye: string) => writes.push(eye),
			onAdd: () => writes.push("add"),
			onLog: (value: boolean) => writes.push(value),
			onSettings() {},
		});
		assert.deepEqual(
			h.records.Section.map((section) => section.title),
			["Did you wear contact lenses today?", "Lenses", "More"],
		);
		const texts = h.records.Text.map((text) => text.children);
		assert.ok(texts.includes("Replace Nov 11, 2026 · 18 days remaining"));
		assert.ok(
			texts.includes(
				worn === null ? "Not recorded" : `Recorded: ${worn ? "Yes" : "No"}`,
			),
		);
		assert.equal(
			texts.includes("Recording No does not change replacement dates."),
			worn === false,
		);
		const choices = h.records.Button.filter((button) =>
			/^(✓ )?(Yes|No)$/.test(label(button)),
		);
		assert.equal(choices.length, 2);
		assert.deepEqual(
			choices.map((button) => label(button).startsWith("✓")),
			[worn === true, worn === false],
		);
		assert.ok(
			h.records.Column.filter((column) => column.style?.width === "50%")
				.length >= 2,
		);
		for (const button of h.records.Button) button.onPress();
		assert.deepEqual(writes, []);
		assert.equal(
			h.records.Host,
			undefined,
			"content must be inside its owner's measured Host",
		);
		assert.equal(h.records.ScrollView, undefined);
		assert.equal(
			h.records.Button.filter((button) => label(button) === "Add spares")
				.length,
			1,
		);
	}
});

test("actual measured root mounts no native content until finite parent geometry arrives", () => {
	const h = harness();
	let size: any = null;
	h.mocks.react = {
		useState: () => [
			size,
			(next: any) => {
				size = typeof next === "function" ? next(size) : next;
			},
		],
	};
	h.mocks["react-native"] = { View: "MeasuredRoot" };
	const Root = h.load("today-root.tsx").default;
	let tree = Root({ state: fixture() });
	assert.equal(tree.props.children, null);
	for (const [width, height] of [
		[Infinity, 600],
		[393, 0],
		[393, 642],
	]) {
		tree.props.onLayout({ nativeEvent: { layout: { width, height } } });
		tree = Root({ state: fixture() });
	}
	const surface = tree.props.children;
	assert.equal(surface.props.width, 393);
	assert.equal(surface.props.height, 642);
});

function sheetProps() {
	return {
		presented: true,
		busy: false,
		disabled: false,
		locked: false,
		eye: "both",
		quantity: "3",
		error: "",
		reloading: false,
		action: { busy: false, error: "", message: "" },
		onRequestClose() {},
		onDismiss() {},
		onReload() {},
		onEyeChange() {},
		onQuantityChange() {},
		onAdd() {},
	};
}

test("iOS sheet uses one Form/Host, native picker and reports actual dismissal even during pending", () => {
	const h = harness();
	let dismissed = 0;
	let cancelled = 0;
	h.render(h.load("AddContactsSheet.tsx").default, {
		...sheetProps(),
		busy: true,
		disabled: true,
		onDismiss: () => dismissed++,
		onRequestClose: () => cancelled++,
	});
	assert.equal(h.records.Host.length, 1);
	assert.equal(h.records.Form.length, 1);
	assert.equal(h.records.ScrollView, undefined);
	assert.equal(h.records.Picker.length, 1);
	assert.equal(h.records.Picker[0].enabled, false);
	assert.equal(
		h.records.Text.filter((text) => text.children === "Add to").length,
		1,
	);
	const cancel = h.records.Button.find((button) => label(button) === "Cancel");
	assert.equal(cancel.disabled, true);
	cancel.onPress();
	assert.equal(cancelled, 0);
	h.records.Sheet[0].onIsPresentedChange(false);
	assert.equal(
		dismissed,
		1,
		"unexpected system dismissal always informs the draft owner",
	);
});

test("iOS busy-dismiss policy targets the presented Group, not the BottomSheet presenter", () => {
	for (const busy of [false, true]) {
		const h = harness();
		h.render(h.load("AddContactsSheet.tsx").default, {
			...sheetProps(),
			busy,
		});
		const sheet = h.records.Sheet[0];
		assert.equal(sheet.modifiers, undefined);
		assert.equal(h.records.Group.length, 1);
		const presented = h.records.Group[0];
		assert.equal(sheet.children.props.modifiers, presented.modifiers);
		assert.deepEqual(
			Array.from(presented.modifiers, (modifier: any) => modifier.name),
			[
				"interactiveDismissDisabled",
				"presentationDetents",
				"presentationBackground",
			],
		);
		assert.equal(presented.modifiers[0].args[0], busy);
	}
});

test("Add grouped fields use existing positiveInteger validation, lock partial intents and guard invalid submissions", () => {
	for (const quantity of ["", "0", "-1", "1.5", "9007199254740992", "2"]) {
		const h = harness();
		let adds = 0;
		let edits = 0;
		h.render(h.mocks["./AddContactsForm"].default, {
			...sheetProps(),
			quantity,
			locked: true,
			onAdd: () => adds++,
			onEyeChange: () => edits++,
			onQuantityChange: () => edits++,
		});
		const invalid = !!addModel.todayQuantityError(quantity);
		const submit = h.records.Button.find(
			(button) => label(button) === "Finish adding spares",
		);
		assert.equal(submit.disabled, invalid);
		submit.onPress();
		assert.equal(adds, invalid ? 0 : 1);
		assert.equal(h.records.Quantity[0].disabled, true);
		assert.equal(h.records.Quantity[0].label, "Quantity per eye");
		h.records.Quantity[0].onChange("8");
		h.records.Picker[0].onValueChange("right");
		assert.equal(edits, 0);
		assert.ok(
			h.records.Text.some(
				(text) => text.children === model.additionHint("both", true),
			),
		);
		assert.equal(
			h.records.Button.filter((button) => button.variant === "filled").length,
			1,
		);
		if (invalid)
			assert.ok(
				h.records.Text.some(
					(text) => text.children === addModel.todayQuantityError(quantity),
				),
			);
	}
	const h = harness();
	h.render(h.mocks["./AddContactsForm"].default, {
		...sheetProps(),
		eye: "right",
	});
	assert.equal(h.records.Quantity[0].label, "Quantity");
});

test("wear status itself renders optimistically before the server response, and rollback restores unknown", () => {
	for (const selected of [true, false, null]) {
		const h = harness();
		h.mocks["./today-wear"].useTodayWear = () => ({
			selected,
			saving: selected,
			disabled: true,
			choose() {},
		});
		h.render(h.mocks["./today-content"].DailyLogSection, {
			state: fixture(),
			disabled: true,
			onLog() {},
			eyes: fixture().eyes,
		});
		const texts = h.records.Text.map((text) => text.children);
		assert.ok(
			texts.includes(
				selected === null
					? "Not recorded"
					: `Recorded: ${selected ? "Yes" : "No"}`,
			),
		);
		assert.equal(
			texts.some((text) => String(text).startsWith("Saving:")),
			false,
		);
		assert.equal(
			texts.includes("Recording No does not change replacement dates."),
			selected === false,
		);
	}
});
