import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("root gate has one deterministic authenticated destination without index collision", () => {
	const root = source("app/index.tsx");
	assert.match(root, /!store.ready/);
	assert.match(root, /!store.account/);
	assert.match(root, /Redirect href="\/auth"/);
	assert.match(root, /Redirect href="\/\(tabs\)\/home"/);
	assert.equal(
		existsSync(new URL("../../src/app/(tabs)/index.tsx", import.meta.url)),
		false,
	);
});

test("iOS tabs are authenticated, account-keyed and labelled Today / Account", () => {
	for (const path of ["app/(tabs)/_layout.tsx"]) {
		const layout = source(path);
		assert.match(layout, /!store.ready/);
		assert.match(layout, /!store.account/);
		assert.match(layout, /key=\{store.account.id\}/);
		assert.match(layout, /name="home"/);
		assert.match(layout, /name="settings"/);
		assert.match(layout, /Today/);
		assert.match(layout, /Account/);
	}
	const native = source("app/(tabs)/_layout.tsx");
	assert.match(native, /expo-router\/native-tabs/);
	assert.match(native, /Trigger.Icon sf="house.fill"/);
	assert.match(native, /Trigger.Icon sf="gear"/);
});

test("root provider has login only and obsolete email routes are absent", () => {
	const root = source("app/_layout.tsx");
	assert.match(root, /<Provider>/);
	assert.match(root, /name="auth"/);
	for (const route of ["reset-password", "verify-email", "confirm-email"]) {
		assert.ok(!root.includes(`name="${route}"`));
		assert.equal(
			existsSync(new URL(`../../src/app/${route}.tsx`, import.meta.url)),
			false,
		);
	}
});

test("navigation keeps OS theme semantics while sharing presentation colors and native tab surfaces", () => {
	const root = source("app/_layout.tsx");
	assert.match(root, /useColorScheme\(\)/);
	assert.match(root, /scheme === "dark" \? DarkTheme : DefaultTheme/);
	assert.match(root, /\.\.\.baseTheme/);
	assert.match(root, /headerTintColor: colors.accent/);
	assert.match(root, /background: colors.bg/);
	assert.match(root, /text: colors.text/);
	assert.doesNotMatch(source("app/(tabs)/_layout.tsx"), /backgroundColor=/);
});

test("focused editor and optional onboarding have router-owned titles outside tabs", () => {
	const root = source("app/_layout.tsx");
	for (const route of ["lens-editor", "onboarding"]) {
		const options = root.match(
			new RegExp(`name="${route}"\\s+options=\\{\\{([^}]+)\\}\\}`),
		)?.[1];
		assert.ok(options, `${route} has router-owned options`);
		assert.match(options, /\btitle:\s*"Lens setup"/);
		assert.match(
			options,
			new RegExp(
				`\\bheaderShown:\\s*${route === "onboarding" ? "false" : "true"}\\b`,
			),
		);
		assert.match(options, /\bheaderBackButtonMenuEnabled:\s*false\b/);
		for (const path of ["app/(tabs)/_layout.tsx"]) {
			assert.doesNotMatch(source(path), new RegExp(`name="${route}"`));
		}
	}
	assert.match(root, /name="\(tabs\)"\s+options=\{\{[^}]*headerShown: false/);
	assert.doesNotMatch(root, /ToolbarView|animation:/);
});

test("native editor retains platform fields, feedback and a single native scroll owner", () => {
	const native = source("components/settings/editor-form.tsx");
	assert.match(native, /<OnboardingPage/);
	assert.match(native, /<LensSetupFields/);
	assert.match(native, /<TodayFeedback/);
	const page = source("components/onboarding/page.tsx");
	assert.equal((page.match(/<Host\b/g) ?? []).length, 1);
	assert.equal((page.match(/<ScrollView\b/g) ?? []).length, 1);
	assert.doesNotMatch(native, /<ScrollView|<Host|Toolbar/);
});

test("iOS tabs retain the five product destinations without custom transitions or toolbars", () => {
	const native = source("app/(tabs)/_layout.tsx");
	assert.deepEqual(
		[...native.matchAll(/<NativeTabs.Trigger name="([^"]+)"/g)].map(
			(m) => m[1],
		),
		["home", "logs", "advice", "learn", "settings"],
	);
	assert.doesNotMatch(native, /ToolbarView|animation|Reanimated/);
});
