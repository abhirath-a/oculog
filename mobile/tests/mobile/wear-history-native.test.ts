import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name: string) =>
	readFileSync(
		new URL(`../../src/components/wear-history/${name}`, import.meta.url),
		"utf8",
	);

test("iOS trees use the one measured NativePage surface without embedded RN children", () => {
	for (const name of ["history-screen.tsx", "automation-screen.tsx"]) {
		const text = source(name);
		assert.match(text, /<NativePage/);
		assert.doesNotMatch(
			text,
			/ToolbarView|<(?:Host|RNView)\b|<ScrollView|<View\b|<Pressable\b/,
		);
		assert.match(text, /key=\{`\$\{owner\}:\$\{lease\}`\}/);
	}
});

test("selection is read-only and the three day mutations are explicit", () => {
	const text = source("history-screen.tsx");
	const select = text.slice(
		text.indexOf("const selectISO ="),
		text.indexOf("const save ="),
	);
	assert.match(select, /setSelection\(/);
	assert.match(select, /selectionRevision\.current\+\+/);
	assert.doesNotMatch(select, /saveDay|saveAutomation|reload\(/);
	assert.match(text, /selectionRevision\.current !== renderedSelection/);
	assert.match(text, /<DatePicker\b/);
	assert.match(
		text,
		/onDateChange=\{\(date\) => selectISO\(calendarISO\(date\)\)\}/,
	);
	assert.match(text, /date\.toISOString\(\)\.slice\(0, 10\)/);
	assert.match(text, /datePickerStyle\("(?:compact|graphical)"\)/);
	assert.match(text, /environment\("timeZone", "UTC"\)/);
	assert.match(text, /start: calendarDate\("0001-01-01"\)/);
	assert.match(text, /end: calendarDate\(accountToday\)/);
	assert.match(select, /iso > history\.today/);
	assert.match(text, /onPress=\{\(\) => save\(true\)\}/);
	assert.match(text, /onPress=\{\(\) => save\(false\)\}/);
	assert.match(text, /onPress=\{\(\) => save\(null\)\}/);
	assert.match(text, /selected\.localDate > history\.today/);
	assert.match(text, /manualWear/);
	assert.match(text, /manualNoWear/);
	assert.match(text, /assumed/);
});

test("automation edits a local off/empty draft with one explicit save", () => {
	const text = source("automation-screen.tsx");
	assert.match(text, /useState\(false\)/);
	assert.match(text, /useState<number\[\]>\(\[\]\)/);
	assert.equal(
		(text.match(/controller\s*\.saveAutomation\(/g) ?? []).length,
		1,
	);
	assert.match(text, /onPress=\{save\}/);
	assert.match(text, /Only completed days count/);
	assert.match(text, /does not erase past assumptions/);
	assert.match(text, /does not fill the disabled gap/);
});

test("writes have a synchronous UI lock, scope checks and navigation protection", () => {
	const support = source("native-support.tsx");
	assert.match(support, /usePreventRemove\(state\.busy/);
	assert.match(support, /sessionLease\(\) === lease/);
	assert.match(support, /controller\.dispose\(\)/);
	assert.match(support, /controller\.mount\(\)/);
	for (const name of ["history-screen.tsx", "automation-screen.tsx"]) {
		const text = source(name);
		assert.match(text, /lock\.current = true/);
		assert.match(text, /ticket === generation\.current/);
		assert.match(text, /currentMonth\(\)/);
	}
});
