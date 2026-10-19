import type { SimpleState } from "../../shared/simple-domain";
import type { Commands, SimpleTransport } from "./simple-controller";

const prefix = "/api/oculog/v1/simple";

function responseStatus(error: unknown) {
	return (error as { status?: number }).status || 0;
}
/** Keep the same key after uncertain delivery; never persist or queue a write. */
export function createSimpleTransport(
	send: <T>(path: string, options: Record<string, unknown>) => Promise<T>,
	session: () => { owner: string | undefined; token: string },
	uuid: () => string,
	reject: (
		status: number,
		token: string,
		owner: string | undefined,
	) => Promise<void>,
): SimpleTransport {
	const retryKeys = new Map<string, string>();
	async function request(path: string, options: Record<string, unknown>) {
		const { owner, token } = session();
		try {
			return await send<SimpleState>(prefix + path, {
				...options,
				headers: {
					...(options.headers as object),
					Authorization: `Bearer ${token}`,
				},
			});
		} catch (error) {
			await reject(responseStatus(error), token, owner);
			throw error;
		}
	}
	return {
		state: () => request("/state", { method: "GET" }),
		post: async <K extends keyof Commands>(route: K, body: Commands[K]) => {
			const { owner } = session();
			const fingerprint = JSON.stringify([owner, route, body]);
			const idempotencyKey = retryKeys.get(fingerprint) || uuid();
			retryKeys.set(fingerprint, idempotencyKey);
			try {
				const state = await request(`/${route}`, {
					method: "POST",
					body,
					headers: { "Idempotency-Key": idempotencyKey },
				});
				retryKeys.delete(fingerprint);
				return state;
			} catch (error) {
				const status = responseStatus(error);
				// A rejected intent can use a new key; uncertain delivery must reuse it.
				if (status >= 400 && status < 500) retryKeys.delete(fingerprint);
				throw error;
			}
		},
	};
}
