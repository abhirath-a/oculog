import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");
function files(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? files(path) : [path];
	});
}

test("client declares iOS as its sole build target", () => {
	const config = JSON.parse(read("app.json"));
	assert.deepEqual(config.expo.platforms, ["ios"]);
	assert.equal(config.expo.android, undefined);
	assert.equal(config.expo.web, undefined);
	const manifest = JSON.parse(read("package.json"));
	assert.equal(manifest.scripts["export:ios"], "expo export --platform ios");
	for (const [name, command] of Object.entries(manifest.scripts)) {
		assert.doesNotMatch(
			`${name} ${command}`,
			/(?:android|web|--platform all)/i,
		);
	}
	const dependencies = manifest.dependencies;
	for (const name of Object.keys(dependencies)) {
		assert.doesNotMatch(
			name,
			/react-native-web|react-dom|@expo\/metro-runtime|material|jetpack/i,
		);
	}
});

test("canonical client source has no platform variants or removed runtime imports", () => {
	for (const path of [
		...files(join(root, "src")),
		...files(join(root, "shared")),
	]) {
		const name = relative(root, path);
		assert.doesNotMatch(name, /\.(?:web|android|ios|native)\.[^.]+$/, name);
		if (!/\.[jt]sx?$/.test(path)) continue;
		assert.doesNotMatch(
			readFileSync(path, "utf8"),
			/(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*(?:jetpack-compose|material|react-native-web|web-typography|\.(?:web|android|ios|native)(?:["'/]))/i,
			name,
		);
	}
});

test("iOS runtime services and feature screens use canonical native implementations", () => {
	for (const path of [
		"components/home/screen.tsx",
		"components/settings/screen.tsx",
		"lib/prescriptions/ocr.ts",
		"lib/local-reminders/runtime.ts",
		"lib/files.ts",
		"lib/wear-history/report-runtime.ts",
	]) {
		assert.ok(existsSync(join(root, "src", path)), path);
	}
	assert.match(
		read("src/lib/prescriptions/ocr.ts"),
		/requireOptionalNativeModule/,
	);
	assert.match(read("src/lib/files.ts"), /expo-file-system/);
	assert.match(read("src/lib/api.ts"), /expo-secure-store/);
	assert.match(read("src/lib/api.ts"), /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
	assert.doesNotMatch(
		read("src/lib/api.ts"),
		/Platform\.OS|localStorage|sessionStorage/,
	);
});
