import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import WearAutomationScreen from "../components/wear-history/automation-screen";
import { useStore } from "../lib/store";

export default function WearAutomationRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		<WearAutomationScreen key={store.account.id} owner={store.account.id} />
	);
}
