import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { verifySession } from "../../src/lib/safety";
import { authScreen, initializedStore } from "./auth-session-harness";

type Session = {
	token: string;
	expiresAt: string;
	account: { id: string; email: string; displayName: string; timeZone: string };
};
const session = (id = "a"): Session => ({
	token: `opaque-${id}`,
	expiresAt: "2099-01-01T00:00:00Z",
	account: { id, email: `${id}@example.com`, displayName: id, timeZone: "UTC" },
});
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { resolve, promise };
}
function harness(
	os = "ios",
	initial: string | null = null,
	origin = "https://example.test/",
) {
	let saved = initial;
	let now = Date.now();
	const writes: (string | null)[] = [];
	const calls: { url: string; init: RequestInit }[] = [];
	let fetcher: (url: string, init: RequestInit) => Promise<Response> =
		async () => Response.json(session());
	let writer: () => Promise<void> = async () => {};
	let reader: () => Promise<string | null> = async () => saved;
	const exports = {} as typeof import("../../src/lib/api");
	runInNewContext(
		ts.transpileModule(
			readFileSync(new URL("../../src/lib/api.ts", import.meta.url), "utf8"),
			{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
		).outputText,
		{
			exports,
			process: { env: { EXPO_PUBLIC_API_URL: origin } },
			Headers,
			AbortController,
			Date: { now: () => now, parse: Date.parse },
			setTimeout,
			clearTimeout,
			fetch: async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return fetcher(url, init);
			},
			require: (name: string) => {
				if (name === "react-native") return { Platform: { OS: os } };
				assert.equal(name, "expo-secure-store");
				return {
					WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
					getItemAsync: () => reader(),
					setItemAsync: async (
						_key: string,
						value: string,
						options: unknown,
					) => {
						assert.ok(options);
						await writer();
						saved = value;
						writes.push(value);
					},
					deleteItemAsync: async () => {
						await writer();
						saved = null;
						writes.push(null);
					},
				};
			},
		},
	);
	return {
		api: exports,
		clock: (time: number) => {
			now = time;
		},
		calls,
		writes,
		saved: () => saved,
		fetch: (fn: typeof fetcher) => {
			fetcher = fn;
		},
		reader: (fn: typeof reader) => {
			reader = fn;
		},
		writer: (fn: typeof writer) => {
			writer = fn;
		},
	};
}

