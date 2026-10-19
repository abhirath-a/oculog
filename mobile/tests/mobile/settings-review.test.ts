import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { webTypography } from "../../src/components/presentation/web-typography";
import * as calendar from "../../src/components/settings/calendar";
import { scheduleCommands } from "../../src/components/settings/schedule";
import type { SettingsModel } from "../../src/components/settings/use-schedule-settings";
import { calendarDate } from "../../src/lib/simple-controller";

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
	if (Array.isArray(value)) return value.flatMap(nodes);
	if (!value || typeof value !== "object" || !("props" in value)) return [];
	const node = value as Node;
	return [node, ...nodes(node.props.children)];
}
function load(file: string, instant?: string) {
	const jsx = (type: unknown, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react: {
			useEffect: () => {},
			useRef: (current: unknown) => ({ current }),
			useId: () => "test",
		},
		"react-native": { View: "View", ActivityIndicator: "Spinner" },
		"@expo/ui": {
			Button: "Button",
			Host: "Host",
			Switch: "Switch",
			FieldGroup: { Section: "Section", SectionFooter: "Footer" },
		},
		"../presentation": {
			ScreenFrame: "ScreenFrame",
			SemanticText: "SemanticText",
			PresentationText: "Text",
			DateField: "DateField",
			usePresentationEpoch: () => 0,
			usePresentationTheme: () => ({}),
		},
		"../ui": { Button: "Button" },
		"../presentation/web-typography": { webTypography },
		"./calendar": calendar,
		"./days": { __esModule: true, default: "Days" },
		"./native-fields": { __esModule: true, default: "NativeFields" },
		"./section": { __esModule: true, default: "Section" },
		"./switch": { __esModule: true, default: "Switch" },
	};
	const exports = {} as { default: (props: Record<string, unknown>) => Node };
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/settings/${file}`, import.meta.url),
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
			...(instant
				? {
						Date: class extends Date {
							constructor() {
								super(instant);
							}
						},
					}
				: {}),
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	return exports.default;
}

test("native and web date bounds use the account day when device day differs, including DST", () => {
	const previous = process.env.TZ;
	const instant = "2026-03-08T10:30:00Z";
	try {
		for (const [device, account] of [
			["America/Los_Angeles", "Pacific/Kiritimati"],
			["Pacific/Kiritimati", "America/Los_Angeles"],
		]) {
			process.env.TZ = device;
			const today = calendarDate(account, new Date(instant));
			assert.notEqual(calendar.localDateString(new Date(instant)), today);
			// Existing date-only bridges must preserve the server's day in either zone.
			assert.equal(calendar.localDateString(calendar.localDate(today)), today);
			assert.equal(
				calendar.composeDateString(new Date(calendar.composeDate(today))),
				today,
			);
			const model = {
				today,
				draft: {
					leftDays: "14",
					rightDays: "30",
					leftOpened: today,
					rightOpened: "",
					differentIntervals: true,
					differentDates: true,
				},
				fieldErrors: {},
				savedEvent: 0,
				disabled: false,
			};
			for (const file of ["form.tsx", "form.web.tsx"]) {
				const dates = nodes(load(file, instant)({ model })).filter(
					(node) =>
						node.type === "DateField" ||
						(node.type === "input" && node.props.type === "date"),
				);
				assert.equal(dates.length, 2);
				for (const date of dates)
					assert.equal(
						date.props.maximum ?? date.props.max,
						today,
						`${file}: ${device} / ${account}`,
					);
			}
			assert.equal(
				scheduleCommands(model.draft, account, today)[0].openedOn,
				today,
			);
			assert.throws(() =>
				scheduleCommands(
					{ ...model.draft, leftOpened: `${today}x` },
					account,
					today,
				),
			);
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("disabled lens link has no destination and rejects ordinary and modified activation", () => {
	const render = load("overview.web.tsx");
	for (const disabled of [true, false]) {
		let navigations = 0;
		const model = { accountDisabled: disabled } as SettingsModel;
		const link = nodes(
			render({
				model,
				summary: "Lens summary",
				onEdit: () => {
					navigations++;
				},
			}),
		).find((node) => node.type === "a");
		assert.ok(link);
		assert.equal(link.props.href, disabled ? undefined : "/lens-editor");
		assert.equal(link.props["aria-disabled"], disabled);
		assert.equal(link.props.role, disabled ? "link" : undefined);
		assert.equal(link.props.tabIndex, 0);
		for (const modifiers of [
			{},
			{ ctrlKey: true },
			{ metaKey: true },
			{ shiftKey: true },
			{ altKey: true },
			{ button: 1 },
		]) {
			let prevented = false;
			const before = navigations;
			(link.props.onClick as (event: unknown) => void)({
				button: 0,
				...modifiers,
				preventDefault: () => {
					prevented = true;
				},
			});
			const ordinary = Object.keys(modifiers).length === 0;
			assert.equal(prevented, disabled || ordinary);
			assert.equal(navigations - before, !disabled && ordinary ? 1 : 0);
		}
	}
});
