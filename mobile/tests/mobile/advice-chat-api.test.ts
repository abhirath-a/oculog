import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdviceRequest } from "../../src/lib/advice-api";
import {
	chatAdviceAPI,
	chatAPI,
	parseChatAnswer,
	providerReason,
} from "../../src/lib/advice-chat-api";
import {
	parseEducationAnswer,
	parseEducationStatus,
} from "../../src/lib/education-api";

const source = {
	id: "chunk-1",
	document_id: "doc-1",
	title: "CDC lens care",
	url: "https://www.cdc.gov/contact-lenses/",
	authority: "CDC",
	language: "en",
	excerpt: "Public source passage.",
	content_sha256: "a".repeat(64),
	fetched_at: "2026-10-23T00:00:00Z",
	source_modified_at: null,
};
const answer = () => ({
	version: 3,
	mode: "ai_answer",
	reason: null,
	language: "en",
	title: "AI reply",
	paragraphs: [
		{
			text: "A general explanation, not a verbatim source excerpt.",
			citations: [source.id],
		},
	],
	sources: [source],
	safety_level: null,
	provenance: {
		corpus_revision: "corpus-v1",
		retriever_revision: "retrieval-v3",
		prompt_revision: "chat-v3",
		model: "test-model",
	},
});
const status = () => ({
	version: 3,
	corpus: { revision: "corpus-v1", document_count: 1, chunk_count: 1 },
	provider: { name: "Gemini", configured: true, available: true, reason: null },
	languages: ["en", "es"],
	disclosure: {
		version: "current-question-v3",
		text: "Current question only after fresh consent.",
		terms_url: "https://ai.google.dev/gemini-api/terms",
	},
	consent: { granted: false, adult_ack: false, epoch: 2 },
	budget: { monthly_limit_usd: null, available: true },
});

test("V3 AI explanations are accepted without weakening the V2 verbatim contract", () => {
	assert.equal(parseChatAnswer(answer()).mode, "ai_answer");
	assert.throws(() =>
		parseEducationAnswer({ ...answer(), version: 2, mode: "generated" }),
	);
	assert.throws(() => parseEducationStatus(status()));
});

test("V3 rejects unknown citations, unsafe sources, invalid provenance and false safety modes", () => {
	for (const mutate of [
		(v: ReturnType<typeof answer>) => {
			v.paragraphs[0]!.citations = ["invented"];
		},
		(v: ReturnType<typeof answer>) => {
			v.sources[0] = { ...source, url: "https://cdc.gov.attacker.test/" };
		},
		(v: ReturnType<typeof answer>) => {
			v.provenance.model = "";
		},
		(v: ReturnType<typeof answer>) => {
			v.mode = "safety";
		},
		(v: ReturnType<typeof answer>) => {
			v.version = 2;
		},
	]) {
		const value = structuredClone(answer());
		mutate(value);
		assert.throws(() => parseChatAnswer(value));
	}
});

test("uncited general AI explanation is allowed but local source excerpts must be exact", () => {
	const value = answer();
	value.paragraphs[0]!.citations = [];
	assert.equal(parseChatAnswer(value).paragraphs.length, 1);
	const local = {
		...answer(),
		mode: "local_sources",
		provenance: { ...answer().provenance, model: null },
	};
	assert.throws(() => parseChatAnswer(local));
	local.paragraphs[0]!.text = source.excerpt;
	assert.equal(parseChatAnswer(local).mode, "local_sources");
});

test("active adapter sends only the current question to V3, never local history or records", async () => {
	const calls: {
		path: string;
		options: Record<string, unknown> | undefined;
	}[] = [];
	const request: AdviceRequest = async <T>(
		path: string,
		options?: Record<string, unknown>,
	) => {
		calls.push({ path, options });
		return answer() as T;
	};
	const api = chatAdviceAPI(request, () => ({
		language: "en",
		use_ai: true,
		consent_epoch: 3,
	}));
	const reply = await api.answer({
		message: "How do silicone hydrogel contacts differ?",
	});
	assert.equal(reply.title, "AI reply");
	assert.equal(reply.education, undefined);
	assert.equal(calls[0]?.path, "/api/oculog/v3/advice/answer");
	assert.deepEqual(calls[0]?.options?.body, {
		message: "How do silicone hydrogel contacts differ?",
		language: "en",
		use_ai: true,
		consent_epoch: 3,
	});
});

test("suggestion selection sends its visible question, not an obsolete topic ID", async () => {
	const bodies: unknown[] = [];
	const request: AdviceRequest = async <T>(
		path: string,
		options?: Record<string, unknown>,
	) => {
		if (path.endsWith("/advice"))
			return {
				version: 1,
				disclaimer: "Education only",
				safety_notice: "Seek care for urgent symptoms",
				questions: [
					{ id: "cleaning", question: "How do I clean contact lenses?" },
				],
			} as T;
		bodies.push(options?.body);
		return answer() as T;
	};
	const api = chatAdviceAPI(request, () => ({
		language: "en",
		use_ai: true,
		consent_epoch: 3,
	}));
	await api.catalogue();
	await api.answer({ question_id: "cleaning" });
	assert.deepEqual(bodies, [
		{
			message: "How do I clean contact lenses?",
			language: "en",
			use_ai: true,
			consent_epoch: 3,
		},
	]);
});

test("AI is not accepted if not requested; invalid inputs cannot append history fields", async () => {
	const request: AdviceRequest = async <T>() => answer() as T;
	const api = chatAdviceAPI(request, () => ({ language: "en", use_ai: false }));
	await assert.rejects(api.answer({ message: "How do contacts work?" }));
	await assert.rejects(
		api.answer({
			message: "How do contacts work?",
			history: ["private"],
		} as never),
	);
});

test("V3 status and renewed consent use the new endpoint/revision and no topic whitelist", async () => {
	const calls: unknown[] = [];
	const request: AdviceRequest = async <T>(
		path: string,
		options?: Record<string, unknown>,
	) => {
		calls.push([path, options?.body]);
		return (
			options ? { granted: true, adult_ack: true, epoch: 3 } : status()
		) as T;
	};
	const api = chatAPI(request);
	const value = await api.status();
	assert.equal(value.version, 3);
	assert.deepEqual(value.topics, []);
	await api.consent(value.disclosure.version, true, true);
	assert.deepEqual(calls[1], [
		"/api/oculog/v3/advice/consent",
		{
			disclosure_version: "current-question-v3",
			granted: true,
			adult_ack: true,
		},
	]);
	assert.match(providerReason("missing_dedicated_key"), /key/);
	assert.match(providerReason("pricing_stale"), /expired/);
});
