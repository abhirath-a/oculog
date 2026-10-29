import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { reportActionFailure } from "../../src/lib/action-guard";

type Element = { type: unknown; props: Record<string, unknown> };
export function elements(value: unknown): Element[] {
	if (Array.isArray(value)) return value.flatMap(elements);
	if (!value || typeof value !== "object" || !("props" in value)) return [];
	const node = value as Element;
	return [node, ...elements(node.props.children)];
}
export function authScreen(
	api: typeof import("../../src/lib/api"),
	mode = "register",
	timeZone = "UTC",
) {
	const hooks: unknown[] = [];
	let cursor = 0;
	let pending = Promise.resolve();
	const redirects: string[] = [];
	const focused: string[] = [];
	const store = {
		ready: false,
		account: null,
		error: "",
		syncAuth: () => {},
		connectionFailed: () => {},
		logout: api.logoutSession,
		reload: async () => {},
	};
	const react = {
		useEffect: () => {},
		useRef: (initial: unknown) => {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = { current: initial };
			return hooks[i];
		},
		useState: (initial: unknown) => {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = initial;
			return [
				hooks[i],
				(value: unknown) => {
					hooks[i] = value;
				},
			];
		},
	};
	const actionExports = {} as {
		useAction: () => {
			error: string;
			run: (fn: () => Promise<unknown>, success?: string) => Promise<void>;
		};
	};
	const ui = readFileSync(
		new URL("../../src/components/ui.tsx", import.meta.url),
		"utf8",
	);
	runInNewContext(
		ts.transpileModule(
			ui.slice(
				ui.indexOf("export function useAction()"),
				ui.indexOf("export function Feedback"),
			),
			{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
		).outputText,
		{
			exports: actionExports,
			...react,
			useStore: () => store,
			sessionStore: api.sessionStore,
			errorMessage: api.errorMessage,
			reportActionFailure,
		},
	);
	const jsx = (type: unknown, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react,
		"@expo/ui": {
			Host: "Host",
			Button: "Button",
			RNHostView: "RNHostView",
			FieldGroup: { Section: "Section" },
		},
		"@expo/ui/community/segmented-control": {
			__esModule: true,
			default: "Segments",
		},
		"expo-router": {
			useLocalSearchParams: () => ({ mode }),
			router: { replace: (path: string) => redirects.push(path) },
		},
		"react-native": {
			StyleSheet: { create: (value: unknown) => value },
			PlatformColor: (value: string) => value,
			useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
			Platform: { OS: "ios" },
			View: "View",
			Keyboard: { dismiss: () => {} },
		},
		"../components/auth/auth-surface": {
			AuthCard: "AuthCard",
			AuthModePicker: "Segments",
		},
		"../components/auth/form-field": { FormField: "Field" },
		"../components/auth/intro": { AuthIntro: "Intro" },
		"../components/presentation": {
			ScreenFrame: "Screen",
			SemanticText: "Text",
			PresentationText: "Text",
			usePresentationEpoch: () => 0,
		},
		"../components/presentation/theme": {
			usePresentationPaletteHold: () => {},
			usePresentationTheme: () => ({
				background: "white",
				text: "black",
				secondary: "gray",
			}),
		},
		"../components/ui": {
			Button: "Button",
			Feedback: "Feedback",
			useAction: () => {
				const action = actionExports.useAction();
				return {
					...action,
					run: (fn: () => Promise<unknown>, success: string) => {
						pending = action.run(fn, success);
						return pending;
					},
				};
			},
		},
		"../lib/api": api,
		"../lib/simple-controller": { deviceTimeZone: () => timeZone },
		"../lib/store": { useStore: () => store },
	};
	const exports = {} as { default: () => Element };
	runInNewContext(
		ts.transpileModule(
			readFileSync(new URL("../../src/app/auth.tsx", import.meta.url), "utf8"),
			{
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			},
		).outputText,
		{
			exports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	const render = () => {
		cursor = 0;
		const tree = exports.default();
		for (const node of elements(tree)) {
			if (node.type !== "Field" || !node.props.inputRef) continue;
			(node.props.inputRef as { current: unknown }).current = {
				focus: () => focused.push(node.props.label as string),
			};
		}
		return tree;
	};
	const button = () => {
		const node = elements(render()).find(
			(node) => node.type === "Button" && node.props.variant !== "text",
		);
		assert.ok(node);
		return node;
	};
	return {
		store,
		redirects,
		focused,
		render,
		button,
		flush: () => pending,
		press: () => (button().props.onPress as () => void)(),
		fill: (label: string, value: string) => {
			const node = elements(render()).find(
				(node) => node.type === "Field" && node.props.label === label,
			);
			assert.ok(node, label);
			(node.props.onChange as (value: string) => void)(value);
		},
		feedback: () =>
			elements(render()).find((node) => node.type === "Feedback")?.props
				.action as { error: string; busy: boolean },
	};
}

export async function initializedStore(
	api: typeof import("../../src/lib/api"),
) {
	const { SimpleController } = await import("../../src/lib/simple-controller");
	const { verifySession } = await import("../../src/lib/safety");
	const hooks: unknown[] = [];
	const effects: (() => unknown)[] = [];
	let activate: (state: string) => void = () => {};
	let domainReads = 0;
	let cursor = 0;
	let ready!: () => void;
	const initialized = new Promise<void>((resolve) => {
		ready = resolve;
	});
	const react = {
		createContext: () => ({ Provider: "Context" }),
		useCallback: (fn: unknown) => fn,
		useEffect: (effect: () => unknown) => {
			effects.push(effect);
		},
		useRef: (value: unknown) => {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = { current: value };
			return hooks[i];
		},
		useState: (value: unknown) => {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = value;
			return [
				hooks[i],
				(next: unknown) => {
					hooks[i] = next;
					if (next === true) ready();
				},
			];
		},
	};
	const mocks: Record<string, unknown> = {
		react,
		"react/jsx-runtime": {
			jsx: (type: unknown, props: unknown) => ({ type, props }),
		},
		"react-native": {
			StyleSheet: { create: (value: unknown) => value },
			PlatformColor: (value: string) => value,
			useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
			AppState: {
				currentState: "background",
				addEventListener: (
					_event: string,
					callback: (state: string) => void,
				) => {
					activate = callback;
					return { remove: () => {} };
				},
			},
		},
		"./api": api,
		"./files": { cleanupPrivateFiles: async () => {} },
		"./safety": { verifySession },
		"./simple-controller": { SimpleController },
		"./simple-api": {
			simpleAPI: {
				state: async () => {
					domainReads++;
					throw new Error("Unexpected domain read");
				},
			},
		},
	};
	const exports = {} as {
		Provider: (props: { children: null }) => {
			props: {
				value: {
					ready: boolean;
					error: string;
					account: unknown;
					reload: () => Promise<void>;
				};
			};
		};
	};
	runInNewContext(
		ts.transpileModule(
			readFileSync(new URL("../../src/lib/store.tsx", import.meta.url), "utf8"),
			{
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			},
		).outputText,
		{
			exports,
			setInterval: () => 0,
			clearInterval: () => {},
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	const render = () => {
		cursor = 0;
		return exports.Provider({ children: null }).props.value;
	};
	assert.equal(render().ready, false);
	for (const effect of effects.splice(0)) effect();
	await initialized;
	return {
		...render(),
		render,
		activate: () => activate("active"),
		domainReads: () => domainReads,
	};
}
