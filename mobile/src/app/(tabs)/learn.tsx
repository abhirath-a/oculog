import { Redirect, useRouter } from "expo-router";
import { SessionRestoring } from "../../components/auth/session-state";
import HubScreen from "../../components/learning/hub-screen";
import { useStore } from "../../lib/store";

export default function LearnRoute() {
	const store = useStore();
	const router = useRouter();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		<HubScreen
			key={store.account.id}
			onPractice={(lesson, question) =>
				router.push({
					pathname: "/practice",
					params: { lesson, ...(question ? { question } : {}) },
				})
			}
			onBrowse={() => router.push("/practice")}
			onProducts={() => router.push("/products")}
		/>
	);
}
