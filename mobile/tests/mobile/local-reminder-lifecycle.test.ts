// biome-ignore-all lint/suspicious/noExplicitAny: Hook harness isolates native side effects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(initialReady = true) {
	let session = { account: { id: "A" }, token: "token-A", isValid: true };
	const saved = (owner: string, worn: boolean | null = null) => ({
		today: "2026-10-24",
		timeZone: "UTC",
		daily: { localDate: "2026-10-24", worn },
		eyes: [{ id: `${owner}-eye` }],
	});
	let store: any = {
		ready: true,
		account: session.account,
		state: saved("A"),
		pending: false,
		loading: false,
	};
	const navigation: any = { key: "ready" };
	let sessionListener = () => {},
		repoListener = () => {},
		reminderListener = () => {},
		responseListener: any;
	let ready = initialReady,
		clears = 0;
	const a = deferred<any>(),
		route = deferred<any>();
	let b: any = { id: "rx-B" };
	const snapshots: any[] = [],
		pushes: any[] = [];
	const refs: any[] = [],
		effects: any[] = [];
	let refIndex = 0,
		effectIndex = 0;
	const pending: (() => void)[] = [];
	let handlerCount = 0;
	const mocks: Record<string, any> = {
		react: {
			useRef(initial: any) {
				const index = refIndex++;
				if (!refs[index]) refs[index] = { current: initial };
				return refs[index];
			},
			useEffect(fn: any, deps: any[]) {
				const index = effectIndex++,
					previous = effects[index];
				if (!previous || deps.some((v, i) => v !== previous.deps[i]))
					pending.push(() => {
						previous?.cleanup?.();
						effects[index] = { deps, cleanup: fn() };
					});
			},
		},
		"expo-router": {
			useRouter: () => ({ navigate: (path: string) => pushes.push(path) }),
			useRootNavigationState: () => navigation,
		},
		"react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
		"expo-notifications": {
			setNotificationHandler(value: any) {
				if (value) handlerCount++;
			},
			getLastNotificationResponseAsync: async () => null,
			clearLastNotificationResponseAsync: async () => {
				clears++;
			},
			addNotificationResponseReceivedListener(fn: any) {
				responseListener = fn;
				return { remove() {} };
			},
		},
		"../lib/api": {
			sessionStore: {
				get account() {
					return session.account;
				},
				get token() {
					return session.token;
				},
				get isValid() {
					return session.isValid;
				},
				onChange(fn: any) {
					sessionListener = fn;
					return () => {};
				},
			},
		},
		"../lib/local-reminders/runtime": {
			reminderManager: {
				setSnapshot: (s: any) => snapshots.push(structuredClone(s)),
				reconcile: async () => {},
				getState: () => ({ loading: !ready, busy: !ready }),
				subscribe(fn: any) {
					reminderListener = fn;
					return () => {};
				},
			},
			notificationContextReady: () => ready,
			routeForNotification: () =>
				session.account.id === "A" ? route.promise : Promise.resolve(null),
			shouldPresentNotification: () => true,
		},
		"../lib/prescriptions/device-repository": {
			prescriptionRepository: {
				load: (owner: string) =>
					owner === "A" ? a.promise : Promise.resolve(b),
				subscribe(fn: any) {
					repoListener = fn;
					return () => {};
				},
			},
		},
		"../lib/prescriptions/ocr": { cleanupPrescriptionImages: async () => {} },
		"../lib/store": { useStore: () => store },
	};
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					"../../src/components/local-reminder-lifecycle.tsx",
					import.meta.url,
				),
				"utf8",
			),
			{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
		).outputText,
		{
			exports,
			require(name: string) {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	const render = () => {
		refIndex = 0;
		effectIndex = 0;
		exports.LocalReminderLifecycle();
		while (pending.length) pending.shift()?.();
	};
	render();
	return {
		snapshots,
		pushes,
		a,
		route,
		render,
		saved,
		setStore(value: any) {
			store = value;
		},
		getStore: () => store,
		switchToB() {
			session = { account: { id: "B" }, token: "token-B", isValid: true };
			sessionListener();
			store = { ...store, account: session.account, state: saved("B") };
			render();
		},
		changeToken() {
			session = { ...session, token: "new-token" };
			sessionListener();
			render();
		},
		deleteB() {
			b = null;
			repoListener();
		},
		tap() {
			responseListener({
				notification: {
					request: {
						content: { data: { feature: "oculog.local-reminders.v1" } },
					},
				},
			});
		},
		getHandlerCount: () => handlerCount,
		setReady(value: boolean) {
			ready = value;
			reminderListener();
		},
		getClears: () => clears,
		cleanup() {
			for (const effect of effects) effect?.cleanup?.();
		},
	};
}
test("root discards deferred Rx A after account changes and clears deleted Rx before reloading", async () => {
	const h = harness();
	h.switchToB();
	h.a.resolve({ id: "rx-A" });
	await tick();
	const b = h.snapshots.filter((s) => s.owner === "B");
	assert.ok(b.length);
	assert.ok(
		b.every(
			(s) => s.prescription?.id !== "rx-A" && s.state?.eyes[0].id !== "A-eye",
		),
	);
	assert.equal(b.at(-1).prescription.id, "rx-B");
	h.deleteB();
	assert.equal(h.snapshots.at(-1).prescription, null);
	await tick();
	assert.equal(h.snapshots.at(-1).prescription, null);
	h.cleanup();
});
test("root never supplies pending wear optimism as a confirmed daily log", () => {
	const h = harness();
	h.setStore({ ...h.getStore(), pending: true, state: h.saved("A", true) });
	h.render();
	assert.equal(h.snapshots.at(-1).state.daily.worn, null);
	assert.equal(
		h.getHandlerCount(),
		1,
		"router object identity must not recreate global policy",
	);
	h.cleanup();
});
test("notification routing is fenced if the account changes during async resolution", async () => {
	const h = harness();
	h.tap();
	h.switchToB();
	h.route.resolve("/prescriptions");
	await tick();
	assert.deepEqual(h.pushes, []);
	h.cleanup();
});
test("cold-start taps wait for account notification initialization before consuming", async () => {
	const h = harness(false);
	h.tap();
	h.route.resolve("/prescriptions");
	await tick();
	assert.deepEqual(h.pushes, []);
	assert.equal(h.getClears(), 0);
	h.setReady(true);
	await tick();
	assert.deepEqual(h.pushes, ["/prescriptions"]);
	assert.equal(h.getClears(), 1);
	h.cleanup();
});
