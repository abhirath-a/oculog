import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Element = { type: unknown; props: Record<string, unknown>; key?: unknown };
const jsx = (
	type: unknown,
	props: Record<string, unknown>,
	key?: unknown,
): Element => ({
	type,
	props,
	key,
});
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const element = node as Element;
	return [element, ...elements(element.props.children)];
}
function harness(mode = "login", token = "", busy = false) {
	const hooks: unknown[] = [];
	let cursor = 0;
	let paletteEpoch = 0;
	const calls: { name: string; args: unknown[] }[] = [];
	const messages: string[] = [];
	const action = {
		busy,
		error: "",
		clearFeedback: () => {},
		run: (fn: () => Promise<unknown>, success: string) => {
			messages.push(success);
			pending = fn().catch((error) => {
				action.error = String(error);
			});
			return pending;
		},
	};
	const store = {
		ready: true,
		account: null,
		syncAuth: () => {},
		logout: async () => {
			calls.push({ name: "logout", args: [] });
		},
	};
	let pending: Promise<unknown> = Promise.resolve();
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		"@expo/ui": {
			Button: "Button",
			Host: "Host",
			RNHostView: "RNHostView",
			FieldGroup: { Section: "Section" },
		},
		"../components/auth/form-field": { FormField: "Field" },
		"../components/presentation": {
			ScreenFrame: "ScreenFrame",
			SemanticText: "SemanticText",
			PresentationText: "PresentationText",
			usePresentationEpoch: () => paletteEpoch,
		},
		"../components/presentation/theme": {
			usePresentationPaletteHold: () => {},
		},
		"@expo/ui/community/segmented-control": {
			__esModule: true,
			default: "SegmentedControl",
		},
		"expo-router": {
			useLocalSearchParams: () => ({ mode, token }),
			router: {
				replace: (...args: unknown[]) => calls.push({ name: "replace", args }),
			},
		},
		react: {
			useEffect: () => {},
			useRef: (initial: unknown) => ({ current: initial }),
			useState: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = initial;
				return [
					hooks[index],
					(value: unknown) => {
						hooks[index] = value;
					},
				];
			},
		},
		"react-native": {
			View: "View",
			Text: "Text",
			Platform: { OS: "ios" },
			Keyboard: { dismiss: () => {} },
		},
		"../components/auth/intro": { AuthIntro: "AuthIntro" },
		"../components/ui": {
			...Object.fromEntries(
				["Button", "Feedback", "Field", "Page", "Txt"].map((name) => [
					name,
					name,
				]),
			),
			useColors: () => ({ text: "black", accent: "teal" }),
			useAction: () => action,
		},
		"../lib/api": {
			authenticate: async (...args: unknown[]) => {
				calls.push({ name: "authenticate", args });
				return true;
			},
		},
		"../lib/simple-controller": { deviceTimeZone: () => "UTC" },
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
	return {
		calls,
		messages,
		render: () => {
			cursor = 0;
			return exports.default();
		},
		flush: () => pending,
		feedback: () => ({ error: action.error }),
		refreshPalette: () => {
			paletteEpoch++;
		},
	};
}
function field(tree: Element, label: string) {
	const result = elements(tree).find(
		(node) => node.type === "Field" && node.props.label === label,
	);
	assert.ok(result, label);
	return result;
}
function invoke(node: Element, key: string, value?: unknown) {
	return (node.props[key] as (value?: unknown) => unknown)(value);
}
function submit(tree: Element) {
	const result = elements(tree).find(
		(node) => node.type === "Button" && node.props.variant !== "text",
	);
	assert.ok(result);
	invoke(result, "onPress");
}

test("native auth tree keeps semantic field labels and secure autofill metadata", () => {
	const source = readFileSync(
		new URL("../../src/app/auth.tsx", import.meta.url),
		"utf8",
	);
	assert.match(source, /import \{ FormField \} from .*auth\/form-field/);
	assert.doesNotMatch(source, /<AuthField\b/);

	for (const mode of ["login", "register"]) {
		const tree = harness(mode).render();
		assert.equal(tree.type, "ScreenFrame");
		assert.equal(tree.props.scrollOwner, "frame");
		assert.equal(tree.props.title, "");
		const heading = elements(tree).find((node) => node.type === "AuthIntro");
		assert.equal(
			heading?.props.title,
			mode === "login" ? "Sign in" : "Create account",
		);
		assert.ok(elements(tree).some((node) => node.type === "Field"));
		assert.equal(
			elements(tree).some((node) => node.type === "Card"),
			false,
		);
		assert.equal(
			elements(tree).some((node) => node.type === "SegmentedControl"),
			false,
		);
		const primary = elements(tree).filter(
			(node) => node.type === "Button" && node.props.variant !== "text",
		);
		assert.equal(primary.length, 1);
		assert.equal(
			primary[0].props.title,
			mode === "login" ? "Sign in" : "Create account",
		);
		const switchMode = elements(tree).find(
			(node) => node.type === "Button" && node.props.variant === "text",
		);
		assert.equal(
			switchMode?.props.title,
			mode === "login" ? "Create account" : "Sign in",
		);
		assert.equal(field(tree, "Email").props.keyboardType, "email-address");
		assert.equal(field(tree, "Email").props.autoComplete, "email");
		assert.equal(field(tree, "Password").props.secure, true);
		assert.equal(
			field(tree, "Password").props.autoComplete,
			mode === "login" ? "current-password" : "new-password",
		);
		if (mode === "register") {
			assert.equal(field(tree, "Name").props.autoComplete, "name");
			assert.equal(field(tree, "Confirm password").props.secure, true);
		}
	}
});

