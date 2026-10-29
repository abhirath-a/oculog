import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import WearHistoryScreen from "../components/wear-history/history-screen";
import { useStore } from "../lib/store";

export default function WearHistoryRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return <WearHistoryScreen key={store.account.id} owner={store.account.id} />;
}
