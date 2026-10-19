import type React from "react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { AppState } from "react-native";
import {
	type Account,
	clearSession,
	errorMessage,
	hydrate,
	logoutSession,
	refreshAuth,
	sessionStore,
	user,
} from "./api";
import { cleanupPrivateFiles } from "./files";
import { verifySession } from "./safety";
import { simpleAPI } from "./simple-api";
import {
	type Commands,
	SimpleController,
	type Snapshot,
} from "./simple-controller";

type Store = Snapshot & {
	account: Account | null;
	ready: boolean;
	reload: () => Promise<void>;
	mutate: <K extends keyof Commands>(
		route: K,
		body: Commands[K],
	) => Promise<boolean>;
	syncAuth: () => void;
	connectionFailed: () => void;
	logout: () => Promise<void>;
};
const Context = createContext<Store>(null!);

function currentSession() {
	return { owner: sessionStore.account?.id, token: sessionStore.token };
}

function isCurrentSession(session: ReturnType<typeof currentSession>) {
	return (
		sessionStore.account?.id === session.owner &&
		sessionStore.token === session.token
	);
}

export function Provider({ children }: { children: React.ReactNode }) {
	const controller = useRef(
		new SimpleController(simpleAPI, errorMessage),
	).current;
	const [snapshot, setSnapshot] = useState(controller.snapshot);
	const [account, setAccount] = useState<Account | null>(null);
	const [ready, setReady] = useState(false);
	const [authError, setAuthError] = useState("");

	const clearLocal = useCallback(async () => {
		controller.account(null);
		const clearing = clearSession();
		setAccount(null);
		setAuthError("");
		await Promise.all([clearing, cleanupPrivateFiles()]);
	}, [controller]);

	const validate = useCallback(async () => {
		// An empty store has nothing to invalidate. In particular, foreground
		// checks must not cancel authentication that has not installed a session.
		if (!sessionStore.hasSession) return false;
		const session = currentSession();
		return verifySession(
			() => sessionStore.account?.id === session.owner && sessionStore.isValid,
			refreshAuth,
			async () => {
				if (isCurrentSession(session)) await clearLocal();
			},
		);
	}, [clearLocal]);

	const reload = useCallback(async () => {
		const session = currentSession();
		setAuthError("");
		try {
			if ((await validate()) && sessionStore.account) {
				await controller.reload();
			}
		} catch (error) {
			if (isCurrentSession(session)) setAuthError(errorMessage(error));
		}
	}, [validate, controller]);

	useEffect(
		() => controller.subscribe(() => setSnapshot(controller.snapshot)),
		[controller],
	);

	useEffect(() => {
		let live = true;
		let identity = "";
		const sync = () => {
			if (!live) return;
			const nextAccount = sessionStore.isValid ? user() : null;
			const nextIdentity = `${nextAccount?.id}:${sessionStore.token}`;
			if (identity !== nextIdentity) {
				identity = nextIdentity;
				controller.session(nextAccount?.id || null);
			}
			setAccount(nextAccount);
		};
		const unsubscribe = sessionStore.onChange(sync);

		async function initialize() {
			try {
				await cleanupPrivateFiles();
				await hydrate();
				await validate();
				sync();
			} catch (error) {
				if (live) setAuthError(errorMessage(error));
			} finally {
				if (live) setReady(true);
			}
		}
		void initialize();

		const checkDay = () => {
			const session = currentSession();
			void controller.checkDay(live).catch((error) => {
				if (live && isCurrentSession(session)) {
					setAuthError(errorMessage(error));
				}
			});
		};
		let dayTimer: ReturnType<typeof setInterval> | undefined;
		const watchDay = (active: boolean) => {
			clearInterval(dayTimer);
			dayTimer = undefined;
			if (active) dayTimer = setInterval(checkDay, 30000);
		};
		watchDay(
			AppState.currentState === null || AppState.currentState === "active",
		);
		const appSubscription = AppState.addEventListener("change", (state) => {
			watchDay(state === "active");
			if (state === "active" && live) void reload();
		});
		const expiryTimer = setInterval(() => {
			if (sessionStore.token && !sessionStore.isValid) void clearLocal();
		}, 10000);

		return () => {
			live = false;
			unsubscribe();
			appSubscription.remove();
			clearInterval(dayTimer);
			clearInterval(expiryTimer);
			controller.account(null);
		};
	}, [controller, validate, reload, clearLocal]);

	useEffect(() => {
		if (ready && account?.id) void reload();
	}, [ready, account?.id, reload]);

	const mutate: Store["mutate"] = async (route, body) => {
		if (!sessionStore.isValid) {
			await clearLocal();
			throw new Error("Please sign in again.");
		}
		return controller.mutate(route, body);
	};
	const logout = async () => {
		controller.account(null);
		setAccount(null);
		setAuthError("");
		try {
			await Promise.all([logoutSession(), cleanupPrivateFiles()]);
		} catch (error) {
			if (!sessionStore.account) setAuthError(errorMessage(error));
			throw error;
		}
	};
	const syncAuth = () => {
		setAccount(user());
		void reload();
	};
	const connectionFailed = () => {
		setAuthError(
			"Cannot reach the server. Retry before saving. No changes have been queued.",
		);
	};

	return (
		<Context.Provider
			value={{
				...snapshot,
				error: authError || snapshot.error,
				online: snapshot.online && !authError,
				account,
				ready,
				reload,
				mutate,
				syncAuth,
				connectionFailed,
				logout,
			}}
		>
			{children}
		</Context.Provider>
	);
}
export const useStore = () => useContext(Context);
