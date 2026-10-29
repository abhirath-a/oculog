import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import type { SimpleState } from "../../shared/simple-domain";
import { sessionStore } from "../lib/api";
import type { ReminderSnapshot } from "../lib/local-reminders/model";
import {
	notificationContextReady,
	reminderManager,
	routeForNotification,
	shouldPresentNotification,
} from "../lib/local-reminders/runtime";
import { prescriptionRepository } from "../lib/prescriptions/device-repository";
import type { Prescription } from "../lib/prescriptions/model";
import { cleanupPrescriptionImages } from "../lib/prescriptions/ocr";
import { useStore } from "../lib/store";

const FEATURE = "oculog.local-reminders.v1";
function ownData(value: unknown): boolean {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(value as { feature?: unknown }).feature === FEATURE
	);
}

/** App-owned iOS local-notification policy. Never registers a push token. */
export function LocalReminderLifecycle() {
	const store = useStore();
	const latest = useRef(store);
	latest.current = store;
	const router = useRouter();
	const routerRef = useRef(router);
	routerRef.current = router;
	const navigation = useRootNavigationState();
	const navigationReady = useRef(false);
	navigationReady.current = !!navigation?.key;
	const publish = useRef<() => void>(() => {});
	const handlePending = useRef<() => void>(() => {});
	const pendingTap = useRef<unknown>(null);
	const processing = useRef(false);

	useEffect(() => {
		let live = true,
			revision = 0;
		let identity: string | null = null;
		let prescription: Prescription | null = null;
		let confirmed: { owner: string; state: SimpleState } | null = null;
		const authenticated = () => {
			const current = latest.current;
			const account = sessionStore.account;
			if (
				!current.ready ||
				!account ||
				current.account?.id !== account.id ||
				!sessionStore.isValid
			)
				return null;
			return {
				owner: account.id,
				sessionKey: JSON.stringify([account.id, sessionStore.token]),
			};
		};
		const snapshot = (): ReminderSnapshot => {
			const current = authenticated();
			if (!current)
				return {
					owner: null,
					sessionKey: null,
					state: null,
					prescription: null,
				};
			// Wear optimism must never masquerade as a confirmed daily log.
			if (
				!latest.current.pending &&
				!latest.current.loading &&
				latest.current.state
			)
				confirmed = { owner: current.owner, state: latest.current.state };
			return {
				...current,
				state: confirmed?.owner === current.owner ? confirmed.state : null,
				prescription,
			};
		};
		const refreshPrescription = async () => {
			const current = authenticated();
			const ticket = ++revision;
			prescription = null;
			reminderManager.setSnapshot(snapshot());
			if (!current) return;
			try {
				const value = await prescriptionRepository.load(current.owner);
				if (
					!live ||
					revision !== ticket ||
					authenticated()?.sessionKey !== current.sessionKey
				)
					return;
				prescription = value;
				reminderManager.setSnapshot(snapshot());
			} catch {
				// No unverified expiry scheduling when the device record cannot be read.
				if (
					live &&
					revision === ticket &&
					authenticated()?.sessionKey === current.sessionKey
				)
					reminderManager.setSnapshot(snapshot());
			}
		};
		const sync = () => {
			const next = authenticated()?.sessionKey ?? null;
			if (next !== identity) {
				identity = next;
				revision++;
				confirmed = null;
				prescription = null;
				void cleanupPrescriptionImages().catch(() => {});
				reminderManager.setSnapshot(snapshot());
				void refreshPrescription();
			} else reminderManager.setSnapshot(snapshot());
			handlePending.current();
		};
		publish.current = sync;
		handlePending.current = () => {
			if (
				!live ||
				processing.current ||
				!pendingTap.current ||
				!navigationReady.current ||
				!authenticated()
			)
				return;
			const status = reminderManager.getState();
			if (!notificationContextReady() || status.loading || status.busy) return;
			const data = pendingTap.current;
			const lease = authenticated()?.sessionKey;
			processing.current = true;
			void routeForNotification(data)
				.then((route) => {
					if (!live || authenticated()?.sessionKey !== lease) return;
					if (pendingTap.current === data) {
						pendingTap.current = null;
						void Notifications.clearLastNotificationResponseAsync().catch(
							() => {},
						);
					}
					if (route && navigationReady.current)
						routerRef.current.navigate(route);
				})
				.catch(() => {})
				.finally(() => {
					processing.current = false;
					if (
						live &&
						pendingTap.current &&
						(pendingTap.current !== data ||
							authenticated()?.sessionKey !== lease)
					)
						handlePending.current();
				});
		};
		const receive = (response: Notifications.NotificationResponse | null) => {
			const data = response?.notification.request.content.data;
			if (!ownData(data)) return;
			pendingTap.current = data;
			handlePending.current();
		};
		const unsubscribeReminderState = reminderManager.subscribe(() =>
			handlePending.current(),
		);
		const unsubscribeSession = sessionStore.onChange(sync);
		const unsubscribePrescription = prescriptionRepository.subscribe(() => {
			void refreshPrescription();
		});
		const responseSubscription =
			Notifications.addNotificationResponseReceivedListener(receive);
		const foreground = AppState.addEventListener("change", (state) => {
			if (state === "active") {
				sync();
				void reminderManager.reconcile();
			}
		});
		// No previous foreground handler exists. Unrecognized features retain the
		// SDK's default hidden-in-foreground behavior; extend this policy centrally.
		Notifications.setNotificationHandler({
			handleNotification: async (notification) => {
				const show =
					ownData(notification.request.content.data) &&
					shouldPresentNotification(notification.request.content.data);
				return {
					shouldShowBanner: show,
					shouldShowList: show,
					shouldPlaySound: show,
					shouldSetBadge: false,
				};
			},
		});
		void Notifications.getLastNotificationResponseAsync()
			.then(receive)
			.catch(() => {});
		void cleanupPrescriptionImages().catch(() => {});
		sync();
		return () => {
			live = false;
			revision++;
			publish.current = () => {};
			handlePending.current = () => {};
			unsubscribeReminderState();
			unsubscribeSession();
			unsubscribePrescription();
			responseSubscription.remove();
			foreground.remove();
			Notifications.setNotificationHandler(null);
			reminderManager.setSnapshot({
				owner: null,
				sessionKey: null,
				state: null,
				prescription: null,
			});
		};
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Snapshot changes deliberately trigger the ref-backed coordinator.
	useEffect(() => {
		publish.current();
	}, [
		store.ready,
		store.account,
		store.state,
		store.pending,
		store.loading,
		navigation?.key,
	]);
	return null;
}
