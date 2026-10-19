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

test("native and web tabs are authenticated, account-keyed and labelled Today / Settings", () => {
	for (const path of ["app/(tabs)/_layout.tsx", "app/(tabs)/_layout.web.tsx"]) {
		const layout = source(path);
		assert.match(layout, /!store.ready/);
		assert.match(layout, /!store.account/);
		assert.match(layout, /key=\{store.account.id\}/);
		assert.match(layout, /name="home"/);
		assert.match(layout, /name="settings"/);
		assert.match(layout, /Today/);
		assert.match(layout, /Settings/);
	}
	const native = source("app/(tabs)/_layout.tsx");
	assert.match(native, /expo-router\/unstable-native-tabs/);
	assert.match(native, /Trigger.Icon sf="house.fill" md="home"/);
	assert.match(native, /Trigger.Icon sf="gear" md="settings"/);
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

test("web tabs are contained on desktop with generous labelled click targets", () => {
	const web = source("app/(tabs)/_layout.web.tsx");
	assert.match(web, /useWindowDimensions/);
	assert.match(web, /maxWidth: 1200/);
	assert.match(
		web,
		/minHeight: desktop \? 64 \+ insets.top : 66 \+ insets.bottom/,
	);
	assert.match(web, /minHeight: 48/);
	assert.match(web, /tabBarAllowFontScaling: true/);
	assert.match(web, /tabBarIcon:/);
	assert.match(web, /title: "Today"/);
	assert.match(web, /title: "Settings"/);
});

test("web tab row uses available width and grows for enlarged labels", () => {
	const web = source("app/(tabs)/_layout.web.tsx");
	assert.match(web, /tabBarStyle:\s*\{[\s\S]*?height: "auto"/);
	assert.match(web, /tabBarStyle:\s*\{[\s\S]*?alignItems: "stretch"/);
	assert.match(web, /tabBarLabelStyle:\s*\{[^}]*flexShrink: 0/);
});

test("focused editor and optional onboarding have router-owned titles outside tabs", () => {
	const root = source("app/_layout.tsx");
	for (const route of ["lens-editor", "onboarding"]) {
		const options = root.match(
			new RegExp(`name="${route}"\\s+options=\\{\\{([^}]+)\\}\\}`),
		)?.[1];
		assert.ok(options, `${route} has router-owned options`);
		assert.match(options, /\btitle:\s*"Lens setup"/);
		assert.match(options, /\bheaderShown:\s*true\b/);
		assert.match(options, /\bheaderBackButtonMenuEnabled:\s*false\b/);
		for (const path of [
			"app/(tabs)/_layout.tsx",
			"app/(tabs)/_layout.web.tsx",
		]) {
			assert.doesNotMatch(source(path), new RegExp(`name="${route}"`));
		}
	}
	assert.match(root, /name="\(tabs\)" options=\{\{ headerShown: false \}\}/);
	assert.doesNotMatch(root, /ToolbarView|animation:/);
	assert.match(source("app/(tabs)/_layout.web.tsx"), /animation: "none"/);
});

test("native editor retains platform fields, feedback and a single native scroll owner", () => {
	const native = source("components/settings/form.tsx");
	assert.match(native, /@expo\/ui/);
	assert.match(native, /<Host key=\{paletteEpoch\}/);
	assert.match(native, /<FieldGroup.Section/);
	assert.match(native, /<Switch/);
	assert.match(native, /<DateField/);
	assert.match(native, /accessibilityLiveRegion=/);
	assert.match(native, /<NativeFields>/);
	assert.doesNotMatch(
		native,
		/<ScrollView|<RNHostView matchContents|<Field\s|<Txt|<Page/,
	);
	const android = source("components/settings/native-fields.android.tsx");
	assert.match(android, /<Column/);
	assert.match(android, /verticalScroll\(\)/);
	assert.doesNotMatch(android, /<LazyColumn|<FlatList|<ScrollView/);
});

test("native tabs remain exactly two peers without custom transitions or toolbar APIs", () => {
	const native = source("app/(tabs)/_layout.tsx");
	assert.equal((native.match(/<NativeTabs.Trigger name=/g) ?? []).length, 2);
	assert.doesNotMatch(native, /ToolbarView|animation|Reanimated/);
});
