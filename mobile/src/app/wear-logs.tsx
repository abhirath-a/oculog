import { type Href, Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import { useStore } from "../lib/store";

/** Preserve old links while keeping reports in their canonical navigation tab. */
export default function WearLogsRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return <Redirect href={"/logs" as Href} />;
}
