import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
	new URL("../../src/components/onboarding/index.tsx", import.meta.url),
	"utf8",
);

test("onboarding reuses the schedule controller without account chrome", () => {
	assert.match(source, /useScheduleSettings\(state\)/);
	assert.match(source, /<SettingsForm model=\{model\} onboarding/);
	assert.match(source, /usePreventRemove\(model.busy/);
	assert.match(source, /disabled=\{model.accountDisabled\}/);
	assert.match(source, /model.message === "Changes saved\."/);
	assert.match(source, /title="Skip" variant="text"/);
});

test("onboarding skip is session-guarded and performs no persistence", () => {
	const skip = source
		.slice(source.indexOf("const skip ="), source.indexOf("if (store.state)"))
		.replace(/\/\/.*$/gm, "");
	assert.match(skip, /sessionStore\.account\?\.id !== owner/);
	assert.match(skip, /sessionStore\.token !== token/);
	assert.match(skip, /router\.replace\("\/\(tabs\)\/home"\)/);
	assert.doesNotMatch(skip, /mutate|persist|save|logout|authenticate/);
});
