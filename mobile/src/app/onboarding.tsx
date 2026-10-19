import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import Onboarding from "../components/onboarding";
import { useStore } from "../lib/store";

/** Registration offers setup; returning sessions still enter through Today. */
export default function OnboardingRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return <Onboarding key={store.account.id} />;
}
