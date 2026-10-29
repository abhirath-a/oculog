import type { LearningStatus } from "../../lib/learning-api";

export const recommendationReasons = {
	previous_mistake: "Review a previous mistake",
	unanswered: "Try an unanswered question",
	due_review: "A practice review is due",
};
export function initialPracticeSelection(
	status: LearningStatus,
	lessonID?: string,
	questionID?: string,
) {
	const lesson = status.lessons.find((item) => item.id === lessonID);
	return {
		lesson: lesson ?? null,
		question: lesson?.questions.find((item) => item.id === questionID) ?? null,
	};
}
export function hubSelection(
	status: LearningStatus,
	selectedID: string | null,
) {
	return (
		status.lessons.find((lesson) => lesson.id === selectedID) ??
		status.lessons.find(
			(lesson) => lesson.id === status.recommended_question?.lesson_id,
		) ??
		status.lessons[0]
	);
}
export function topicRows<T>(lessons: T[]): T[][] {
	return Array.from({ length: Math.ceil(lessons.length / 2) }, (_, row) =>
		lessons.slice(row * 2, row * 2 + 2),
	);
}
export function lifetimeSummary(status: LearningStatus) {
	const progress = Object.values(status.progress);
	return `Lifetime saved practice · ${progress.length} of ${status.lessons.reduce((total, lesson) => total + lesson.questions.length, 0)} questions tried · ${progress.reduce((total, item) => total + item.correct, 0)} correct answers of ${progress.reduce((total, item) => total + item.attempts, 0)} attempts`;
}
