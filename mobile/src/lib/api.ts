import * as SecureStore from "expo-secure-store";

export type Account = import("../../shared/domain").User;
export interface Session {
	token: string;
	expiresAt: string;
	account: Account;
}
export const apiURL = (
	process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const AUTH = "oculog.auth";
let value: Session | null = null;
let validated = false;
let epoch = 0;
let persistence: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
export const sessionStore = {
	get hasSession() {
		return value !== null;
	},
	get token() {
		return value?.token || "";
	},
	get account() {
		return value?.account || null;
	},
	get isValid() {
		return !!value && Date.parse(value.expiresAt) > Date.now();
	},
	onChange(listener: () => void) {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	},
};
function publish(next: Session | null, trusted = true) {
	value = next;
	validated = trusted;
	epoch++;
	for (const listener of listeners) listener();
}
async function writeSession(session: Session | null) {
	if (session)
		await SecureStore.setItemAsync(AUTH, JSON.stringify(session), {
			keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
		});
	else await SecureStore.deleteItemAsync(AUTH);
}
function enqueue<T>(operation: () => Promise<T>) {
	const next = persistence.catch(() => {}).then(operation);
	persistence = next.then(
		() => {},
		() => {},
	);
	return next;
}
export function persist() {
	const snapshot = value;
	return enqueue(() => writeSession(snapshot));
}
async function acceptSession(candidate: Session, ticket: number) {
	return enqueue(async () => {
		if (ticket !== epoch) return false;
		try {
			await writeSession(candidate);
		} catch {
			// A failed native operation can have uncertain delivery too. Repair
			// only while holding this queue; later logout/login work stays ordered.
			await writeSession(value).catch(() => {});
			if (ticket !== epoch) return false;
			throw new Error(
				"Could not securely save your session. You are not signed in. If you just created an account, sign in again.",
			);
		}
		if (ticket !== epoch) {
			// Repair the stale write while holding the queue, before a newer
			// candidate can persist. Never enqueue a captured old-account delete.
			await writeSession(value);
			return false;
		}
		publish(candidate);
		return true;
	});
}
function validSession(input: unknown): input is Session {
	const s = input as Session | null;
	return (
		!!s &&
		typeof s.token === "string" &&
		!!s.token &&
		typeof s.expiresAt === "string" &&
		Number.isFinite(Date.parse(s.expiresAt)) &&
		!!s.account &&
		[
			s.account.id,
			s.account.email,
			s.account.displayName,
			s.account.timeZone,
		].every((x) => typeof x === "string") &&
		!!s.account.id
	);
}
export async function clearSession() {
	publish(null);
	await persist();
}
export async function hydrate() {
	const ticket = epoch;
	await persistence.catch(() => {});
	const data = await SecureStore.getItemAsync(AUTH);
	if (ticket !== epoch) return;
	let saved: unknown;
	try {
		saved = data ? JSON.parse(data) : null;
	} catch {
		saved = null;
	}
	if (validSession(saved) && Date.parse(saved.expiresAt) > Date.now())
		publish(saved, false);
	else await clearSession();
}
export class APIError extends Error {
	constructor(
		public status: number,
		public response: {
			error?: {
				code?: string;
				message?: string;
				fields?: Record<string, string>;
			};
		},
		message?: string,
	) {
		super(response.error?.message || message || "Request failed.");
	}
}
export async function rejectSession(
	status: number,
	token: string | null,
	owner: string | undefined,
) {
	if (
		status === 401 &&
		token &&
		token === sessionStore.token &&
		owner === sessionStore.account?.id
	)
		await clearSession();
}
export async function request<T>(
	path: string,
	options: Record<string, unknown> = {},
): Promise<T> {
	const token = sessionStore.token;
	const owner = sessionStore.account?.id;
	const headers = new Headers(options.headers as HeadersInit | undefined);
	if (!headers.has("Authorization") && token)
		headers.set("Authorization", `Bearer ${token}`);
	if (options.body !== undefined)
		headers.set("Content-Type", "application/json");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 30000);
	try {
		const response = await fetch(apiURL + path, {
			method: (options.method as string) || "GET",
			headers,
			body:
				options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: controller.signal,
		});
		await rejectSession(
			response.status,
			headers.get("Authorization") === `Bearer ${token}` ? token : null,
			owner,
		);
		if (response.status === 204) return undefined as T;
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			body = {};
		}
		if (!response.ok)
			throw new APIError(
				response.status,
				(body && typeof body === "object" ? body : {}) as APIError["response"],
			);
		return body as T;
	} catch (error) {
		if (error instanceof APIError) throw error;
		throw new APIError(0, {}, "Cannot reach the server.");
	} finally {
		clearTimeout(timer);
	}
}
export async function authenticate(
	mode: "login" | "register",
	body: {
		email: string;
		password: string;
		displayName?: string;
		timeZone?: string;
	},
) {
	const ticket = ++epoch;
	const result = await request<Session>(`/api/auth/${mode}`, {
		method: "POST",
		body,
		headers: { Authorization: "" },
	});
	if (ticket !== epoch) return false;
	if (!validSession(result))
		throw new Error("The server returned an invalid session.");
	return acceptSession(result, ticket);
}
export async function refreshAuth() {
	const ticket = epoch;
	const result = await request<Session>("/api/auth/session");
	if (ticket !== epoch) return false;
	if (!validSession(result))
		throw new Error("The server returned an invalid session.");
	return acceptSession(result, ticket);
}
export async function logoutSession() {
	const token = sessionStore.token;
	// Start revocation using the captured token, but clear locally even offline.
	const revoke = token
		? request<void>("/api/auth/logout", {
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
			})
		: Promise.resolve();
	const cleared = clearSession();
	const results = await Promise.allSettled([revoke, cleared]);
	if (results[1].status === "rejected") throw results[1].reason;
	if (results[0].status === "rejected")
		throw new Error(
			"Signed out on this device. Server sign-out could not be confirmed; the session will expire automatically.",
		);
}
export function user() {
	return validated && sessionStore.isValid ? sessionStore.account : null;
}
export function errorMessage(error: unknown): string {
	const e = error as {
		status?: number;
		response?: APIError["response"];
		message?: string;
	};
	if (e.status === 0)
		return "Cannot reach the server. Check your connection and server URL, then retry. Your changes have not been queued.";
	return [
		e.response?.error?.message || e.message || "Something went wrong.",
		...Object.values(e.response?.error?.fields || {}),
	]
		.filter(Boolean)
		.join(" ");
}