test("palette refresh preserves controlled auth drafts, mode, and request behavior", async () => {
	const auth = harness("register");
	for (const [label, value] of [
		["Name", "A person"],
		["Email", "person@example.com"],
		["Password", "secret123"],
		["Confirm password", "secret123"],
	])
		invoke(field(auth.render(), label), "onChange", value);
	const before = auth.render();
	auth.refreshPalette();
	const after = auth.render();
	assert.equal(after.key, undefined, "screen owner is never keyed");
	for (const [label, value] of [
		["Name", "A person"],
		["Email", "person@example.com"],
		["Password", "secret123"],
		["Confirm password", "secret123"],
	])
		assert.equal(field(after, label).props.value, value);
	assert.equal(
		elements(after).find((node) => node.type === "AuthIntro")?.props.title,
		"Create account",
	);
	assert.equal(auth.calls.length, 0, "refresh cannot start auth requests");
	submit(after);
	await auth.flush();
	assert.deepEqual(
		auth.calls.map((call) => call.name),
		["authenticate", "replace"],
	);
	assert.equal(
		(auth.calls[0].args[1] as { displayName: string }).displayName,
		"A person",
	);
});

test("busy auth locks fields, submission and mode navigation", () => {
	const tree = harness("register", "", true).render();
	for (const node of elements(tree).filter(
		(node) => node.type === "Field" || node.type === "Button",
	))
		assert.equal(node.props.disabled, true);
	assert.equal(
		elements(tree).find(
			(node) => node.type === "Button" && node.props.variant === "text",
		)?.props.disabled,
		true,
	);
});

test("login and signup authenticate immediately without verification fields", async () => {
	for (const mode of ["login", "register"]) {
		const auth = harness(mode);
		invoke(field(auth.render(), "Email"), "onChange", " person@example.com ");
		invoke(field(auth.render(), "Password"), "onChange", "secret123");
		if (mode === "register")
			invoke(field(auth.render(), "Confirm password"), "onChange", "secret123");
		submit(auth.render());
		await auth.flush();
		assert.deepEqual(
			auth.calls.map((call) => call.name),
			["authenticate", "replace"],
		);
		assert.equal(auth.calls[0].args[0], mode);
		const body = auth.calls[0].args[1] as Record<string, unknown>;
		assert.equal(body.email, "person@example.com");
		assert.equal(body.password, "secret123");
		assert.equal(body.timeZone, mode === "register" ? "UTC" : undefined);
		assert.equal(body.passwordConfirm, undefined);
		assert.equal(body.verified, undefined);
		assert.equal(
			auth.calls[1].args[0],
			mode === "register" ? "/onboarding" : "/",
		);
	}
});
test("short passwords and mismatched registration confirmation cannot submit", async () => {
	for (const [password, repeat] of [
		["short", "short"],
		["secret123", "different"],
	]) {
		const auth = harness("register");
		invoke(field(auth.render(), "Email"), "onChange", "person@example.com");
		invoke(field(auth.render(), "Password"), "onChange", password);
		invoke(field(auth.render(), "Confirm password"), "onChange", repeat);
		submit(auth.render());
		await auth.flush();
		assert.equal(auth.calls.length, 0);
		assert.equal(auth.feedback().error, "");
		const invalid = password.length < 8 ? "Password" : "Confirm password";
		assert.match(
			String(field(auth.render(), invalid).props.error),
			/Password|Passwords/,
		);
	}
});

test("footer changes task, preserves name and email, and clears both passwords", () => {
	const auth = harness("register");
	for (const [label, value] of [
		["Name", "A person"],
		["Email", "person@example.com"],
		["Password", "secret123"],
		["Confirm password", "secret123"],
	]) {
		invoke(field(auth.render(), label), "onChange", value);
	}
	const switchMode = () =>
		elements(auth.render()).find(
			(node) => node.type === "Button" && node.props.variant === "text",
		);
	invoke(switchMode()!, "onPress");
	assert.equal(
		elements(auth.render()).find((node) => node.type === "AuthIntro")?.props
			.title,
		"Sign in",
	);
	assert.equal(field(auth.render(), "Email").props.value, "person@example.com");
	assert.equal(field(auth.render(), "Password").props.value, "");
	invoke(switchMode()!, "onPress");
	assert.equal(field(auth.render(), "Name").props.value, "A person");
	assert.equal(field(auth.render(), "Confirm password").props.value, "");
	assert.equal(auth.calls.length, 0);
});
test("obsolete auth modes fall back to login without token fields", () => {
	for (const mode of ["reset", "verify", "email"]) {
		const tree = harness(mode).render();
		assert.ok(field(tree, "Password"));
		assert.equal(
			elements(tree).filter((node) => node.type === "Field").length,
			2,
		);
	}
});
