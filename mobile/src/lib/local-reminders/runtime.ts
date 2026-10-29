import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { createReminderManager, type StoredReminders } from "./manager";
import type { ReminderPermission } from "./model";

export { isFeatureNotification } from "./manager";
export type {
	ReminderManager,
	ReminderPreferences,
	ReminderSnapshot,
	ReminderState,
} from "./model";

const options = {
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const key = (hash: string) => `oculog.local-reminders.v1.${hash}`;
export const reminderManager = createReminderManager({
	hash: (owner) =>
		Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, owner),
	storage: {
		async load(hash) {
			const raw = await SecureStore.getItemAsync(key(hash), options);
			if (raw === null) return null;
			if (raw.length > 12000) throw new Error("Invalid local reminder data.");
			const value: unknown = JSON.parse(raw);
			if (!value || typeof value !== "object" || Array.isArray(value))
				throw new Error("Invalid local reminder data.");
			return value as StoredReminders;
		},
		async save(hash, value) {
			await SecureStore.setItemAsync(key(hash), JSON.stringify(value), options);
		},
	},
	async permission(request): Promise<ReminderPermission> {
		const result = request
			? await Notifications.requestPermissionsAsync({
					ios: { allowAlert: true, allowSound: true, allowBadge: false },
				})
			: await Notifications.getPermissionsAsync();
		if (
			result.granted ||
			result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
			result.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
		)
			return "granted";
		return result.status === "undetermined" ? "undetermined" : "denied";
	},
	async scheduled() {
		const requests = await Notifications.getAllScheduledNotificationsAsync();
		return requests.map((request) => ({
			identifier: request.identifier,
			data: request.content.data ?? {},
		}));
	},
	async schedule(plan, data) {
		return Notifications.scheduleNotificationAsync({
			content: { title: plan.title, body: plan.body, data, sound: "default" },
			trigger:
				plan.trigger.type === "daily"
					? {
							type: Notifications.SchedulableTriggerInputTypes.DAILY,
							hour: plan.trigger.hour,
							minute: plan.trigger.minute,
						}
					: {
							type: Notifications.SchedulableTriggerInputTypes.DATE,
							date: plan.trigger.date,
						},
		});
	},
	cancel: (identifier) =>
		Notifications.cancelScheduledNotificationAsync(identifier),
	now: () => new Date(),
});
export const notificationContextReady = (): boolean =>
	reminderManager.notificationContextReady();
export const shouldPresentNotification = (data: unknown): boolean =>
	reminderManager.shouldPresentNotification(data);
export const routeForNotification = (
	data: unknown,
): Promise<"/prescriptions" | "/(tabs)/home" | null> =>
	reminderManager.routeForNotification(data);
