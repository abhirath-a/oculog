import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as homeModel from "../../src/components/home/model";
import { webTypography } from "../../src/components/presentation/web-typography";

const require = createRequire(import.meta.url);
const rn = require("react-native-web");
const { renderToStaticMarkup } = require("react-dom/server");
function load(path: string, mocks: Record<string, unknown>) {
	const exports: Record<
		string,
		React.ComponentType<Record<string, unknown>>
	> = {};
	runInNewContext(
		ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
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
	return exports;
}
const shared = {
	react: React,
	"react/jsx-runtime": require("react/jsx-runtime"),
	"react-native": rn,
};
const { RNHostView } = load(
	"../../node_modules/@expo/ui/src/universal/RNHostView/index.tsx",
	{ ...shared, "../hooks": { useUniversalLifecycle: () => {} }, "./types": {} },
);
const text = load("../../src/components/presentation/text.tsx", {
	...shared,
	"@expo/ui": {
		RNHostView,
		Text: () =>
			assert.fail(
				"web must not use universal Text that ignores semantic modifiers",
			),
	},
	"@expo/ui/jetpack-compose/modifiers": {},
	"@expo/ui/swift-ui/modifiers": {},
	"./theme": {
		usePresentationTheme: () => ({
			text: "#000000",
			secondary: "#636366",
			error: "#A32C22",
		}),
	},
});

test("browser typography uses one system stack and font-relative leading", () => {
	const browserText = load("../../src/components/presentation/text.web.tsx", {
		...shared,
		"./web-typography": { webTypography },
		"./theme": {
			usePresentationTheme: () => ({ text: "#000", primary: "#066" }),
		},
	});
	const markup = renderToStaticMarkup(
		React.createElement(
			browserText.PresentationText,
			{
				role: "body",
				heading: true,
				accessibilityLabel: "Readable heading",
			},
			"Heading",
		),
	);
	assert.match(markup, /<h1\b/);
	assert.match(markup, /aria-label="Readable heading"/);
	assert.match(markup, /font-family:system-ui, &quot;Segoe UI&quot;/);
	assert.match(markup, /line-height:1.5;/);
	assert.doesNotMatch(markup, /line-height:\d+px/);
});

test("web Settings keeps complete interval and date lines inside one navigation link", () => {
	const overview = load("../../src/components/settings/overview.web.tsx", {
		...shared,
		"../presentation": {
			ScreenFrame: ({ children }: { children: React.ReactNode }) => children,
			PresentationText: ({ children }: { children: React.ReactNode }) =>
				children,
			usePresentationTheme: () => ({
				primary: "#066",
				secondary: "#666",
				divider: "#ccc",
			}),
		},
		"../presentation/web-typography": { webTypography },
		"../ui": { Button: () => null },
	});
	const summary =
		"Left · 28 days; Right · 14 days\nLeft · Opened on 2026-10-18; Right · Opened on 2026-10-17";
	for (const disabled of [false, true]) {
		const markup = renderToStaticMarkup(
			React.createElement(overview.default, {
				model: {
					accountDisabled: disabled,
					email: "reader@example.com",
					timeZone: "America/New York",
				},
				summary,
				onEdit() {},
			}),
		);
		assert.equal((markup.match(/<a\b/g) ?? []).length, 1);
		assert.equal(markup.includes('href="/lens-editor"'), !disabled);
		assert.match(markup, new RegExp(`aria-disabled="${disabled}"`));
		assert.match(markup, /display:grid;gap:0.5em/);
		assert.ok(
			markup.includes("<span>Left: 28 days · Opened 18 Oct 2026</span>"),
		);
		assert.ok(
			markup.includes("<span>Right: 14 days · Opened 17 Oct 2026</span>"),
		);
		assert.match(markup, /text-decoration:none/);
		assert.match(markup, /:focus-visible.*outline: 2px solid/);
		assert.match(markup, /:hover.*background-color/);
		assert.match(markup, /:active.*background-color/);
		assert.match(markup, /<svg aria-hidden="true" focusable="false"/);
		assert.doesNotMatch(
			markup.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]*>/g, ""),
			/;|2026-10/,
		);
	}
	for (const [summary, left, right] of [
		[
			"Both eyes · Not set\nNo open lenses",
			"Interval not set · No open lens",
			"Interval not set · No open lens",
		],
		[
			"Both eyes · 1 day\nBoth lenses · opened on 2026-01-01",
			"1 day · Opened 1 Jan 2026",
			"1 day · Opened 1 Jan 2026",
		],
		[
			"Left · Not set; Right · 14 days\nLeft · No open lens; Right · Opened on 2026-03-08",
			"Interval not set · No open lens",
			"14 days · Opened 8 Mar 2026",
		],
	]) {
		const markup = renderToStaticMarkup(
			React.createElement(overview.default, {
				model: {},
				summary,
				onEdit() {},
			}),
		);
		assert.ok(markup.includes(`<span>Left: ${left}</span>`));
		assert.ok(markup.includes(`<span>Right: ${right}</span>`));
	}
});

