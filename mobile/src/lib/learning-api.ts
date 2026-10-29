import type { AdviceRequest } from "./advice-api";

export type LearningReference = {
	chunk_id: string;
	content_sha256: string;
	url: string;
	quote: string;
};
export type LearningQuestion = {
	id: string;
	lesson_id: string;
	prompt: string;
	options: { id: string; text: string }[];
};
export type LearningProgress = {
	attempts: number;
	correct: number;
	last_correct: boolean;
	last_time: number;
	review_due: number;
};
export type LearningStatus = {
	version: 1;
	generation: number;
	policy_revision: string;
	source_bank_revision: string;
	corpus_revision: string;
	review_status: "source-grounded-not-clinician-validated";
	lessons: {
		id: string;
		title: string;
		text: string;
		reference: LearningReference;
		questions: LearningQuestion[];
	}[];
	progress: Record<string, LearningProgress>;
	recommended_question:
		| (LearningQuestion & {
				reason: "previous_mistake" | "unanswered" | "due_review";
		  })
		| null;
};
export type LearningAnswer = LearningStatus & {
	feedback: {
		question_id: string;
		selected_option_id: string;
		correct: boolean;
		explanation: string;
		reference: LearningReference;
	};
};
export type LearningSubmission = {
	generation: number;
	source_bank_revision: string;
	question_id: string;
	option_id: string;
	client_attempt_id: string;
};
const invalid = () =>
	new Error("Learning data could not be verified. Please retry later.");