test("opaque sessions persist the complete minimal account and UTC expiry, web stays memory-only", async () => {
	for (const os of ["ios", "web"]) {
		const h = harness(os);
		await h.api.authenticate("register", {
			email: "a@example.com",
			password: "password",
			displayName: "A",
			timeZone: "UTC",
		});
		assert.equal(h.api.sessionStore.account.id, "a");
		assert.equal(h.api.sessionStore.isValid, true);
		assert.equal(h.calls[0].url, "https://example.test/api/auth/register");
		assert.equal(new Headers(h.calls[0].init.headers).get("Authorization"), "");
		assert.deepEqual(
			h.saved() && JSON.parse(h.saved() || "null"),
			os === "web" ? null : session(),
		);
	}
});
test("restore validates via GET session and keeps the same opaque bearer token", async () => {
	const h = harness("ios", JSON.stringify(session()));
	await h.api.hydrate();
	assert.equal(
		h.api.user(),
		null,
		"restored credentials do not publish an account before server validation",
	);
	assert.equal(await h.api.refreshAuth(), true);
	assert.equal(h.api.user()?.id, "a");
	assert.equal(h.calls[0].url, "https://example.test/api/auth/session");
	assert.equal(h.calls[0].init.method, "GET");
	assert.equal(
		new Headers(h.calls[0].init.headers).get("Authorization"),
		"Bearer opaque-a",
	);
	assert.equal(h.api.sessionStore.token, "opaque-a");
});
test("expired, malformed and old record-format saves are cleared without JWT decoding", async () => {
	for (const initial of [
		"{",
		JSON.stringify({ token: "old", record: { id: "a" } }),
		JSON.stringify({ ...session(), expiresAt: "2000-01-01T00:00:00Z" }),
	]) {
		const h = harness("ios", initial);
		await h.api.hydrate();
		assert.equal(h.api.sessionStore.account, null);
		assert.equal(h.saved(), null);
	}
});
test("a stale rejected request cannot clear a new account; current 401 clears, 403 does not", async () => {
	const h = harness();
	await h.api.authenticate("login", {
		email: "a@example.com",
		password: "password123",
	});
	const old = deferred<Response>();
	h.fetch(async () => old.promise);
	const stale = h.api.request("/api/oculog/v1/simple/state");
	h.fetch(async () => Response.json(session("b")));
	await h.api.authenticate("login", {
		email: "a@example.com",
		password: "password123",
	});
	old.resolve(
		Response.json(
			{ error: { code: "unauthorized", message: "Expired" } },
			{ status: 401 },
		),
	);
	await assert.rejects(stale);
	assert.equal(h.api.sessionStore.account.id, "b");
	h.fetch(async () =>
		Response.json({ error: { message: "Forbidden" } }, { status: 403 }),
	);
	await assert.rejects(h.api.request("/forbidden"));
	assert.equal(h.api.sessionStore.account.id, "b");
	h.fetch(async () =>
		Response.json({ error: { message: "Expired" } }, { status: 401 }),
	);
	await assert.rejects(h.api.request("/state"));
	assert.equal(h.api.sessionStore.account, null);
	assert.equal(h.saved(), null);
});
test("offline revocation guarantees local clear and reports the unconfirmed server sign-out", async () => {
	const h = harness();
	await h.api.authenticate("login", {
		email: "a@example.com",
		password: "password123",
	});
	h.fetch(async () => {
		throw new TypeError("offline");
	});
	await assert.rejects(h.api.logoutSession(), /Signed out on this device/);
	assert.equal(h.api.sessionStore.account, null);
	assert.equal(h.saved(), null);
});
test("late logout and refresh responses cannot overwrite the next account", async () => {
	for (const operation of ["logoutSession", "refreshAuth"]) {
		const h = harness();
		await h.api.authenticate("login", {
			email: "a@example.com",
			password: "password123",
		});
		const pending = deferred<Response>();
		h.fetch(async () => pending.promise);
		const result = h.api[operation]();
		h.fetch(async () => Response.json(session("b")));
		await h.api.authenticate("login", {
			email: "a@example.com",
			password: "password123",
		});
		pending.resolve(
			operation === "logoutSession"
				? new Response(null, { status: 204 })
				: Response.json(session()),
		);
		await result;
		assert.equal(h.api.sessionStore.account.id, "b");
		assert.equal(JSON.parse(h.saved() || "null").account.id, "b");
	}
});
test("secure persistence serializes delayed writes so logout cannot resurrect a token", async () => {
	const h = harness();
	const gate = deferred<void>();
	h.writer(async () => gate.promise);
	const login = h.api.authenticate("login", {
		email: "a@example.com",
		password: "password123",
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	const cleared = h.api.clearSession();
	assert.equal(h.api.sessionStore.account, null);
	gate.resolve();
	await Promise.all([login, cleared]);
	assert.equal(h.saved(), null);
});
test("network and structured validation failures are readable", async () => {
	const h = harness();
	h.fetch(async () =>
		Response.json(
			{
				error: {
					code: "validation",
					message: "Check your fields.",
					fields: { password: "At least 8 characters." },
				},
			},
			{ status: 422 },
		),
	);
	await assert.rejects(
		h.api.authenticate("register", {
			email: "a@example.com",
			password: "password123",
			displayName: "A",
			timeZone: "UTC",
		}),
		(error: unknown) => {
			assert.match(
				h.api.errorMessage(error),
				/Check your fields.*At least 8 characters/,
			);
			return true;
		},
	);
	h.fetch(async () => {
		throw new TypeError("offline");
	});
	await assert.rejects(h.api.request("/state"), (error: unknown) => {
		assert.match(h.api.errorMessage(error), /Cannot reach the server/);
		return true;
	});
});

// The fixture uses only public HTTP, with a fresh DB outside the repository.
// Run inside `nix develop` to include FastAPI/uvicorn; no backend files are edited.
test("mobile fetch + transport integrate with the real FastAPI HTTP session and SQLite fixture", async (t) => {
	const { spawn, spawnSync } = await import("node:child_process");
	const { mkdtemp, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const { randomUUID } = await import("node:crypto");
	const { createSimpleTransport } = await import(
		"../../src/lib/simple-transport"
	);
	if (
		spawnSync("python3", ["-c", "import fastapi, uvicorn"], { stdio: "ignore" })
			.status !== 0
	) {
		t.skip("Run in nix develop for the real FastAPI HTTP fixture");
		return;
	}
	const directory = await mkdtemp(join(tmpdir(), "oculog-mobile-http-"));
	const server = spawn(
		"python3",
		["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "0"],
		{
			cwd: fileURLToPath(new URL("../../../", import.meta.url)),
			env: { ...process.env, OCULOG_DB_PATH: join(directory, "fresh.sqlite3") },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	try {
		const origin = await new Promise<string>((resolve, reject) => {
			let output = "";
			const timer = setTimeout(
				() => reject(new Error(`Fixture startup timed out: ${output}`)),
				30000,
			);
			const receive = (chunk: Buffer) => {
				output += chunk.toString();
				const match = output.match(
					/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/,
				);
				if (match) {
					clearTimeout(timer);
					resolve(match[1]);
				}
			};
			server.stdout.on("data", receive);
			server.stderr.on("data", receive);
			server.once("error", (error) => {
				clearTimeout(timer);
				reject(error);
			});
			server.once("exit", (code) => {
				clearTimeout(timer);
				reject(new Error(`Fixture exited ${code}: ${output}`));
			});
		});
		const h = harness("ios", null, origin);
		h.fetch(async (url, init) => {
			const response = await fetch(url, init);
			if (url.endsWith("/api/auth/register"))
				assert.equal(response.status, 201);
			return response;
		});
		const credentials = {
			email: "mobile@example.com",
			password: "password123",
		};
		const read = deferred<string | null>();
		const reading = deferred<void>();
		h.reader(() => {
			reading.resolve();
			return read.promise;
		});
		const screen = authScreen(h.api, "register", "America/New_York");
		const initialization = (async () => {
			await h.api.hydrate();
			await verifySession(
				() => h.api.sessionStore.isValid,
				h.api.refreshAuth,
				h.api.clearSession,
			);
			screen.store.ready = true;
		})();
		await reading.promise;
		screen.fill("Email", credentials.email);
		screen.fill("Name", "Mobile");
		screen.fill("Password", credentials.password);
		screen.fill("Confirm password", credentials.password);
		assert.equal(screen.button().props.disabled, true);
		screen.press();
		assert.equal(
			h.calls.length,
			0,
			"even a direct disabled-button callback cannot create an orphan account",
		);
		read.resolve(null);
		await initialization;
		assert.equal(screen.button().props.disabled, false);
		const provider = await initializedStore(h.api);
		const writing = deferred<void>(),
			releaseWrite = deferred<void>();
		h.writer(async () => {
			writing.resolve();
			await releaseWrite.promise;
		});
		screen.press();
		await writing.promise; // The real server has returned HTTP 201.
		assert.equal(h.api.sessionStore.hasSession, false);
		provider.activate();
		await provider.render().reload();
		assert.equal(provider.domainReads(), 0);
		releaseWrite.resolve();
		await screen.flush();
		assert.equal(
			h.calls.filter((call) => call.url.endsWith("/api/auth/register")).length,
			1,
		);
		assert.equal(screen.feedback().error, "");
		assert.deepEqual(screen.redirects, ["/onboarding"]);
		const owner = h.api.sessionStore.account?.id;
		const token = h.api.sessionStore.token;
		assert.ok(owner);
		assert.equal(await h.api.refreshAuth(), true);
		assert.equal(h.api.sessionStore.token, token);
		const transport = createSimpleTransport(
			h.api.request,
			() => ({
				owner: h.api.sessionStore.account?.id,
				token: h.api.sessionStore.token,
			}),
			randomUUID,
			h.api.rejectSession,
		);
		const initial = await transport.state();
		assert.equal(initial.timeZone, "America/New_York");
		assert.equal(initial.daily.worn, null);
		assert.equal(initial.eyes[0].spareCount, 0);
		await transport.post("settings", {
			eye: "left",
			replacementDays: 14,
			openedOn: initial.today,
			timeZone: initial.timeZone,
		});
		const options = {
			method: "POST",
			body: { eye: "left", quantity: 2 },
			headers: { "Idempotency-Key": "http-retry-ledger" },
		};
		await h.api.request("/api/oculog/v1/simple/add", options);
		await h.api.request("/api/oculog/v1/simple/add", options);
		assert.equal((await transport.state()).eyes[0].spareCount, 2);
		await transport.post("day", { localDate: initial.today, worn: true });
		await h.api.logoutSession();
		assert.equal(h.api.sessionStore.account, null);
		assert.equal(h.saved(), null);
		assert.equal(
			(
				await fetch(`${origin}/api/auth/session`, {
					headers: { Authorization: `Bearer ${token}` },
				})
			).status,
			401,
		);
		await h.api.authenticate("login", credentials);
		assert.equal(h.api.sessionStore.account?.id, owner);
		assert.equal((await transport.state()).daily.worn, true);
		await h.api.authenticate("register", {
			email: "other@example.com",
			password: "password123",
			displayName: "Other",
			timeZone: "UTC",
		});
		const other = await transport.state();
		assert.equal(other.daily.worn, null);
		assert.equal(other.eyes[0].spareCount, 0);
	} finally {
		if (server.exitCode === null) {
			const exited = new Promise<void>((resolve) =>
				server.once("exit", () => resolve()),
			);
			server.kill("SIGTERM");
			await exited;
		}
		await rm(directory, { recursive: true, force: true });
	}
});

test("offline restore stays gated until server validation succeeds; web ignores disk credentials", async () => {
	const h = harness("ios", JSON.stringify(session()));
	await h.api.hydrate();
	h.fetch(async () => {
		throw new TypeError("offline");
	});
	await assert.rejects(h.api.refreshAuth());
	assert.equal(h.api.user(), null);
	assert.equal(
		h.api.sessionStore.token,
		"opaque-a",
		"retry does not destroy an unexpired session on network failure",
	);
	h.fetch(async () => Response.json(session()));
	await h.api.refreshAuth();
	assert.equal(h.api.user()?.id, "a");
	const web = harness("web", JSON.stringify(session()));
	await web.api.hydrate();
	assert.equal(web.api.user(), null);
	assert.equal(web.api.sessionStore.token, "");
});

test("failed native persistence stays unauthenticated and the real useAction reports a recoverable error", async () => {
	const h = harness();
	h.fetch(async () => Response.json(session(), { status: 201 }));
	h.writer(async () => {
		throw new Error("keychain unavailable");
	});
	const screen = authScreen(h.api);
	screen.store.ready = true;
	screen.fill("Email", "a@example.com");
	screen.fill("Password", "password123");
	screen.fill("Confirm password", "password123");
	screen.press();
	await screen.flush();
	assert.equal(h.api.user(), null);
	assert.equal(h.api.sessionStore.token, "");
	assert.equal(h.saved(), null);
	assert.match(
		screen.feedback().error,
		/Could not securely save.*not signed in.*sign in again/,
	);
	assert.equal(screen.feedback().busy, false);
	assert.deepEqual(screen.redirects, []);
	h.writer(async () => {});
	const login = authScreen(h.api, "login");
	login.store.ready = true;
	login.fill("Email", "a@example.com");
	login.fill("Password", "password123");
	login.press();
	await login.flush();
	assert.equal(h.api.user()?.id, "a");
	assert.deepEqual(login.redirects, ["/"]);
});
test("delayed secure candidate is not published; logout/new authentication invalidate it without deleting the new account", async () => {
	for (const logout of [false, true]) {
		const h = harness();
		const entered = deferred<void>(),
			gate = deferred<void>();
		let writes = 0;
		h.writer(async () => {
			if (++writes === 1) {
				entered.resolve();
				await gate.promise;
			}
		});
		const screen = authScreen(h.api);
		screen.store.ready = true;
		screen.fill("Email", "a@example.com");
		screen.fill("Password", "password123");
		screen.fill("Confirm password", "password123");
		screen.press();
		await entered.promise;
		assert.equal(h.api.user(), null);
		assert.equal(h.api.sessionStore.token, "");
		const clearing = logout ? h.api.logoutSession() : Promise.resolve();
		h.fetch(async () => Response.json(session("b")));
		const next = h.api.authenticate("login", {
			email: "b@example.com",
			password: "password123",
		});
		gate.resolve();
		await Promise.all([screen.flush(), clearing, next]);
		assert.deepEqual(
			screen.redirects,
			[],
			"invalidated candidate cannot navigate",
		);
		assert.equal(screen.feedback().error, "");
		assert.equal(h.api.user()?.id, "b");
		assert.equal(JSON.parse(h.saved() || "null").account.id, "b");
	}
});
test("storage restore/delete failures are explicit and the serialized queue remains recoverable", async () => {
	for (const failure of ["read", "delete"]) {
		const h = harness();
		if (failure === "read")
			h.reader(async () => {
				throw new Error("Cannot read secure session");
			});
		else
			h.writer(async () => {
				throw new Error("Cannot delete secure session");
			});
		const store = await initializedStore(h.api);
		assert.equal(
			store.ready,
			true,
			"a storage failure cannot strand initialization",
		);
		assert.match(store.error, /secure session/);
		assert.equal(store.account, null);
		assert.equal(h.api.user(), null);
		h.reader(async () => null);
		h.writer(async () => {});
		await h.api.hydrate();
		await h.api.authenticate("login", {
			email: "a@example.com",
			password: "password123",
		});
		assert.equal(h.api.user()?.id, "a");
	}
});

for (const stage of ["http", "secure-write"] as const) {
	test(`actual Provider foreground callback cannot invalidate a pending ${stage} authentication`, async () => {
		const h = harness();
		const provider = await initializedStore(h.api);
		assert.equal(provider.ready, true);
		const screen = authScreen(h.api, stage === "http" ? "login" : "register");
		screen.store.ready = provider.ready;
		screen.fill("Email", "a@example.com");
		screen.fill("Password", "password123");
		if (stage === "secure-write")
			screen.fill("Confirm password", "password123");
		let clears = 0;
		const clear = h.api.clearSession;
		h.api.clearSession = async () => {
			clears++;
			await clear();
		};
		const http = deferred<Response>(),
			entered = deferred<void>(),
			write = deferred<void>();
		h.fetch(async () => {
			if (stage === "http") {
				entered.resolve();
				return http.promise;
			}
			return Response.json(session(), { status: 201 });
		});
		if (stage === "secure-write")
			h.writer(async () => {
				entered.resolve();
				await write.promise;
			});
		screen.press();
		await entered.promise;
		assert.equal(h.api.sessionStore.hasSession, false);
		provider.activate();
		// Exercise both AppState's production callback and a direct Retry/reload.
		await provider.render().reload();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(
			clears,
			0,
			"empty-session validation must not advance the authentication epoch",
		);
		assert.equal(provider.domainReads(), 0);
		assert.equal(screen.feedback().busy, true);
		if (stage === "http") http.resolve(Response.json(session()));
		else write.resolve();
		await screen.flush();
		assert.equal(h.api.user()?.id, "a");
		assert.equal(JSON.parse(h.saved() || "null").account.id, "a");
		assert.deepEqual(screen.redirects, [
			stage === "http" ? "/" : "/onboarding",
		]);
		assert.equal(screen.feedback().busy, false);
		assert.equal(screen.feedback().error, "");
	});
}
test("Provider foreground still clears an installed expired session, distinct from an empty store", async () => {
	const h = harness();
	await h.api.authenticate("login", {
		email: "a@example.com",
		password: "password123",
	});
	const provider = await initializedStore(h.api);
	assert.equal(h.api.sessionStore.hasSession, true);
	let clears = 0;
	const clear = h.api.clearSession;
	h.api.clearSession = async () => {
		clears++;
		await clear();
	};
	h.clock(Date.parse("2100-01-01T00:00:00Z"));
	provider.activate();
	await new Promise((resolve) => setImmediate(resolve));
	await h.api.persist();
	assert.equal(clears, 1);
	assert.equal(h.api.sessionStore.hasSession, false);
	assert.equal(h.api.user(), null);
	assert.equal(h.saved(), null);
	assert.equal(provider.domainReads(), 0);
});
