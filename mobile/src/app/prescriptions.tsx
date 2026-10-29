import { Redirect } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import PrescriptionScreen from "../components/prescriptions/prescription-screen";
import { useStore } from "../lib/store";

export default function PrescriptionRoute() {
	const store = useStore();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return <PrescriptionScreen key={store.account.id} owner={store.account.id} />;
}
