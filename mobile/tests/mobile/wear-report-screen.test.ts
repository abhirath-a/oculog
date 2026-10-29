import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("year log route requires the ready signed-in account", () => {
	const route = source("app/(tabs)/logs.tsx");
	assert.match(route, /!store.ready/);
	assert.match(route, /!store.account/);
	assert.match(route, /key=\{store.account.id\}/);
	assert.match(route, /owner=\{store.account.id\}/);
	assert.match(
		source("app/wear-logs.tsx"),
		/<Redirect href=\{"\/logs" as Href\}/,
	);
});

test("native logs use one measured native page with bounded monthly rows and separate statuses", () => {
	const screen = source("components/wear-history/logs-screen.tsx");
	assert.doesNotMatch(
		screen,
		/ToolbarView|<Host\b|<View\b|<ScrollView\b|<Pressable\b/,
	);
	assert.match(screen, /<NativePage/);
	assert.match(
		screen,
		/days\.filter\(\s*\(day\)\s*=>\s*day\.localDate\.startsWith/,
	);
	for (const count of [
		"confirmedWear",
		"confirmedNoWear",
		"assumedWear",
		"unknown",
	])
		assert.match(screen, new RegExp(`report.totals.${count}`));
	assert.match(screen, /reportDayStatus\(day\)/);
	assert.match(screen, /weekdayMonday\(day.localDate\)/);
	assert.match(screen, /Show no-wear and unknown days/);
	assert.match(screen, /usePreventRemove\(state.exporting/);
});

test("native screen keys its state by owner and token, and retained callbacks check the lease", () => {
	const screen = source("components/wear-history/logs-screen.tsx");
	assert.match(screen, /key=\{`\$\{owner\}:\$\{lease\}`\}/);
	assert.match(screen, /sessionLease\(\) === lease/);
	assert.match(screen, /mounted.current = false;\s*controller.dispose\(\)/);
	assert.match(screen, /controller.getState\(\).report !== report/);
	assert.match(screen, /monthRevision.current !== renderedRevision/);
	assert.match(screen, /if \(current\(\)\) void controller.exportPdf\(\)/);
});

test("iOS file sharing has dedicated cache ownership, PDF type, and logout cleanup", () => {
	const runtime = source("lib/wear-history/report-runtime.ts");
	assert.match(runtime, /new Directory\(Paths.cache, "oculog-wear-reports"\)/);
	assert.match(runtime, /await file.write\(bytes\)/);
	assert.match(runtime, /if \(file.exists\) file.delete\(\)/);
	assert.match(runtime, /mimeType: "application\/pdf"/);
	assert.match(runtime, /UTI: "com.adobe.pdf"/);
	assert.match(runtime, /sessionStore.onChange/);
	assert.match(source("lib/files.ts"), /"oculog-wear-reports"/);
});

test("nested stack headers never use the internal tabs group as their back label", () => {
	const stack = source("app/_layout.tsx");
	assert.match(stack, /headerBackTitle: "Back"/);
	assert.match(stack, /headerBackButtonDisplayMode: "minimal"/);
	assert.match(
		stack,
		/name="\(tabs\)"\s+options=\{\{ title: "Oculog", headerShown: false \}\}/,
	);
});

test("calendar exposes the new logs screen without changing day writes", () => {
	const screen = source("components/wear-history/history-screen.tsx");
	assert.match(screen, /router.navigate\("\/logs" as Href\)/);
	assert.match(screen, /if \(currentMonth\(\) && !lock.current\)/);
});
