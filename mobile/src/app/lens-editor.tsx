import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import LensEditor from "../components/settings/lens-editor";
import { useStore } from "../lib/store";

export default function LensEditorRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return <LensEditor key={store.account.id} />;
}
