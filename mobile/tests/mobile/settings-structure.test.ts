import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SimpleState } from "../../shared/simple-domain";
import { lensSummary } from "../../src/components/settings/summary";

const source = (name: string) =>
	readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8");

test("lens summary distinguishes shared, per-eye, missing intervals and opened dates", () => {
	const state = {
		eyes: [
			{ eye: "left", replacementDays: 14, openedOn: "2026-03-20" },
			{ eye: "right", replacementDays: 14, openedOn: "2026-03-20" },
		],
	} as SimpleState;
	assert.equal(
		lensSummary(state),
		"Both eyes · 14 days\nBoth lenses · opened on 2026-03-20",
	);
	state.eyes[1].replacementDays = 30;
	state.eyes[1].openedOn = null;
	assert.equal(
		lensSummary(state),
		"Left · 14 days; Right · 30 days\nLeft · Opened on 2026-03-20; Right · No open lens",
	);
	for (const eye of state.eyes) {
		eye.replacementDays = null;
		eye.openedOn = null;
	}
	assert.equal(lensSummary(state), "Both eyes · Not set\nNo open lenses");
});

test("lens route waits for readiness, redirects without an account, and keys editor by account", () => {
	const store = { ready: false, account: null as null | { id: string } };
	const jsx = (type: unknown, props: unknown, key?: string) => ({
		type,
		props,
		key,
	});
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx },
		"expo-router": { Redirect: "Redirect" },
		"../components/auth/session-state": { SessionRestoring: "Restoring" },
		"../components/settings/lens-editor": {
			__esModule: true,
			default: "LensEditor",
		},
		"../lib/store": { useStore: () => store },
	};
	const exports = {} as {
		default: () => { type: unknown; props: { href?: string }; key?: string };
	};
	runInNewContext(
		ts.transpileModule(source("app/lens-editor.tsx"), {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	assert.equal(exports.default().type, "Restoring");
	store.ready = true;
	assert.equal(exports.default().props.href, "/auth");
	store.account = { id: "owner-a" };
	assert.equal(exports.default().type, "LensEditor");
	assert.equal(exports.default().key, "owner-a");
	store.account = { id: "owner-b" };
	assert.equal(exports.default().key, "owner-b");
});

test("overview has grouped navigation and account rows, not schedule fields or save", () => {
	const overview = source("components/settings/overview-content.tsx");
	assert.match(
		overview,
		/<EditorLink disabled=\{m.accountDisabled\} onEdit=\{onEdit\}/,
	);
	assert.match(
		source("components/settings/editor-link.tsx"),
		/label="Edit lens setup"/,
	);
	assert.match(overview, /m\.email/);
	assert.match(overview, /label="Sign out"/);
	assert.doesNotMatch(overview, /<Days|<DateField|Save changes|m\.save/);
	const settings = source("components/settings/screen.tsx");
	assert.match(settings, /lensSummary\(state\)/);
	assert.match(settings, /router\.push\("\/lens-editor"\)/);
	assert.doesNotMatch(settings, /<SettingsForm/);
});

test("busy editor removal is guarded, ordinary back has no draft writes or warning", () => {
	const editor = source("components/settings/lens-editor.tsx");
	assert.match(editor, /usePreventRemove\(model.busy, \(\) => \{\}\)/);
	assert.match(editor, /<SettingsForm model=\{model\}/);
	assert.doesNotMatch(editor, /mutate|confirm\(|beforeRemove|Toolbar/);
});
