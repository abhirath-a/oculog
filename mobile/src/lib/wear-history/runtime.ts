import { randomUUID } from "expo-crypto";
import { request, sessionStore } from "../api";
import {
	createWearHistoryController,
	type WearHistorySession,
	type WearHistoryTransport,
} from "./controller";
import {
	parseAutomationPreferences,
	parseDayResult,
	parseWearHistory,
} from "./model";

const prefix = "/api/oculog/v2/wear";
type Send = <T>(path: string, options: Record<string, unknown>) => Promise<T>;
/** In-memory retry receipts only. Never queues or retries a request automatically. */
export function createWearHistoryTransport(
	send: Send,
	currentSession: () => WearHistorySession,
	uuid: () => string,
) {
	const retryKeys = new Map<string, string>();
	const resourceIntents = new Map<string, string>();
	let scope = "";
	let generation = 0;
	function syncSession() {
		const session = currentSession();
		const next = session ? JSON.stringify([session.owner, session.token]) : "";
		if (next !== scope) {
			scope = next;
			generation++;
			retryKeys.clear();
			resourceIntents.clear();
		}
		return session;
	}
	function capture() {
		const session = syncSession();
		if (!session) throw new Error("Sign in to view wear history.");
		return { ...session, generation, scope };
	}
	function assertCurrent(captured: ReturnType<typeof capture>) {
		syncSession();
		if (captured.generation !== generation || captured.scope !== scope)
			throw new Error("Your session changed. Reload wear history.");
	}
	async function post<T>(
		path: string,
		body: unknown,
		parse: (value: unknown) => T,
	): Promise<T> {
		// Capture token AND fingerprint before the first await, not inside a later callback.
		const captured = capture();
		const fingerprint = JSON.stringify([captured.scope, path, body]);
		const resource = JSON.stringify([
			captured.scope,
			path,
			path === "/day"
				? (body as { localDate: string }).localDate
				: "preferences",
		]);
		const previous = resourceIntents.get(resource);
		// A contradictory choice is a new intent, not a later replay of an old value.
		if (previous && previous !== fingerprint) retryKeys.delete(previous);
		resourceIntents.set(resource, fingerprint);
		const key = retryKeys.get(fingerprint) || uuid();
		retryKeys.set(fingerprint, key);
		try {
			const value = await send<unknown>(prefix + path, {
				method: "POST",
				body,
				headers: {
					Authorization: `Bearer ${captured.token}`,
					"Idempotency-Key": key,
				},
			});
			assertCurrent(captured);
			const result = parse(value);
			if (retryKeys.get(fingerprint) === key) retryKeys.delete(fingerprint);
			return result;
		} catch (error) {
			// Old completions cannot remove a newer scope's retry intent.
			assertCurrent(captured);
			const status = (error as { status?: number } | null)?.status;
			if (
				typeof status === "number" &&
				status >= 400 &&
				status < 500 &&
				status !== 408 &&
				retryKeys.get(fingerprint) === key
			)
				retryKeys.delete(fingerprint);
			throw error;
		}
	}
	const transport: WearHistoryTransport = {
		async history(month) {
			const captured = capture();
			const value = await send<unknown>(
				`${prefix}/history?month=${encodeURIComponent(month)}`,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${captured.token}` },
				},
			);
			assertCurrent(captured);
			const history = parseWearHistory(value);
			if (history.month !== month)
				throw new Error("The server returned the wrong calendar month.");
			return history;
		},
		day(body) {
			const capturedBody = { localDate: body.localDate, worn: body.worn };
			return post("/day", capturedBody, (value) => {
				const result = parseDayResult(value);
				if (
					result.day.localDate !== capturedBody.localDate ||
					result.day.worn !== capturedBody.worn
				)
					throw new Error(
						"The server returned a different wear history change.",
					);
				return result;
			});
		},
		automation(body) {
			const capturedBody = {
				enabled: body.enabled,
				weekdays: [...body.weekdays].sort((a, b) => a - b),
			};
			return post("/automation", capturedBody, (value) => {
				const result = parseAutomationPreferences(value);
				if (
					result.enabled !== capturedBody.enabled ||
					JSON.stringify(result.weekdays) !==
						JSON.stringify(capturedBody.weekdays)
				)
					throw new Error(
						"The server returned different automatic logging preferences.",
					);
				return result;
			});
		},
	};
	return { transport, syncSession };
}

export function createDeviceWearHistoryController() {
	const currentSession = (): WearHistorySession => {
		const owner = sessionStore.account?.id;
		const token = sessionStore.token;
		return owner && token && sessionStore.isValid ? { owner, token } : null;
	};
	const runtime = createWearHistoryTransport(
		request,
		currentSession,
		randomUUID,
	);
	const controller = createWearHistoryController(
		runtime.transport,
		currentSession,
	);
	let unsubscribe: (() => void) | undefined;
	return {
		...controller,
		mount() {
			unsubscribe ??= sessionStore.onChange(() => {
				runtime.syncSession();
				controller.getState();
			});
			return controller.mount();
		},
		dispose() {
			unsubscribe?.();
			unsubscribe = undefined;
			controller.dispose();
		},
	};
}
