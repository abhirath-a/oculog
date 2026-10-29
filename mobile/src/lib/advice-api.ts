import type { EducationAnswer } from "./education-api";

export type AdvicePresentation = {
	summary: string;
	lens_action: string;
	triage: { level: "emergency" | "urgent"; title: string; text: string }[];
	caution: string;
	topics: { id: string; label: string }[];
};
export type AdviceCatalogue = {
	version: 1;
	disclaimer: string;
	safety_notice: string;
	presentation?: AdvicePresentation;
	questions: { id: string; question: string }[];
};
export type AdviceAnswer = {
	/** Present only after strict V2 runtime validation. */
	education?: EducationAnswer;
	version: 1;
	id: string | null;
	title: string;
	paragraphs: string[];
	urgency: "routine" | "urgent" | "emergency" | "unknown";
	sources: { title: string; url: string }[];
	related_question_ids: string[];
	matched: boolean;
};
export type AdviceInput =
	| { question_id: string }
	| { message: string }
	| { topic_id: string };
export type AdviceRequest = <T>(
	path: string,
	options?: Record<string, unknown>,
) => Promise<T>;
const invalid = () =>
	new Error(
		"The server returned unsupported advice data. Please try again later.",
	);
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > max ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject control characters in untrusted server text.
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
	)
		throw invalid();
	return value;
}
function list<T>(
	value: unknown,
	max: number,
	parse: (item: unknown) => T,
): T[] {
	if (!Array.isArray(value) || value.length > max) throw invalid();
	return value.map(parse);
}
function id(value: unknown) {
	return text(value, 128);
}
export function isSafeAdviceURL(value: unknown): value is string {
	if (
		typeof value !== "string" ||
		value.length > 2048 ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls before parsing an external URL.
		/[\s\\\u0000-\u001f\u007f]/.test(value)
	)
		return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!!url.hostname &&
			!url.username &&
			!url.password
		);
	} catch {
		return false;
	}
}
function parsePresentation(
	value: unknown,
	questionIds: Set<string>,
): AdvicePresentation {
	const data = object(value);
	const triage = list<AdvicePresentation["triage"][number]>(
		data.triage,
		2,
		(item) => {
			const row = object(item);
			if (row.level !== "emergency" && row.level !== "urgent") throw invalid();
			return {
				level: row.level,
				title: text(row.title, 80),
				text: text(row.text, 1000),
			};
		},
	);
	if (triage.length !== 2 || new Set(triage.map((row) => row.level)).size !== 2)
		throw invalid();
	const topics = list(data.topics, 4, (item) => {
		const topic = object(item);
		const topicId = id(topic.id);
		if (!questionIds.has(topicId)) throw invalid();
		return { id: topicId, label: text(topic.label, 80) };
	});
	if (
		!topics.length ||
		new Set(topics.map((topic) => topic.id)).size !== topics.length
	)
		throw invalid();
	return {
		summary: text(data.summary, 500),
		lens_action: text(data.lens_action, 500),
		triage,
		caution: text(data.caution, 500),
		topics,
	};
}
export function parseAdviceCatalogue(value: unknown): AdviceCatalogue {
	const data = object(value);
	if (data.version !== 1) throw invalid();
	const questions = list(data.questions, 100, (item) => {
		const question = object(item);
		return { id: id(question.id), question: text(question.question, 500) };
	});
	if (new Set(questions.map((q) => q.id)).size !== questions.length)
		throw invalid();
	return {
		version: 1,
		disclaimer: text(data.disclaimer, 4000),
		safety_notice: text(data.safety_notice, 4000),
		questions,
		...(data.presentation === undefined
			? {}
			: {
					presentation: parsePresentation(
						data.presentation,
						new Set(questions.map((q) => q.id)),
					),
				}),
	};
}
export function parseAdviceAnswer(value: unknown): AdviceAnswer {
	const data = object(value);
	if (
		data.version !== 1 ||
		typeof data.matched !== "boolean" ||
		!["routine", "urgent", "emergency", "unknown"].includes(
			data.urgency as string,
		)
	)
		throw invalid();
	const answerId = data.id === null ? null : id(data.id);
	if (
		data.matched
			? answerId === null || data.urgency === "unknown"
			: answerId !== null || data.urgency !== "unknown"
	)
		throw invalid();
	const paragraphs = list(data.paragraphs, 20, (item) => text(item, 4000));
	if (!paragraphs.length) throw invalid();
	return {
		version: 1,
		id: answerId,
		title: text(data.title, 500),
		paragraphs,
		urgency: data.urgency as AdviceAnswer["urgency"],
		matched: data.matched,
		sources: list(data.sources, 12, (item) => {
			const source = object(item);
			if (!isSafeAdviceURL(source.url)) throw invalid();
			return { title: text(source.title, 500), url: source.url };
		}),
		related_question_ids: list(data.related_question_ids, 20, id),
	};
}
export function adviceAPI(request: AdviceRequest) {
	return {
		async catalogue() {
			return parseAdviceCatalogue(
				await request<unknown>("/api/oculog/v1/advice"),
			);
		},
		async answer(input: AdviceInput) {
			const data = object(input);
			const keys = Object.keys(data);
			if (
				keys.length !== 1 ||
				(keys[0] !== "question_id" && keys[0] !== "message")
			)
				throw new Error("Send one question or message.");
			const body =
				"message" in data
					? { message: text(data.message, 1000).trim() }
					: { question_id: id(data.question_id) };
			return parseAdviceAnswer(
				await request<unknown>("/api/oculog/v1/advice/answer", {
					method: "POST",
					body,
				}),
			);
		},
	};
}
