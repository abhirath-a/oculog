// biome-ignore-all lint/suspicious/noExplicitAny: Executable iOS JSX contract harness, not device rendering evidence.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { SimpleState } from "../../shared/simple-domain";
import * as todayModel from "../../src/components/home/today-model";
const require = createRequire(import.meta.url);
const state: SimpleState = {
	today: "2026-04-01",
	timeZone: "UTC",
	daily: { localDate: "2026-04-01", worn: null },
	eyes: ["left", "right"].map((eye) => ({
		id: null,
		eye: eye as "left" | "right",
		replacementDays: 14,
		openedOn: "2026-03-01",
		dueOn: "2026-03-15",
		daysRemaining: -17,
		spareCount: 0,
	})),
};
function presenter() {
	const records: Record<string, any[]> = {};
	const control = (name: string) => (props: any) => {
		(records[name] ??= []).push(props);
		return React.createElement("div", null, props.children);
	};
	const modifiers = Object.fromEntries(
		[
			"frame",
			"accessibilityLabel",
			"accessibilityValue",
			"accessibilityAddTraits",
		].map((name) => [name, (...args: any[]) => ({ name, args })]),
	);
	const mocks: Record<string, any> = {
		react: React,
		"react/jsx-runtime": require("react/jsx-runtime"),
		"@expo/ui": {
			Column: control("Column"),
			Row: control("Row"),
			Button: control("Button"),
		},
		"@expo/ui/swift-ui/modifiers": modifiers,
		"../presentation": {
			usePresentationTheme: () => ({
				primary: "teal",
				surface: "white",
				text: "black",
				onPrimary: "white",
			}),
		},
		"./today-model": todayModel,
		"./today-design": Object.fromEntries(
			[
				"TodaySection",
				"TodayRow",
				"TodayText",
				"TodayAction",
				"TodayDisclosure",
			].map((name) => [name, control(name)]),
		),
		"../../lib/api": { sessionStore: { token: "token" } },
		"../../lib/store": {
			useStore: () => ({ account: { id: "owner" }, online: true, error: "" }),
		},
	};
	function load(name: string) {
		const exports: any = {};
		runInNewContext(
			ts.transpileModule(
				readFileSync(
					new URL(`../../src/components/home/${name}`, import.meta.url),
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
		return exports;
	}
	mocks["./today-wear"] = load("today-wear.ts");
	const content = load("today-content.tsx");
	return {
		records,
		render(props: any) {
			renderToStaticMarkup(React.createElement(content.default, props));
		},
		renderDaily(props: any) {
			renderToStaticMarkup(React.createElement(content.DailyLogSection, props));
		},
	};
}
const base = {
	state,
	disabled: false,
	pairedEyes: false,
	onLog(_value: boolean) {},
	onReplace(_eye: "left" | "right") {},
	onSettings() {},
	onAdd() {},
};
test("iOS canonical Home keeps intrinsic, vertically ordered native lens rows and truthful zero stock", () => {
	const h = presenter();
	h.render(base);
	assert.deepEqual(
		h.records.TodayText.filter((node) =>
			["Left", "Right"].includes(node.children),
		).map((node) => node.children),
		["Left", "Right"],
	);
	assert.equal(
		h.records.TodayText.filter((node) => node.children === "17 days overdue")
			.length,
		2,
	);
	assert.equal(
		h.records.TodayText.filter((node) => node.children === "0 spares").length,
		2,
	);
	assert.ok(h.records.TodayRow.every((row) => row.style?.height === undefined));
	assert.equal(
		h.records.TodayAction.filter((node) => /^Replace /.test(node.label)).length,
		0,
		"no replacement without inventory",
	);
	assert.equal(
		h.records.TodayAction.filter((node) => node.label === "Add spares").length,
		1,
	);
});
test("iOS daily choices are controlled, explicit, accessible and disabled callbacks cannot write", () => {
	for (const worn of [null, true, false]) {
		for (const disabled of [false, true]) {
			const h = presenter();
			const writes: boolean[] = [];
			h.renderDaily({
				state: { ...state, daily: { ...state.daily, worn } },
				eyes: state.eyes,
				disabled,
				onLog: (value: boolean) => writes.push(value),
			});
			const choices = h.records.TodayAction;
			assert.deepEqual(
				choices.map((button) => button.label),
				["Yes", "No"],
			);
			assert.deepEqual(
				choices.map((button) => button.selected),
				[worn === true, worn === false],
			);
			for (const button of choices) {
				assert.equal(button.disabled, disabled);
				button.onPress();
			}
			assert.deepEqual(
				writes,
				disabled ? [] : [true],
				"actual hook locks the second callback synchronously",
			);
			// Native selected traits and hit target are verified on TodayAction itself
			// in today-design-system.test.ts, not on the unused daily-choice helper.
		}
	}
});
test("canonical Home delegates to the measured iOS root and has no platform overrides", () => {
	const read = (file: string) =>
		readFileSync(
			new URL(`../../src/components/home/${file}`, import.meta.url),
			"utf8",
		);
	assert.match(read("HomeContent.tsx"), /default.*from "\.\/today-root"/);
	assert.match(read("today-root.tsx"), /onLayout/);
	for (const file of [
		"HomeContent.android.tsx",
		"HomeContent.web.tsx",
		"AddContactsForm.android.tsx",
	])
		assert.equal(
			existsSync(new URL(`../../src/components/home/${file}`, import.meta.url)),
			false,
		);
});
