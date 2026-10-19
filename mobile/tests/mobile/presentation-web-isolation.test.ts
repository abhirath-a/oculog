import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Run actual modules in a fresh Node process. Only platform resolution is changed:
// RN -> RNweb and sibling .web files, just as Metro does. No SDK/module mocks.
const bootstrap = String.raw`
import assert from "node:assert/strict";
import { registerHooks, createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Metro supplies these production compile-time globals.
globalThis.__DEV__ = false;
process.env.EXPO_OS = "web";
const evaluated = new Set();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react-native") specifier = "react-native-web";
    const result = nextResolve(specifier, context);
    if (result.url.startsWith("file:") && /\.(tsx?|jsx?)$/.test(result.url)) {
      const web = result.url.replace(/\.(tsx?|jsx?)$/, ".web.$1");
      if (existsSync(fileURLToPath(web))) {
        evaluated.add(web);
        return { ...result, url: web };
      }
    }
    evaluated.add(result.url);
    return result;
  },
});
const require = createRequire(import.meta.url);
const React = require("react");
// The SDK's own tsconfig uses classic JSX when transformed by tsx, unlike Metro.
globalThis.React = React;
const { renderToStaticMarkup } = require("react-dom/server");
`;

function run(body: string) {
	const result = spawnSync(
		process.execPath,
		["--import", "tsx", "--input-type=module", "-e", bootstrap + body],
		{
			cwd: new URL("../../", import.meta.url),
			encoding: "utf8",
			timeout: 30_000,
		},
	);
	assert.equal(result.status, 0, result.stderr || result.stdout);
}

const assertIsolated = String.raw`
assert.ok(![...evaluated].some(url => /@expo\/ui\/src\/(swift-ui|jetpack-compose)\//.test(url)),
  "Web evaluated a native SDK module: " + [...evaluated].filter(url => /@expo\/ui\/src\/(swift-ui|jetpack-compose)\//.test(url)).join(", "));
`;

test("web choice uses a real controlled select without evaluating native SDK modules", () => {
	run(
		String.raw`
const { ChoiceControl } = require("./src/components/presentation/choice-control");
const props = { label: "Eye", value: "left", options: [{value: "left", label: "Left"}, {value: "right", label: "Right"}], onChange() {} };
const markup = renderToStaticMarkup(React.createElement(ChoiceControl, props));
assert.match(markup, /<select[^>]*aria-label="Eye"/);
assert.match(markup, /<option value="left" selected="">Left<\/option>/);
assert.doesNotMatch(markup, /tabindex="-1"|role="combobox"/);
assert.match(renderToStaticMarkup(React.createElement(ChoiceControl, {...props, disabled: true})), /<select[^>]*disabled=""/);
` + assertIsolated,
	);
});

test("non-input presentation web facades load the real SDK without native imports", () => {
	run(
		String.raw`
for (const path of ["text", "semantic-text", "native-sheet"]) {
  require("./src/components/presentation/" + path);
}
assert.ok([...evaluated].some(url => /@expo\/ui\/src\/universal\/BottomSheet\/index\.tsx$/.test(url)), "real web drawer must be loaded");
` + assertIsolated,
	);
});

test("web presentation barrel eagerly imports safely, including the real SDK web drawer", () => {
	run(
		String.raw`
const presentation = require("./src/components/presentation");
for (const name of ["ChoiceControl", "DateField", "NativeField", "NativeSheet", "PresentationText", "SemanticText", "ScreenFrame"]) {
  assert.equal(typeof presentation[name], "function", name);
}
const heading = renderToStaticMarkup(React.createElement(presentation.SemanticText, { heading: true, accessibilityLabel: "Spoken" }, "Visible"));
assert.match(heading, /role="heading"/);
assert.match(heading, /aria-label="Spoken"/);
const date = renderToStaticMarkup(React.createElement(presentation.DateField, { label: "Opened", value: "2026-03-01", maximum: "2026-03-31", disabled: false, error: "Invalid date", onChange() {} }));
assert.match(date, /type="date"/);
assert.match(date, /max="2026-03-31"/);
assert.match(date, /aria-invalid="true"/);
assert.match(date, /aria-describedby="[^"]+-error"/);
assert.match(date, /role="alert"/);
assert.match(date, /<button[^>]*type="button"[^>]*>Clear opened<\/button>/);
` + assertIsolated,
	);
});

