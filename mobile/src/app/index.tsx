import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import { useStore } from "../lib/store";
export default function Index() {
	const store = useStore();
	if (!store.ready) {
		return <SessionRestoring />;
	}
	if (!store.account) return <Redirect href="/auth" />;
	return <Redirect href="/(tabs)/home" />;
}
