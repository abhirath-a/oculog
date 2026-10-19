import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("auth foundation uses one modest accessible task heading and readable non-glass fields", () => {
	const intro = source("components/auth/intro.tsx");
	assert.match(intro, /role="title" heading/);
	assert.doesNotMatch(intro, /largeTitle|description|Oculog/);
	const ui = source("components/ui.tsx");
	const field = source("components/presentation/native-field.tsx");
	assert.match(field, /<TextInput/);
	assert.match(field, /borderWidth: 1/);
	assert.match(field, /secureTextEntry=\{secure\}/);
	assert.doesNotMatch(field, /glassEffect|buttonStyle/);
	assert.doesNotMatch(ui, /useMemo/);
});

test("every shell restoration gate gives context beyond a spinner", () => {
	for (const path of [
		"app/index.tsx",
		"app/(tabs)/_layout.tsx",
		"app/(tabs)/_layout.web.tsx",
	])
		assert.match(source(path), /<SessionRestoring/);
	const loading = source("components/auth/session-state.tsx");
	assert.match(loading, /Opening your journal/);
	assert.match(loading, /securely saved session/);
	assert.match(loading, /accessibilityLiveRegion="polite"/);
});

test("auth keeps feedback but exposes no email action links", () => {
	const auth = source("app/auth.tsx");
	assert.match(
		auth,
		/busyLabel=\{register \? "Creating account…" : "Signing in…"\}/,
	);
	assert.doesNotMatch(
		auth,
		/requestVerification|resetPassword|confirmEmailChange|Confirmation token|Forgot password/,
	);
});
