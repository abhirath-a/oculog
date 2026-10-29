import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import NotificationSettingsScreen from "../components/reminders/notification-settings-screen";
import { useStore } from "../lib/store";

export default function NotificationSettingsRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return <NotificationSettingsScreen key={store.account.id} />;
}
