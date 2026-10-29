import {
	type AdviceAnswer,
	type AdviceInput,
	type AdviceRequest,
	adviceAPI,
	isSafeAdviceURL,
} from "./advice-api";

export type EducationLanguage = "en" | "es";
export type EducationSource = {
	id: string;
	document_id: string;
	title: string;
	url: string;
	authority: "CDC" | "FDA" | "NEI";
	language: EducationLanguage;
	excerpt: string;
	content_sha256: string;
	fetched_at: string;
	source_modified_at: string | null;
};
export type EducationAnswer = {
	version: 2;
	mode: "local_retrieval" | "generated" | "abstained" | "safety";
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
export type EducationStatus = {
	/** Shared settings view model; each wire parser enforces its own revision. */
	version: 2 | 3;
	corpus: { revision: string; document_count: number; chunk_count: number };
	provider: {
		name: "Gemini";
		configured: boolean;
		available: boolean;
		reason: string | null;
	};
	languages: EducationLanguage[];
	topics: { id: string; title: string; question: string }[];
	disclosure: { version: string; text: string; terms_url: string };
	consent: { granted: boolean; adult_ack: boolean; epoch: number };
	budget: { monthly_limit_usd: null; available: boolean };
};
const invalid = () =>
	new Error(
		"The server returned unsupported education data. Please try again later.",
	);
function obj(v: unknown): Record<string, unknown> {
	if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid();
	return v as Record<string, unknown>;
}
function str(v: unknown, max = 4000): string {
	if (
		typeof v !== "string" ||
		!v.trim() ||
		v.length > max ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: Server text must not contain control characters.
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
	)
		throw invalid();
	return v;
}
function identifier(v: unknown) {
	const s = str(v, 128);
	if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s)) throw invalid();
	return s;
}
function language(v: unknown): EducationLanguage {
	if (v !== "en" && v !== "es") throw invalid();
	return v;
}
function bool(v: unknown) {
	if (typeof v !== "boolean") throw invalid();
	return v;
}
function integer(v: unknown) {
	if (!Number.isSafeInteger(v) || (v as number) < 0) throw invalid();
	return v as number;
}
function nullable(v: unknown, max = 1000) {
	return v === null ? null : str(v, max);
}
function array<T>(v: unknown, max: number, parse: (v: unknown) => T): T[] {
	if (!Array.isArray(v) || v.length > max) throw invalid();
	return v.map(parse);
}
function unique<T>(values: T[], key: (v: T) => unknown = (v) => v) {
	if (new Set(values.map(key)).size !== values.length) throw invalid();
	return values;
}
function date(v: unknown) {
	const s = str(v, 80);
	if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) || !Number.isFinite(Date.parse(s)))
		throw invalid();
	return s;
}
export function parseEducationConsent(v: unknown): EducationStatus["consent"] {
	const c = obj(v);
	const result = {
		granted: bool(c.granted),
		adult_ack: bool(c.adult_ack),
		epoch: integer(c.epoch),
	};
	if (result.granted && !result.adult_ack) throw invalid();
	return result;
}
export function parseEducationStatus(v: unknown): EducationStatus {
	return parseStatus(v, 2);
}
export function parseAdviceChatStatus(v: unknown): EducationStatus {
	return parseStatus(v, 3);
}
function parseStatus(v: unknown, version: 2 | 3): EducationStatus {
	const d = obj(v),
		c = obj(d.corpus),
		p = obj(d.provider),
		disclosure = obj(d.disclosure),
		b = obj(d.budget);
	if (
		d.version !== version ||
		p.name !== "Gemini" ||
		b.monthly_limit_usd !== null ||
		!isSafeAdviceURL(disclosure.terms_url)
	)
		throw invalid();
	const terms = new URL(disclosure.terms_url);
	if (
		terms.hostname !== "ai.google.dev" ||
		terms.pathname !== "/gemini-api/terms" ||
		terms.port
	)
		throw invalid();
	const languages = unique(array(d.languages, 2, language));
	if (!languages.length) throw invalid();
	const provider = {
		name: "Gemini" as const,
		configured: bool(p.configured),
		available: bool(p.available),
		reason: nullable(p.reason),
	};
	const budget: EducationStatus["budget"] = {
		monthly_limit_usd: null,
		available: bool(b.available),
	};
	if (provider.available && (!provider.configured || !budget.available))
		throw invalid();
	return {
		version,
		corpus: {
			revision: identifier(c.revision),
			document_count: integer(c.document_count),
			chunk_count: integer(c.chunk_count),
		},
		provider,
		languages,
		topics: unique(
			array(version === 3 ? [] : d.topics, 100, (v) => {
				const t = obj(v);
				return {
					id: identifier(t.id),
					title: str(t.title, 500),
					question: str(t.question, 1000),
				};
			}),
			(t) => t.id,
		),
		disclosure: {
			version: identifier(disclosure.version),
			text: str(disclosure.text, 8000),
			terms_url: disclosure.terms_url,
		},
		consent: parseEducationConsent(d.consent),
		budget,
	};
}
export function parseEducationSource(v: unknown): EducationSource {
	const s = obj(v);
	if (!isSafeAdviceURL(s.url)) throw invalid();
	const url = new URL(s.url);
	const hosts: Record<string, string[]> = {
		CDC: ["cdc.gov", "www.cdc.gov"],
		FDA: ["fda.gov", "www.fda.gov"],
		NEI: ["nei.nih.gov", "www.nei.nih.gov"],
	};
	const authority = str(s.authority, 3) as EducationSource["authority"];
	if (
		!hosts[authority]?.includes(url.hostname) ||
		url.port ||
		!/^[a-f0-9]{64}$/.test(str(s.content_sha256, 64))
	)
		throw invalid();
	return {
		id: identifier(s.id),
		document_id: identifier(s.document_id),
		title: str(s.title, 500),
		url: s.url,
		authority,
		language: language(s.language),
		excerpt: str(s.excerpt, 16000),
		content_sha256: s.content_sha256 as string,
		fetched_at: date(s.fetched_at),
		source_modified_at:
			s.source_modified_at === null ? null : date(s.source_modified_at),
	};
}
export function parseEducationAnswer(v: unknown): EducationAnswer {
	const d = obj(v),
		p = obj(d.provenance);
	if (
		d.version !== 2 ||
		!["local_retrieval", "generated", "abstained", "safety"].includes(
			d.mode as string,
		)
	)
		throw invalid();
	const mode = d.mode as EducationAnswer["mode"];
	if (mode === "safety" && d.language !== "en") throw invalid();
	const sources = unique(
		array(d.sources, 12, parseEducationSource),
		(s) => s.id,
	);
	if (sources.some((source) => source.language !== d.language)) throw invalid();
	const ids = new Set(sources.map((s) => s.id));
	const paragraphs = array(d.paragraphs, 20, (v) => {
		const row = obj(v),
			citations = unique(array(row.citations, 12, identifier));
		if (
			citations.some((id) => !ids.has(id)) ||
			((mode === "generated" || mode === "local_retrieval") &&
				!citations.length)
		)
			throw invalid();
		return { text: str(row.text, 16000), citations };
	});
	if (
		(mode !== "abstained" && !paragraphs.length) ||
		((mode === "local_retrieval" || mode === "generated") && !sources.length)
	)
		throw invalid();
	if (
		mode === "safety"
			? d.safety_level !== "urgent" && d.safety_level !== "emergency"
			: d.safety_level !== null
	)
		throw invalid();
	const model = nullable(p.model, 128);
	if (mode === "generated" ? !model : model !== null) throw invalid();
	if ((mode === "abstained" || mode === "safety") && sources.length)
		throw invalid();
	if (mode === "abstained" && (paragraphs.length || d.reason === null))
		throw invalid();
	if (
		(mode === "local_retrieval" || mode === "generated") &&
		paragraphs.some((p) =>
			p.citations.some(
				(id) => sources.find((s) => s.id === id)?.excerpt !== p.text,
			),
		)
	)
		throw invalid();
	return {
		version: 2,
		mode,
		reason: nullable(d.reason),
		language: language(d.language),
		title: str(d.title, 500),
		paragraphs,
		sources,
		provenance: {
			corpus_revision: identifier(p.corpus_revision),
			retriever_revision: identifier(p.retriever_revision),
			prompt_revision: identifier(p.prompt_revision),
			model,
		},
		safety_level: d.safety_level as EducationAnswer["safety_level"],
	};
}
export type EducationOptions = {
	language: EducationLanguage;
	use_ai: boolean;
	consent_epoch?: number;
};
/** V1 supplies immutable safety/quick IDs only; every active answer uses V2. */
export function educationAdviceAPI(
	request: AdviceRequest,
	options: () => EducationOptions,
) {
	return {
		catalogue: adviceAPI(request).catalogue,
		async answer(input: AdviceInput): Promise<AdviceAnswer> {
			const data = obj(input),
				keys = Object.keys(data);
			if (
				keys.length !== 1 ||
				!["message", "question_id", "topic_id"].includes(keys[0] ?? "")
			)
				throw invalid();
			const query =
				"message" in data
					? { message: str(data.message, 1000).trim() }
					: "topic_id" in data
						? { topic_id: identifier(data.topic_id) }
						: { question_id: identifier(data.question_id) };
			const settings = options();
			const result = parseEducationAnswer(
				await request<unknown>("/api/oculog/v2/education/answer", {
					method: "POST",
					body: { ...query, ...settings },
				}),
			);
			if (
				(result.mode === "generated" && !settings.use_ai) ||
				(result.mode !== "safety" && result.language !== settings.language)
			)
				throw invalid();
			return {
				version: 1,
				id: null,
				title: result.title,
				paragraphs: result.paragraphs.map((p) => p.text),
				urgency: result.safety_level ?? "unknown",
				sources: result.sources.map((s) => ({ title: s.title, url: s.url })),
				related_question_ids: [],
				matched: false,
				education: result,
			};
		},
	};
}
export function educationAPI(request: AdviceRequest) {
	return {
		async status() {
			return parseEducationStatus(
				await request<unknown>("/api/oculog/v2/education"),
			);
		},
		async consent(
			disclosure_version: string,
			granted: boolean,
			adult_ack: boolean,
		) {
			return parseEducationConsent(
				await request<unknown>("/api/oculog/v2/education/consent", {
					method: "PUT",
					body: { disclosure_version, granted, adult_ack },
				}),
			);
		},
	};
}
