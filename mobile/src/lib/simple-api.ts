import * as Crypto from "expo-crypto";
import { rejectSession, request, sessionStore } from "./api";
import { createSimpleTransport } from "./simple-transport";
export const simpleAPI = createSimpleTransport(
	(path, options) => request(path, options),
	() => ({ owner: sessionStore.account?.id, token: sessionStore.token }),
	() => Crypto.randomUUID(),
	rejectSession,
);
