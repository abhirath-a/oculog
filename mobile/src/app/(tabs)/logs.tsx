import { Redirect } from "expo-router";
import { SessionRestoring } from "../../components/auth/session-state";
import WearLogsScreen from "../../components/wear-history/logs-screen";
import { useStore } from "../../lib/store";

export default function LogsRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		<WearLogsScreen
			key={store.account.id}
			owner={store.account.id}
			insetMode="tabs"
		/>
	);
}
