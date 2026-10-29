import {
	type AdviceAnswer,
	type AdviceInput,
	type AdviceRequest,
	adviceAPI,
} from "./advice-api";
import {
	type EducationLanguage,
	type EducationOptions,
	type EducationSource,
	parseAdviceChatStatus,
	parseEducationConsent,
	parseEducationSource,
} from "./education-api";

export type ChatAnswer = {
	version: 3;
	mode:
		| "ai_answer"
		| "local_sources"
		| "safety"
		| "clarification"
		| "unavailable"
		| "off_domain";
	reason: string | null;
	language: EducationLanguage;
	title: string;
	paragraphs: { text: string; citations: string[] }[];
	sources: EducationSource[];
	provenance: {
		corpus_revision: string;
		retriever_revision: string;
		prompt_revision: string;
		model: string | null;
	};
	safety_level: "urgent" | "emergency" | null;
};
const invalid = () =>
	new Error(
		"The server returned unsupported Advice data. Please refresh and try again.",
	);
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown, max = 2000): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > max ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject unsafe server control characters.
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
	)
		throw invalid();
	return value;
}
function identifier(value: unknown) {
	const result = text(value, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(result)) throw invalid();
	return result;
}
function list<T>(
	value: unknown,
	max: number,
	parse: (value: unknown) => T,
): T[] {
	if (!Array.isArray(value) || value.length > max) throw invalid();
	return value.map(parse);
}
function unique<T>(values: T[], key: (value: T) => unknown = (value) => value) {
	if (new Set(values.map(key)).size !== values.length) throw invalid();
	return values;
}
export function parseChatAnswer(value: unknown): ChatAnswer {
	const d = object(value),
		p = object(d.provenance);
	if (
		d.version !== 3 ||
		![
			"ai_answer",
			"local_sources",
			"safety",
			"clarification",
			"unavailable",
			"off_domain",
		].includes(d.mode as string) ||
		!["en", "es"].includes(d.language as string)
	)
		throw invalid();
	const mode = d.mode as ChatAnswer["mode"];
	const sources = unique(
		list(d.sources, 12, parseEducationSource),
		(s) => s.id,
	);
	if (sources.some((s) => s.language !== d.language)) throw invalid();
	const ids = new Set(sources.map((s) => s.id));
	const paragraphs = list(d.paragraphs, 4, (value) => {
		const row = object(value);
		const citations = unique(list(row.citations, 12, identifier));
		if (citations.some((id) => !ids.has(id))) throw invalid();
		const body = text(row.text, mode === "ai_answer" ? 2000 : 16000);
		if (
			mode === "local_sources" &&
			(!citations.length ||
				citations.some(
					(id) => sources.find((s) => s.id === id)?.excerpt !== body,
				))
		)
			throw invalid();
		return { text: body, citations };
	});
	const model = p.model === null ? null : text(p.model, 128);
	const reason = d.reason === null ? null : text(d.reason, 128);
	if (
		(mode === "ai_answer" ? !model : model !== null) ||
		(mode === "safety"
			? !["urgent", "emergency"].includes(d.safety_level as string)
			: d.safety_level !== null) ||
		(mode !== "unavailable" && !paragraphs.length) ||
		(mode === "unavailable" && !reason) ||
		(mode === "local_sources" && !sources.length) ||
		(["safety", "clarification", "off_domain"].includes(mode) &&
			(sources.length || paragraphs.some((p) => p.citations.length))) ||
		(mode === "ai_answer" &&
			paragraphs.reduce((n, p) => n + p.text.length, 0) > 6000)
	)
		throw invalid();
	return {
		version: 3,
		mode,
		reason,
		language: d.language as EducationLanguage,
		title: text(d.title, 500),
		paragraphs,
		sources,
		provenance: {
			corpus_revision: identifier(p.corpus_revision),
			retriever_revision: identifier(p.retriever_revision),
			prompt_revision: identifier(p.prompt_revision),
			model,
		},
		safety_level: d.safety_level as ChatAnswer["safety_level"],
	};
}

