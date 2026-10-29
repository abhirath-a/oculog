import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("iOS appearance follows the OS without remounting owners or caching a native palette", () => {
	let scheme = "light";
	const Fragment = Symbol("Fragment");
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(source("components/presentation/theme.ts"), {
			compilerOptions: { module: ts.ModuleKind.CommonJS },
		}).outputText,
		{
			exports,
			require(name: string) {
				if (name === "react")
					return {
						Fragment,
						createElement: (
							type: unknown,
							props: unknown,
							children: unknown,
						) => ({ type, props, children }),
					};
				assert.equal(name, "react-native");
				return { useColorScheme: () => scheme };
			},
		},
	);
	const children = { owner: "persistent controller and drafts" };
	assert.equal(
		exports.PresentationThemeProvider({ children }).children,
		children,
	);
	assert.equal(exports.PresentationThemeProvider({ children }).type, Fragment);
	const light = exports.usePresentationTheme();
	assert.equal(light.background, "#F2F2F7");
	assert.equal(light.text, "#000000");
	scheme = "dark";
	const dark = exports.usePresentationTheme();
	assert.equal(dark.background, "#000000");
	assert.equal(dark.text, "#FFFFFF");
	assert.equal(dark.surface, "#1C1C1E");
	assert.notEqual(light.primary, dark.primary);
	assert.equal(exports.usePresentationEpoch(), 0);
	exports.usePresentationPaletteHold(true);
	exports.usePresentationPaletteHold(false);
	assert.equal(exports.usePresentationEpoch(), 0);
	for (const path of [
		"components/home/screen.tsx",
		"components/settings/screen.tsx",
	]) {
		assert.doesNotMatch(source(path), /usePresentationEpoch|paletteEpoch/);
	}
	assert.match(
		source("components/home/screen.tsx"),
		/useRef\(new AddIntent\(\)\)/,
	);
	const root = source("app/_layout.tsx");
	assert.equal((root.match(/<PresentationThemeProvider>/g) ?? []).length, 1);
	assert.doesNotMatch(root, /key=.*(?:epoch|Epoch)/);
	const auth = source("app/auth.tsx");
	assert.match(auth, /const \[password, setPassword\] = useState/);
	assert.match(auth, /const \[repeat, setRepeat\] = useState/);
	assert.doesNotMatch(auth, /<ScreenFrame[^>]*key=/);
});
