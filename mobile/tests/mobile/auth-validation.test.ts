import assert from "node:assert/strict";
import { test } from "node:test";
import { authScreen, elements } from "./auth-session-harness";

function harness(mode = "login", failure?: Error) {
	const requests: unknown[] = [];
	const api = {
		sessionStore: {},
		errorMessage: (error: Error) => error.message,
		authenticate: async (...args: unknown[]) => {
			requests.push(args);
			if (failure) throw failure;
			return false;
		},
	} as unknown as typeof import("../../src/lib/api");
	const screen = authScreen(api, mode);
	screen.store.ready = true;
	const error = (label: string) =>
		elements(screen.render()).find(
			(node) => node.type === "Field" && node.props.label === label,
		)?.props.error;
	return { ...screen, requests, error };
}

test("blank sign in validates synchronously, focuses Email and shows only one inline error", () => {
	const h = harness();
	h.press();
	assert.deepEqual(h.requests, []);
	assert.deepEqual(h.focused, ["Email address"]);
	assert.equal(h.error("Email address"), "Enter a valid email address.");
	assert.equal(h.error("Password"), "");
	assert.equal(h.feedback().error, "");
	assert.equal(h.feedback().busy, false);
});

test("invalid addresses never request authentication and always focus Email", () => {
	for (const address of [
		"invalid",
		"a@b",
		"a@@b.com",
		"a b@c.com",
		"a@b.\u0085com",
		`${"a".repeat(249)}@b.com`,
	]) {
		const h = harness();
		h.fill("Email address", address);
		h.fill("Password", "password123");
		h.press();
		assert.deepEqual(h.requests, [], address);
		assert.deepEqual(h.focused, ["Email address"]);
		assert.equal(h.feedback().error, "");
	}
});

test("backend-accepted email forms are not restricted by browser email rules", async () => {
	for (const address of [
		" a@example.com ",
		"\u001ca@example.com\u0085",
		"ü@例え.テスト",
		"a+b@localhost.c",
		"a..b@c..d",
		"a\ufeffb@c.com",
		`${"😀".repeat(248)}@b.com`,
	]) {
		const h = harness();
		h.fill("Email address", address);
		h.fill("Password", "password123");
		h.press();
		await h.flush();
		assert.equal(h.requests.length, 1, address);
		assert.equal(h.error("Email address"), "");
	}
});

test("password and confirmation validation stay inline and only the edited field clears", () => {
	const h = harness("register");
	h.fill("Email address", "a@example.com");
	h.press();
	assert.deepEqual(h.focused, ["Password"]);
	assert.equal(h.error("Password"), "Password must be at least 8 characters.");
	assert.equal(h.feedback().error, "");
	h.fill("Email address", "bad");
	assert.ok(h.error("Password"));
	h.press();
	h.fill("Password", "password123");
	assert.equal(h.error("Password"), "");
	assert.ok(h.error("Email address"));
	h.fill("Email address", "a@example.com");
	h.press();
	assert.equal(h.focused.at(-1), "Confirm password");
	assert.equal(h.error("Confirm password"), "Passwords do not match.");
	h.fill("Password", "password456");
	assert.ok(h.error("Confirm password"));
	h.fill("Confirm password", "password456");
	assert.equal(h.error("Confirm password"), "");
	assert.deepEqual(h.requests, []);
	assert.equal(h.feedback().error, "");
});

test("uncertain network errors remain general feedback after field edits", async () => {
	const h = harness("login", new Error("Connection lost; outcome unknown"));
	h.fill("Email address", "a@example.com");
	h.fill("Password", "password123");
	h.press();
	h.press();
	await h.flush();
	assert.equal(h.requests.length, 1);
	assert.equal(h.feedback().error, "Connection lost; outcome unknown");
	h.fill("Email address", "bad");
	h.press();
	assert.equal(h.requests.length, 1);
	assert.equal(h.feedback().error, "Connection lost; outcome unknown");
	assert.ok(h.error("Email address"));
	h.fill("Email address", "a@example.com");
	assert.equal(h.error("Email address"), "");
	assert.equal(h.feedback().error, "Connection lost; outcome unknown");
});