export const providerReason = (reason: string | null | undefined) =>
	({
		missing_dedicated_key: "The server has no dedicated Gemini key configured.",
		operator_acknowledgment_required:
			"The server operator must enable Gemini and acknowledge paid processing and the adult audience.",
		price_acknowledgment_required:
			"The server operator must acknowledge the reviewed Gemini pricing.",
		pricing_stale:
			"The server's Gemini pricing review has expired. The operator must review the provider configuration.",
		usage_contract_invalid:
			"Gemini processing is paused because its usage response did not match the reviewed billing contract.",
		invalid_provider_configuration:
			"The server's Gemini configuration is invalid.",
		provider_unavailable:
			"Gemini could not be reached. Try again later; local sources are still available.",
		generation_rejected:
			"The AI reply did not pass the response checks. Local sources are shown instead when available.",
		provider_response_invalid:
			"Gemini returned an unsupported response. Local sources are shown instead when available.",
		local_retrieval_unavailable:
			"Local source search is unavailable. Please try again later.",
	})[reason ?? ""] ??
	"Gemini is currently unavailable. You can still use local public sources.";

/** Shared controller retains account/token/ticket and consent-withdrawal fences. */
export function chatAPI(request: AdviceRequest) {
	return {
		async status() {
			return parseAdviceChatStatus(
				await request<unknown>("/api/oculog/v3/advice"),
			);
		},
		async consent(
			disclosure_version: string,
			granted: boolean,
			adult_ack: boolean,
		) {
			return parseEducationConsent(
				await request<unknown>("/api/oculog/v3/advice/consent", {
					method: "PUT",
					body: { disclosure_version, granted, adult_ack },
				}),
			);
		},
	};
}
export function chatAdviceAPI(
	request: AdviceRequest,
	options: () => EducationOptions,
) {
	const fixed = adviceAPI(request);
	let catalogue: Awaited<ReturnType<typeof fixed.catalogue>> | null = null;
	async function loadCatalogue() {
		catalogue = await fixed.catalogue();
		return catalogue;
	}
	return {
		catalogue: loadCatalogue,
		async answer(input: AdviceInput): Promise<AdviceAnswer> {
			if (Object.keys(input).length !== 1) throw invalid();
			// A selected suggestion is itself the current question, never chat history.
			const query =
				"message" in input
					? input.message
					: "question_id" in input
						? (catalogue ?? (await loadCatalogue())).questions.find(
								(q) => q.id === input.question_id,
							)?.question
						: undefined;
			const message = text(query, 1000).trim();
			const settings = options();
			const answer = parseChatAnswer(
				await request<unknown>("/api/oculog/v3/advice/answer", {
					method: "POST",
					body: {
						message,
						language: settings.language,
						use_ai: settings.use_ai,
						...(settings.use_ai
							? { consent_epoch: settings.consent_epoch }
							: {}),
					},
				}),
			);
			if (
				answer.language !== settings.language ||
				(answer.mode === "ai_answer" && !settings.use_ai)
			)
				throw invalid();
			const cited = new Set(answer.paragraphs.flatMap((p) => p.citations));
			const fallback =
				answer.reason === "no_local_sources"
					? "No relevant local passages were found. Enable Gemini in AI settings after reviewing the consent disclosure, or rephrase your question."
					: providerReason(answer.reason);
			return {
				version: 1,
				id: null,
				title:
					answer.mode === "unavailable" ? "No answer available" : answer.title,
				paragraphs: [
					...(answer.mode === "local_sources" &&
					!["ai_not_requested", null].includes(answer.reason)
						? [providerReason(answer.reason)]
						: []),
					...(answer.paragraphs.length
						? answer.paragraphs.map((p) => p.text)
						: [fallback]),
				],
				urgency: answer.safety_level ?? "unknown",
				sources: answer.sources
					.filter((s) => cited.has(s.id))
					.map((s) => ({ title: s.title, url: s.url })),
				related_question_ids: [],
				matched: false,
			};
		},
	};
}