function obj(v: unknown): Record<string, unknown> {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid();
	return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, names: string[]) {
	if (Object.keys(v).sort().join("|") !== [...names].sort().join("|"))
		throw invalid();
}
function text(v: unknown, max = 2000): string {
	if (
		typeof v !== "string" ||
		!v.trim() ||
		v.length > max ||
		/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v)
	)
		throw invalid();
	return v;
}
function id(v: unknown) {
	const s = text(v, 128);
	if (!/^[a-zA-Z0-9_.:-]+$/.test(s)) throw invalid();
	return s;
}
function integer(v: unknown) {
	if (!Number.isSafeInteger(v) || (v as number) < 0) throw invalid();
	return v as number;
}
function bool(v: unknown) {
	if (typeof v !== "boolean") throw invalid();
	return v;
}
function list<T>(v: unknown, max: number, parse: (v: unknown) => T): T[] {
	if (!Array.isArray(v) || v.length > max) throw invalid();
	return v.map(parse);
}
function unique(v: { id: string }[]) {
	if (new Set(v.map((x) => x.id)).size !== v.length) throw invalid();
}
export function safeLearningURL(v: unknown): v is string {
	if (typeof v !== "string") return false;
	try {
		const u = new URL(v);
		return (
			u.protocol === "https:" &&
			!u.username &&
			!u.password &&
			!u.port &&
			!u.hash &&
			["www.cdc.gov", "www.fda.gov", "www.nei.nih.gov"].includes(u.hostname)
		);
	} catch {
		return false;
	}
}
function reference(v: unknown): LearningReference {
	const r = obj(v);
	keys(r, ["chunk_id", "content_sha256", "url", "quote"]);
	if (
		!safeLearningURL(r.url) ||
		!/^[a-f0-9]{64}$/.test(text(r.content_sha256, 64))
	)
		throw invalid();
	return {
		chunk_id: id(r.chunk_id),
		content_sha256: r.content_sha256 as string,
		url: r.url,
		quote: text(r.quote),
	};
}
function question(v: unknown): LearningQuestion {
	const q = obj(v);
	keys(q, ["id", "lesson_id", "prompt", "options"]);
	const options = list(q.options, 5, (v) => {
		const o = obj(v);
		keys(o, ["id", "text"]);
		return { id: id(o.id), text: text(o.text, 500) };
	});
	if (options.length < 2) throw invalid();
	unique(options);
	return {
		id: id(q.id),
		lesson_id: id(q.lesson_id),
		prompt: text(q.prompt),
		options,
	};
}
export function parseLearningStatus(
	value: unknown,
	withFeedback = false,
): LearningStatus {
	const s = obj(value);
	keys(s, [
		"version",
		"generation",
		"policy_revision",
		"source_bank_revision",
		"corpus_revision",
		"review_status",
		"lessons",
		"progress",
		"recommended_question",
		...(withFeedback ? ["feedback"] : []),
	]);
	if (
		s.version !== 1 ||
		s.review_status !== "source-grounded-not-clinician-validated"
	)
		throw invalid();
	const lessons = list(s.lessons, 8, (v) => {
		const l = obj(v);
		keys(l, ["id", "title", "text", "reference", "questions"]);
		const questions = list(l.questions, 12, question);
		unique(questions);
		const result = {
			id: id(l.id),
			title: text(l.title),
			text: text(l.text),
			reference: reference(l.reference),
			questions,
		};
		if (!questions.length || questions.some((q) => q.lesson_id !== result.id))
			throw invalid();
		return result;
	});
	if (!lessons.length) throw invalid();
	unique(lessons);
	const questions = lessons.flatMap((l) => l.questions);
	unique(questions);
	const progress: Record<string, LearningProgress> = {};
	const p = obj(s.progress);
	for (const [key, value] of Object.entries(p)) {
		if (!questions.some((q) => q.id === key)) throw invalid();
		const row = obj(value);
		keys(row, [
			"attempts",
			"correct",
			"last_correct",
			"last_time",
			"review_due",
		]);
		const entry = {
			attempts: integer(row.attempts),
			correct: integer(row.correct),
			last_correct: bool(row.last_correct),
			last_time: integer(row.last_time),
			review_due: integer(row.review_due),
		};
		if (
			entry.attempts < 1 ||
			entry.correct > entry.attempts ||
			(entry.last_correct && !entry.correct) ||
			entry.review_due < entry.last_time
		)
			throw invalid();
		progress[key] = entry;
	}
	let recommended_question: LearningStatus["recommended_question"] = null;
	if (s.recommended_question !== null) {
		const r = obj(s.recommended_question),
			{ reason, ...q } = r;
		if (
			reason !== "previous_mistake" &&
			reason !== "unanswered" &&
			reason !== "due_review"
		)
			throw invalid();
		const parsed = question(q);
		if (!questions.some((q) => JSON.stringify(q) === JSON.stringify(parsed)))
			throw invalid();
		recommended_question = { ...parsed, reason };
	}
	return {
		version: 1,
		generation: integer(s.generation),
		policy_revision: id(s.policy_revision),
		source_bank_revision: id(s.source_bank_revision),
		corpus_revision: id(s.corpus_revision),
		review_status: s.review_status,
		lessons,
		progress,
		recommended_question,
	};
}
export function parseLearningAnswer(value: unknown): LearningAnswer {
	const status = parseLearningStatus(value, true),
		f = obj(obj(value).feedback);
	keys(f, [
		"question_id",
		"selected_option_id",
		"correct",
		"explanation",
		"reference",
	]);
	const feedback = {
		question_id: id(f.question_id),
		selected_option_id: id(f.selected_option_id),
		correct: bool(f.correct),
		explanation: text(f.explanation),
		reference: reference(f.reference),
	};
	const lesson = status.lessons.find((l) =>
		l.questions.some(
			(q) =>
				q.id === feedback.question_id &&
				q.options.some((o) => o.id === feedback.selected_option_id),
		),
	);
	if (
		!lesson ||
		JSON.stringify(lesson.reference) !== JSON.stringify(feedback.reference) ||
		status.progress[feedback.question_id]?.last_correct !== feedback.correct
	)
		throw invalid();
	return { ...status, feedback };
}
export function learningAPI(request: AdviceRequest) {
	const root = "/api/oculog/v2/learning";
	return {
		async status() {
			return parseLearningStatus(await request<unknown>(root));
		},
		async answer(body: LearningSubmission) {
			const result = parseLearningAnswer(
				await request<unknown>(`${root}/answer`, { method: "POST", body }),
			);
			if (
				result.generation !== body.generation ||
				result.source_bank_revision !== body.source_bank_revision ||
				result.feedback.question_id !== body.question_id ||
				result.feedback.selected_option_id !== body.option_id
			)
				throw invalid();
			return result;
		},
		async reset(generation: number) {
			const result = parseLearningStatus(
				await request<unknown>(`${root}/reset`, {
					method: "POST",
					body: { generation },
				}),
			);
			if (
				result.generation !== generation + 1 ||
				Object.keys(result.progress).length
			)
				throw invalid();
			return result;
		},
	};
}