test("actual RNweb DOM SemanticText renders a heading and accessible label through the installed RNHostView", () => {
	const markup = renderToStaticMarkup(
		React.createElement(
			text.SemanticText,
			{
				role: "largeTitle",
				heading: true,
				accessibilityLabel: "Spoken heading",
			},
			"Visible heading",
		),
	);
	assert.match(markup, /<h1\b[^>]*role="heading"[^>]*>/);
	assert.match(markup, /aria-label="Spoken heading"/);
	assert.match(markup, />Visible heading<\//);
	const body = renderToStaticMarkup(
		React.createElement(
			text.SemanticText,
			{
				role: "body",
				accessibilityLabel: "Spoken body",
			},
			"Readable body",
		),
	);
	assert.doesNotMatch(body, /role="heading"/);
	assert.match(body, /aria-label="Spoken body"/);
});

test("actual auth intro retains its single Welcome DOM heading with shared semantic text", () => {
	const intro = load("../../src/components/auth/intro.tsx", {
		...shared,
		"@expo/ui": { Column: rn.View },
		"../presentation": text,
	});
	const markup = renderToStaticMarkup(
		React.createElement(intro.AuthIntro, {
			title: "Welcome",
		}),
	);
	assert.equal((markup.match(/role="heading"/g) ?? []).length, 1);
	assert.match(markup, /<h1\b[^>]*role="heading"[^>]*>Welcome<\/h1>/);
	assert.doesNotMatch(markup, /Oculog/);
	assert.equal(markup.replace(/<[^>]*>/g, ""), "Welcome");
});

test("actual shared Home eye card keeps its accessible DOM heading", () => {
	const home = load("../../src/components/home/HomeContent.tsx", {
		...shared,
		"@expo/ui": { Column: rn.View, Row: rn.View, Button: rn.View },
		// This explicitly loaded native presenter legitimately imports Compose.
		// Metro's web entry is checked independently below and in the unmocked
		// presentation-web-isolation tests, rather than banning native imports here.
		"@expo/ui/jetpack-compose/modifiers": {
			fillMaxWidth: (fraction?: number) => ({
				$type: "fillMaxWidth",
				fraction,
			}),
			weight: (value: number) => ({ $type: "weight", value }),
		},
		"@expo/ui/swift-ui/modifiers": {},
		"../presentation": text,
		"./daily-choice": {},
		"./model": homeModel,
	});
	const markup = renderToStaticMarkup(
		React.createElement(home.EyeCard, {
			settings: {
				id: null,
				eye: "left",
				openedOn: "2026-03-01",
				dueOn: "2026-03-15",
				replacementDays: 14,
				spareCount: 2,
				daysRemaining: 2,
			},
			disabled: false,
			onReplace: () => {},
			onSettings: () => {},
		}),
	);
	assert.equal((markup.match(/role="heading"/g) ?? []).length, 1);
	assert.match(markup, /<h1\b[^>]*role="heading"[^>]*>Left lens<\/h1>/);
});

test("Metro-selected web Home and daily choice have no direct native SDK dependencies", () => {
	// Keep the import whitelist narrow: loading either web entry fails if it
	// imports any SDK module, including a native modifier just for initialization.
	const choice = load("../../src/components/home/daily-choice.web.tsx", {
		...shared,
		"../presentation": text,
		"../presentation/web-typography": { webTypography },
	});
	const home = load("../../src/components/home/HomeContent.web.tsx", {
		...shared,
		"../presentation": text,
		"./daily-choice": choice,
		"../presentation/web-typography": { webTypography },
		"./model": homeModel,
	});
	assert.equal(typeof home.default, "function");
	assert.equal(typeof choice.DailyChoice, "function");
});