test("UI and Home entry points use web controls without evaluating native SDK modules", () => {
	run(
		String.raw`
const ui = require("./src/components/ui");
const home = require("./src/components/home/HomeContent");
const { DailyChoice } = require("./src/components/home/daily-choice");
assert.equal(typeof home.default, "function");
assert.ok([...evaluated].some(url => url.endsWith("/home/HomeContent.web.tsx")));
assert.ok([...evaluated].some(url => url.endsWith("/home/daily-choice.web.tsx")));
assert.ok([...evaluated].some(url => url.endsWith("/components/ui-controls.web.tsx")));
const button = renderToStaticMarkup(React.createElement(ui.Button, {title: "Save", onPress() {}}));
assert.match(button, /<button[^>]*type="button"/);
const disabled = renderToStaticMarkup(React.createElement(ui.Button, {title: "Save", disabled: true, onPress() {}}));
assert.match(disabled, /<button[^>]*disabled=""/);
const toggle = renderToStaticMarkup(React.createElement(ui.Toggle, {label: "Reminders", value: true, disabled: false, onChange() {}}));
assert.match(toggle, /<label/);
assert.match(toggle, /type="checkbox"[^>]*role="switch"/);
assert.match(toggle, /checked=""/);
const daily = renderToStaticMarkup(React.createElement(DailyChoice, {worn: null, disabled: false, onLog() {}}));
assert.equal((daily.match(/type="radio"/g) || []).length, 2);
assert.doesNotMatch(daily, /checked=""/);
` + assertIsolated,
	);
});

test("web route dependencies import without evaluating native UI modules", () => {
	run(
		String.raw`
require("./src/components/auth/session-state");
` + assertIsolated,
	);
});

test("Metro production web graph selects web Home and UI without native SDK modules", {
	skip:
		!process.env.EXPO_WEB_EXPORT_DIR &&
		"Set EXPO_WEB_EXPORT_DIR to an expo export --platform web --source-maps output",
}, () => {
	const directory = join(
		process.env.EXPO_WEB_EXPORT_DIR!,
		"_expo/static/js/web",
	);
	const sources = readdirSync(directory)
		.filter((name) => name.endsWith(".map"))
		.flatMap(
			(name) =>
				(
					JSON.parse(readFileSync(join(directory, name), "utf8")) as {
						sources: string[];
					}
				).sources,
		);
	assert.ok(sources.length > 0);
	assert.deepEqual(
		sources.filter((path) =>
			/@expo\/ui\/src\/(swift-ui|jetpack-compose)\//.test(path),
		),
		[],
	);
	for (const path of [
		"home/HomeContent.web.tsx",
		"home/daily-choice.web.tsx",
		"ui-controls.web.tsx",
		"presentation/native-field.web.tsx",
	]) {
		assert.ok(
			sources.some((source) => source.endsWith(`/components/${path}`)),
			path,
		);
	}
	assert.ok(
		sources.some((source) => source.endsWith("/app/(tabs)/_layout.web.tsx")),
	);
	assert.ok(sources.some((source) => source.endsWith("/app/auth.tsx")));
	assert.ok(
		!sources.some((source) =>
			/components\/(home\/(HomeContent|daily-choice)\.tsx|ui-controls\.native\.tsx)$/.test(
				source,
			),
		),
	);
});

test("isolation check detects an eager native modifier import even when never rendered", () => {
	// Negative control: execute the installed SDK, not a fake throwing import.
	// It may throw ExpoUI while evaluating SwiftUI; either way native code was loaded.
	run(String.raw`
for (const platform of ["swift-ui", "jetpack-compose"]) {
  try { require("@expo/ui/" + platform + "/modifiers"); } catch {}
  assert.ok([...evaluated].some(url => url.includes("/@expo/ui/src/" + platform + "/modifiers/index.ts")), platform);
}
`);
});
