import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { paletteRefreshGate } from "../../src/components/presentation/palette-refresh";

const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("foreground gate coalesces busy refreshes, ignores duplicate active, and disposes safely", () => {
	let updates = 0;
	const gate = paletteRefreshGate("active", () => updates++);
	const first = Symbol();
	const second = Symbol();
	gate.transition("active");
	assert.equal(updates, 0);
	gate.hold(first);
	gate.hold(second);
	gate.transition("background");
	gate.transition("active");
	gate.transition("inactive");
	gate.transition("active");
	gate.release(first);
	assert.equal(updates, 0);
	gate.release(second);
	assert.equal(updates, 1);
	gate.release(second);
	gate.transition("active");
	assert.equal(updates, 1);
	gate.dispose();
	gate.transition("background");
	gate.transition("active");
	assert.equal(updates, 1);
});

function providerHarness() {
	type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
	const frames = new Map<string, Slot[]>();
	let slots: Slot[] = [];
	let cursor = 0;
	let effects: (() => void)[] = [];
	let scheme = "light";
	let wallpaper = 0;
	let reads = 0;
	const listeners = new Set<(state: string) => void>();
	const appState = {
		currentState: "active",
		addEventListener: (_event: string, listener: (state: string) => void) => {
			listeners.add(listener);
			return { remove: () => listeners.delete(listener) };
		},
	};
	const slot = () => {
		const index = cursor++;
		if (!slots[index]) slots[index] = {};
		return slots[index];
	};
	const same = (a?: unknown[], b?: unknown[]) =>
		!!a &&
		!!b &&
		a.length === b.length &&
		a.every((value, index) => value === b[index]);
	const hooks = {
		createContext: (value: unknown) => {
			const context = { value, Provider: {} };
			context.Provider = { context };
			return context;
		},
		createElement: (
			type: { context: { value: unknown } },
			props: { value: unknown },
		) => {
			type.context.value = props.value;
			return { type, props };
		},
		useContext: (context: { value: unknown }) => context.value,
		useRef: (initial: unknown) => {
			const current = slot();
			if (!("value" in current)) current.value = { current: initial };
			return current.value;
		},
		useState: (initial: unknown) => {
			const current = slot();
			if (!("value" in current)) current.value = initial;
			return [
				current.value,
				(value: unknown) => {
					current.value =
						typeof value === "function" ? value(current.value) : value;
				},
			];
		},
		useMemo: (factory: () => unknown, deps: unknown[]) => {
			const current = slot();
			if (!same(current.deps, deps)) {
				current.value = factory();
				current.deps = deps;
			}
			return current.value;
		},
		useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
			const current = slot();
			if (!same(current.deps, deps)) {
				effects.push(() => {
					current.cleanup?.();
					current.cleanup = effect();
					current.deps = deps;
				});
			}
		},
	};
	const mocks: Record<string, unknown> = {
		react: hooks,
		"react-native": { AppState: appState, useColorScheme: () => scheme },
		"./palette-refresh": { paletteRefreshGate },
		"@expo/ui/jetpack-compose": {
			getMaterialColors: (options: { scheme: string; seedColor?: string }) => {
				reads++;
				assert.equal(options.seedColor, undefined);
				assert.equal(options.scheme, scheme);
				const color = `${scheme}-wallpaper-${wallpaper}`;
				return {
					background: color,
					surfaceContainerLow: color,
					onSurface: color,
					onSurfaceVariant: color,
					outline: color,
					primary: color,
					onPrimary: color,
					error: color,
				};
			},
			useMaterialColors: () =>
				assert.fail("must not consume an existing Host's stale cached context"),
		},
	};
	const exports: Record<string, (...args: unknown[]) => unknown> = {};
	runInNewContext(
		ts.transpileModule(source("components/presentation/theme.android.ts"), {
			compilerOptions: { module: ts.ModuleKind.CommonJS },
		}).outputText,
		{
			exports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	const call = (frame: string, method: string, ...args: unknown[]) => {
		slots = frames.get(frame) ?? [];
		frames.set(frame, slots);
		cursor = 0;
		const value = exports[method](...args);
		const pending = effects;
		effects = [];
		for (const effect of pending) effect();
		return value;
	};
	return {
		provider: () =>
			call("provider", "PresentationThemeProvider", {
				children: "Unkeyed router and models",
			}),
		theme: (frame: string) =>
			call(frame, "usePresentationTheme") as { background: string },
		epoch: () => call("epoch", "usePresentationEpoch"),
		hold: (busy: boolean) => call("sheet", "usePresentationPaletteHold", busy),
		emit: (state: string) => {
			appState.currentState = state;
			for (const listener of listeners) listener(state);
		},
		cleanup: () => {
			for (const current of frames.get("provider") ?? []) {
				current.cleanup?.();
				current.cleanup = undefined;
				if (current.deps && !current.value) current.deps = undefined;
			}
		},
		wallpaper: (value: number) => {
			wallpaper = value;
		},
		scheme: (value: string) => {
			scheme = value;
		},
		reads: () => reads,
		listeners: () => listeners.size,
	};
}

test("actual Android provider has one AppState listener and one RN/native snapshot; busy return refresh waits until completion", () => {
	const h = providerHarness();
	h.provider();
	assert.equal(h.listeners(), 1);
	assert.equal(h.reads(), 1);
	assert.equal(
		h.theme("rn"),
		h.theme("inside-native-host"),
		"both use the same provider object, not Host cache",
	);
	assert.equal(h.reads(), 1);
	h.emit("active");
	h.provider();
	assert.equal(h.epoch(), "light:0");
	h.emit("background");
	h.wallpaper(1);
	h.emit("active");
	h.provider();
	assert.equal(h.epoch(), "light:1");
	assert.equal(h.theme("rn").background, "light-wallpaper-1");
	assert.equal(h.theme("rn"), h.theme("inside-native-host"));
	h.hold(true);
	h.emit("background");
	h.wallpaper(2);
	h.emit("active");
	h.provider();
	assert.equal(h.epoch(), "light:1");
	assert.equal(
		h.theme("rn").background,
		"light-wallpaper-1",
		"defer RN colors too, preserving one synchronized snapshot",
	);
	h.emit("inactive");
	h.emit("active");
	h.hold(false);
	h.provider();
	assert.equal(h.epoch(), "light:2", "multiple busy returns coalesce");
	assert.equal(h.theme("rn").background, "light-wallpaper-2");
	h.scheme("dark");
	h.provider();
	assert.equal(h.theme("rn").background, "dark-wallpaper-2");
	assert.equal(
		h.epoch(),
		"dark:2",
		"scheme changes invalidate native boundaries as well as the RN palette",
	);
	h.hold(true);
	h.scheme("light");
	h.provider();
	assert.equal(h.epoch(), "light:2");
	assert.equal(h.theme("rn").background, "light-wallpaper-2");
	h.scheme("dark");
	h.provider();
	assert.equal(h.epoch(), "dark:2");
	assert.equal(h.theme("rn"), h.theme("inside-native-host"));
	h.hold(false);
	h.cleanup();
	assert.equal(h.listeners(), 0);
	h.emit("background");
	h.emit("active");
	assert.equal(h.epoch(), "dark:2");
	h.provider(); // StrictMode effect setup after cleanup reuses state, but must not duplicate listeners.
	assert.equal(h.listeners(), 1);
	h.emit("background");
	h.emit("active");
	h.provider();
	assert.equal(h.epoch(), "dark:3");
	h.cleanup();
	assert.equal(h.listeners(), 0);
});

test("installed SDK Host memo requires foreground remount; epoch keys stay on native boundaries, never owner screens/controllers", () => {
	const host = readFileSync(
		new URL(
			"../../node_modules/@expo/ui/src/jetpack-compose/Host/index.tsx",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(host, /\[resolvedScheme, seedColor\]/);
	assert.match(host, /HostPaletteContext.Provider value=\{palette\}/);
	for (const path of [
		"components/ui.tsx",
		"components/presentation/choice-control.tsx",
		"components/presentation/native-sheet.tsx",
		"components/home/HomeContent.tsx",
		"components/settings/form.tsx",
		"app/auth.tsx",
	]) {
		const code = source(path);
		for (const opener of code.matchAll(/<Host\b[^>]*>/g))
			assert.match(opener[0], /key=\{paletteEpoch\}/, path);
		assert.doesNotMatch(
			code,
			/<(?:ScreenFrame|HomeContent|AddContactsForm|Provider|Stack|NativeTabs)\b[^>]*key=\{paletteEpoch\}/,
		);
	}
	assert.match(
		source("components/presentation/native-sheet.tsx"),
		/<BottomSheet\s+key=\{paletteEpoch\}/,
	);
	assert.match(
		source("components/presentation/native-sheet.tsx"),
		/usePresentationPaletteHold\(busy\)/,
	);
	assert.match(
		source("components/presentation/date-field-picker.ios.tsx"),
		/<BottomSheet\s+key=\{paletteEpoch\}/,
	);
	const root = source("app/_layout.tsx");
	assert.equal((root.match(/<PresentationThemeProvider>/g) ?? []).length, 1);
	assert.doesNotMatch(root, /key=.*(?:epoch|Epoch)/);
	assert.doesNotMatch(
		source("components/simple-home.tsx"),
		/usePresentationEpoch|paletteEpoch/,
	);
	assert.doesNotMatch(
		source("components/settings.tsx"),
		/usePresentationEpoch|paletteEpoch/,
	);
	assert.match(
		source("components/simple-home.tsx"),
		/useRef\(new AddIntent\(\)\)/,
	);
});

test("palette-cache Hosts are epoch-keyed except the persistent non-sizing inventory modal Host", () => {
	function files(directory: URL): URL[] {
		return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
			const path = new URL(
				`${entry.name}${entry.isDirectory() ? "/" : ""}`,
				directory,
			);
			return entry.isDirectory()
				? files(path)
				: entry.name.endsWith(".tsx")
					? [path]
					: [];
		});
	}
	const owners = new Set<string>();
	for (const path of files(new URL("../../src/", import.meta.url))) {
		const code = readFileSync(path, "utf8");
		for (const opener of code.matchAll(/<(?:Host|BottomSheet)\b[^>]*>/g)) {
			owners.add(path.pathname);
			if (path.pathname.endsWith("/home/AddContactsSheet.android.tsx")) {
				// The modal has only native Compose descendants; never remount its
				// owner during hide. Unlike sizing bridges it queues no Yoga style size.
				assert.doesNotMatch(
					opener[0],
					/key=|matchContents|useViewportSizeMeasurement/,
				);
				assert.doesNotMatch(code, /<RNHostView/);
				assert.match(
					code,
					/usePresentationPaletteHold\(props.presented \|\| mounted \|\| props.busy\)/,
				);
				continue;
			}
			assert.match(opener[0], /key=\{(?:paletteEpoch|epoch)\}/, path.pathname);
			assert.match(code, /usePresentationEpoch\(\)/, path.pathname);
		}
	}
	for (const owner of [
		"components/auth/form-field.tsx",
		"components/home/HomeContent.tsx",
		"components/settings/form.tsx",
		"components/settings/overview.tsx",
		"components/presentation/native-sheet.tsx",
		"components/presentation/date-field-picker.ios.tsx",
	]) {
		assert.ok(
			[...owners].some((path) => path.endsWith(`/src/${owner}`)),
			owner,
		);
	}
	const auth = source("app/auth.tsx");
	assert.match(auth, /usePresentationPaletteHold\(action\.busy\)/);
	assert.doesNotMatch(auth, /<ScreenFrame[^>]*key=/);
	assert.match(auth, /const \[password, setPassword\] = useState/);
	assert.match(auth, /const \[repeat, setRepeat\] = useState/);
});
