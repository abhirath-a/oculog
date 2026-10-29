import { Redirect, useLocalSearchParams } from "expo-router";
import { SessionRestoring } from "../components/auth/session-state";
import LearningScreen from "../components/learning/learning-screen";
import { useStore } from "../lib/store";

export default function PracticeRoute() {
	const store = useStore();
	const params = useLocalSearchParams<{
		lesson?: string | string[];
		question?: string | string[];
	}>();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		<LearningScreen
			key={store.account.id}
			initialLessonID={
				typeof params.lesson === "string" ? params.lesson : undefined
			}
			initialQuestionID={
				typeof params.question === "string" ? params.question : undefined
			}
		/>
	);
}
