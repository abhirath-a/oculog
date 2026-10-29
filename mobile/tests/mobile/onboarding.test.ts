import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source = readFileSync(
	new URL("../../src/components/onboarding/index.tsx", import.meta.url),
	"utf8",
);

test("staged onboarding reuses the schedule controller and its synchronous save lock", () => {
	assert.match(source, /useScheduleSettings\(state\)/);
	assert.match(
		source,
		/<LensSetupFields model=\{model\} change=\{change\} current=\{current\}/,
	);
	assert.match(source, /usePreventRemove\(model.busy/);
	assert.match(source, /model.message !== "Changes saved\."/);
	assert.match(source, /model.validationEvent !== pending.validationEvent/);
	assert.match(source, /JSON.stringify\(model.draft\) !== pending.draft/);
});
test("explore never persists and identity fences navigation", () => {
	const leave = source.slice(
		source.indexOf("const leave ="),
		source.indexOf("// Retain the loaded controller"),
	);
	assert.match(leave, /!current\(\) \|\| store.pending/);
	assert.match(leave, /router.replace\("\/\(tabs\)\/home"\)/);
	assert.doesNotMatch(
		leave.replace(/\/\/.*$/gm, ""),
		/mutate|persist|save|logout|authenticate/,
	);
	assert.match(source, /sessionStore.account\?\.id === owner/);
	assert.match(source, /sessionStore.token === token/);
	assert.match(source, /stageRef.current === stage/);
});
