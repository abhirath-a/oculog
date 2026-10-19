import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { elements } from "./auth-session-harness";

function harness(loading: boolean) {
	const hooks: unknown[] = [];
	let cursor = 0;
	let confirmations = 0,
		logouts = 0,
		reloads = 0;
	let confirm: () => Promise<boolean> = async () => true;
	const pending: Promise<unknown>[] = [];
	const session = { account: { id: "a" }, token: "token-a" };
	const store = {
		state: null,
		account: { id: "a", email: "a@example.com" },
		loading,
		pending: false,
		error: loading ? "" : "Cannot load schedule",
		logout: async () => {
			logouts++;
		},
		reload: async () => {
			reloads++;
		},
	};
	const jsx = (type: unknown, props: Record<string, unknown>) => ({
		type,
		props,
	});
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react: {
			useEffect: (effect: () => void) => effect(),
			useRef: (value: unknown) => {
				const i = cursor++;
				if (!(i in hooks)) hooks[i] = { current: value };
				return hooks[i];
			},
		},
		"react-native": { View: "View", ActivityIndicator: "Spinner" },
		"expo-router": {},
		"../lib/api": { sessionStore: session },
		"../lib/simple-controller": {},
		"../lib/store": { useStore: () => store },
		"./presentation": { ScreenFrame: "Screen", PresentationText: "Text" },
		"./settings/overview": {},
		"./settings/summary": {},
		"./settings/schedule": {},
		"../../lib/api": { sessionStore: session },
		"../../lib/simple-controller": {},
		"../../lib/store": { useStore: () => store },
		"../ui": undefined,
		"./schedule": {},
		"./ui": {
			Button: "Button",
			confirm: async () => {
				confirmations++;
				return confirm();
			},
			useAction: () => ({
				error: "",
				busy: false,
				run: (fn: () => Promise<unknown>) => {
					const p = fn();
					pending.push(p);
					return p;
				},
			}),
		},
	};
	mocks["../ui"] = mocks["./ui"];
	const controller = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/settings/use-schedule-settings.ts",
					import.meta.url,
				),
				"utf8",
			),
			{
				compilerOptions: { module: ts.ModuleKind.CommonJS },
			},
		).outputText,
		{
			exports: controller,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./settings/use-schedule-settings"] = controller;
	const exports = {} as { default: () => unknown };
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL("../../src/components/settings.tsx", import.meta.url),
				"utf8",
			),
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
	function expand(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(expand);
		if (!value || typeof value !== "object" || !("props" in value))
			return value;
		const node = value as { type: unknown; props: Record<string, unknown> };
		if (typeof node.type === "function") return expand(node.type(node.props));
		return {
			...node,
			props: { ...node.props, children: expand(node.props.children) },
		};
	}
	const render = () => {
		cursor = 0;
		return expand(exports.default());
	};
	const button = (title: string) => {
		const node = elements(render()).find(
			(node) => node.type === "Button" && node.props.title === title,
		);
		assert.ok(node, title);
		return node;
	};
	return {
		store,
		session,
		render,
		button,
		press: (title: string) => (button(title).props.onPress as () => void)(),
		flush: () => Promise.all(pending.splice(0)),
		confirm: (fn: typeof confirm) => {
			confirm = fn;
		},
		counts: () => ({ confirmations, logouts, reloads }),
	};
}

test("authenticated null-state Settings keeps account/sign-out during loading and errors, with retry retained", async () => {
	for (const loading of [true, false]) {
		const h = harness(loading);
		assert.ok(
			elements(h.render()).some(
				(node) =>
					node.type === "Text" && node.props.children === "a@example.com",
			),
		);
		assert.equal(h.button("Sign out").props.disabled, false);
		if (!loading) {
			h.press("Retry connection");
			assert.equal(h.counts().reloads, 1);
		}
		h.press("Sign out");
		h.press("Sign out");
		await h.flush();
		assert.deepEqual(h.counts(), {
			confirmations: 1,
			logouts: 1,
			reloads: loading ? 0 : 1,
		});
	}
});
test("unavailable Settings sign-out respects cancellation, pending writes, and account changes during confirmation", async () => {
	const h = harness(false);
	h.confirm(async () => false);
	h.press("Sign out");
	await h.flush();
	assert.equal(h.counts().logouts, 0);
	h.store.pending = true;
	assert.equal(h.button("Sign out").props.disabled, true);
	h.press("Sign out");
	assert.equal(h.counts().confirmations, 1);
	h.store.pending = false;
	let resolve!: (answer: boolean) => void;
	h.confirm(
		() =>
			new Promise<boolean>((r) => {
				resolve = r;
			}),
	);
	h.press("Sign out");
	h.session.token = "new-account-session";
	resolve(true);
	await h.flush();
	assert.equal(
		h.counts().logouts,
		0,
		"old confirmation cannot sign out the new session",
	);
});
