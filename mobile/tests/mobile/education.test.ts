// biome-ignore-all lint/suspicious/noExplicitAny: Controller/DOM harness models native-tree presentation without evaluating platform SDK modules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import type { AdviceRequest } from "../../src/lib/advice-api";
import { createAdviceController } from "../../src/lib/advice-controller";
import {
	type EducationAnswer,
	type EducationStatus,
	educationAdviceAPI,
	educationAPI,
	parseEducationAnswer,
	parseEducationStatus,
} from "../../src/lib/education-api";
import { createEducationController } from "../../src/lib/education-controller";

const source = {
	id: "cdc-care.chunk-1",
	document_id: "cdc-care",
	title: "Care",
	url: "https://www.cdc.gov/contact-lenses/about/index.html",
	authority: "CDC" as const,
	language: "en" as const,
	excerpt: "Public source passage.",
	content_sha256: "a".repeat(64),
	fetched_at: "2026-10-23T00:00:00Z",
	source_modified_at: null,
};
const answer: EducationAnswer = {
	version: 2,
	mode: "local_retrieval",
	reason: "ai_not_requested",
	language: "en",
	title: "Care",
	paragraphs: [{ text: source.excerpt, citations: [source.id] }],
	sources: [source],
	provenance: {
		corpus_revision: "rev-1",
		retriever_revision: "fts5-v1",
		prompt_revision: "reviewed-v1",
		model: null,
	},
	safety_level: null,
};
const status: EducationStatus = {
	version: 2,
	corpus: { revision: "rev-1", document_count: 1, chunk_count: 1 },
	provider: { name: "Gemini", configured: true, available: true, reason: null },
	languages: ["en", "es"],
	topics: [{ id: "care", title: "Care", question: "General care?" }],
	disclosure: {
		version: "adult-v1",
		text: "Adults only. Public passages only.",
		terms_url: "https://ai.google.dev/gemini-api/terms",
	},
	consent: { granted: false, adult_ack: false, epoch: 0 },
	budget: { monthly_limit_usd: null, available: true },
};
const catalogue = {
	version: 1,
	disclaimer: "General education",
	safety_notice: "Fixed urgent safety",
	questions: [{ id: "care", question: "General care?" }],
};
function deferred<T>() {
	let resolve!: (v: T) => void, reject!: (e: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function harness(identity: string | null = "account:token1") {
	const calls: {
		path: string;
		options?: Record<string, unknown>;
		result: ReturnType<typeof deferred<unknown>>;
	}[] = [];
	const request: AdviceRequest = <T>(
		path: string,
		options?: Record<string, unknown>,
	) => {
		const result = deferred<unknown>();
		calls.push({ path, options, result });
		return result.promise as Promise<T>;
	};
	const education = createEducationController(
		educationAPI(request),
		() => identity,
		(notice) => chat.clear(notice),
	);
	const chat = createAdviceController(
		educationAdviceAPI(request, education.options),
		() => identity,
	);
	return {
		calls,
		education,
		chat,
		setIdentity(next: string | null) {
			identity = next;
		},
		async load(value = status) {
			const pending = education.load();
			calls.at(-1)?.result.resolve(value);
			await pending;
		},
		async grant(epoch = 1) {
			education.setAdultAck(true);
			education.setExternalConsent(true);
			const pending = education.grant();
			calls.at(-1)?.result.resolve({ granted: true, adult_ack: true, epoch });
			await pending;
		},
	};
}

test("strict V2 parser accepts source excerpts, AI-selected excerpts, abstention and independent English safety", () => {
	assert.deepEqual(parseEducationAnswer(answer), answer);
	assert.equal(
		parseEducationAnswer({
			...answer,
			mode: "generated",
			reason: null,
			provenance: { ...answer.provenance, model: "gemini-reviewed" },
		}).mode,
		"generated",
	);
	assert.equal(
		parseEducationAnswer({
			...answer,
			mode: "abstained",
			paragraphs: [],
			sources: [],
		}).mode,
		"abstained",
	);
	assert.equal(
		parseEducationAnswer({
			...answer,
			mode: "safety",
			paragraphs: [{ text: "Fixed safety", citations: [] }],
			sources: [],
			safety_level: "urgent",
		}).safety_level,
		"urgent",
	);
	for (const language of ["en", "es"] as const)
		assert.equal(
			parseEducationAnswer({
				...answer,
				language,
				sources: [{ ...source, language }],
			}).language,
			language,
		);
});
test("rejects malformed IDs, citations, authorities, gov hosts, hashes, language, modes and provenance", () => {
	for (const patch of [
		{ version: 1 },
		{ mode: "verified" },
		{ language: "fr" },
		{ language: "es" }, // English excerpts cannot be relabelled as Spanish.
		{ safety_level: "routine" },
		{ safety_level: "urgent" },
		{ title: "" },
		{ paragraphs: [] },
		{ paragraphs: [{ text: "Invented local claim", citations: [source.id] }] },
		{ paragraphs: [{ text: source.excerpt, citations: [] }] },
		{ paragraphs: [{ text: source.excerpt, citations: ["missing"] }] },
		{
			paragraphs: [{ text: source.excerpt, citations: [source.id, source.id] }],
		},
		{ sources: [source, source] },
		{ provenance: { ...answer.provenance, model: "pretend-generation" } },
		{ provenance: { ...answer.provenance, corpus_revision: "" } },
		{ mode: "generated", provenance: { ...answer.provenance, model: null } },
		{
			mode: "abstained",
			sources: [],
			paragraphs: [{ text: "Unsupported claim", citations: [] }],
		},
	])
		assert.throws(
			() => parseEducationAnswer({ ...answer, ...patch }),
			JSON.stringify(patch),
		);
	for (const patch of [
		{ id: "bad id" },
		{ document_id: "" },
		{ authority: "WHO" },
		{ language: "de" },
		{ url: "https://cdc.gov.evil.test/x" },
		{ url: "https://www.fda.gov/" },
		{ url: "http://www.cdc.gov/x" },
		{ url: "https://www.cdc.gov:444/x" },
		{ url: "https://user:secret@www.cdc.gov/x" },
		{ content_sha256: "short" },
		{ excerpt: "" },
		{ fetched_at: "yesterday" },
		{ source_modified_at: 1 },
	])
		assert.throws(
			() =>
				parseEducationAnswer({ ...answer, sources: [{ ...source, ...patch }] }),
			JSON.stringify(patch),
		);
	for (const [authority, url] of [
		["FDA", "https://www.fda.gov/medical-devices/"],
		["NEI", "https://www.nei.nih.gov/eye-health-information/"],
	])
		assert.equal(
			parseEducationAnswer({
				...answer,
				sources: [{ ...source, authority, url }],
			}).sources[0]?.authority,
			authority,
		);
});
test("status validates consent, epoch, scope, topics and terms without trusting provider URLs", () => {
	assert.deepEqual(parseEducationStatus(status), status);
	for (const patch of [
		{ version: 1 },
		{ languages: ["en", "en"] },
		{ languages: ["fr"] },
		{ consent: { granted: true, adult_ack: false, epoch: 1 } },
		{ consent: { ...status.consent, epoch: -1 } },
		{ topics: [status.topics[0], status.topics[0]] },
		{
			disclosure: {
				...status.disclosure,
				terms_url: "https://evil.test/terms",
			},
		},
		{ provider: { ...status.provider, configured: false } },
	])
		assert.throws(() => parseEducationStatus({ ...status, ...patch }));
});
test("status accepts no monthly limit while preserving configuration availability checks", () => {
	assert.deepEqual(parseEducationStatus(status).budget, {
		monthly_limit_usd: null,
		available: true,
	});
	const unavailable = {
		...status,
		provider: { ...status.provider, available: false },
		budget: { monthly_limit_usd: null, available: false },
	};
	assert.deepEqual(parseEducationStatus(unavailable), unavailable);
	assert.throws(() =>
		parseEducationStatus({ ...status, budget: unavailable.budget }),
	);
	for (const monthly_limit_usd of ["5.00", "null", 5, 0, Number.NaN, undefined])
		assert.throws(() =>
			parseEducationStatus({
				...status,
				budget: { monthly_limit_usd, available: true },
			}),
		);
	assert.throws(() =>
		parseEducationStatus({ ...status, budget: { available: true } }),
	);
});
test("V1 fixed safety loads independently when V2 status fails; active answers POST only V2", async () => {
	const h = harness(),
		a = h.chat.loadCatalogue(),
		b = h.education.load();
	assert.deepEqual(
		h.calls.map((c) => c.path),
		["/api/oculog/v1/advice", "/api/oculog/v2/education"],
	);
	h.calls[0].result.resolve(catalogue);
	await a;
	assert.equal(
		h.chat.getState().catalogue?.safety_notice,
		"Fixed urgent safety",
	);
	h.calls[1].result.reject(new Error("status unavailable"));
	await b;
	const send = h.chat.sendQuestion("care");
	assert.equal(h.calls[2].path, "/api/oculog/v2/education/answer");
	assert.deepEqual(h.calls[2].options?.body, {
		question_id: "care",
		language: "en",
		use_ai: false,
	});
	h.calls[2].result.resolve(answer);
	await send;
	assert.equal(
		h.chat.getState().exchanges[0].answer?.education?.mode,
		"local_retrieval",
	);
	assert.equal(h.chat.getState().exchanges[0].answer?.urgency, "unknown");
});
test("withdrawal does not cancel independent in-flight fixed safety catalogue", async () => {
	const h = harness();
	const loading = h.chat.loadCatalogue();
	await h.education.withdraw();
	assert.equal(h.chat.getState().catalogueLoading, true);
	h.calls[0].result.resolve(catalogue);
	await loading;
	assert.equal(
		h.chat.getState().catalogue?.safety_notice,
		"Fixed urgent safety",
	);
});

test("reviewed topic IDs use V2 without touching the draft; failed topics retry the same ID", async () => {
	const h = harness();
	h.chat.setDraft("unfinished private draft");
	const pending = h.chat.sendTopic("care", "Reviewed care");
	assert.deepEqual(h.calls[0].options?.body, {
		topic_id: "care",
		language: "en",
		use_ai: false,
	});
	h.calls[0].result.reject(new Error("offline"));
	await pending;
	assert.equal(h.chat.getState().draft, "unfinished private draft");
	const retry = h.chat.retry(h.chat.getState().exchanges[0].key);
	assert.deepEqual(h.calls[1].options?.body, h.calls[0].options?.body);
	h.calls[1].result.resolve(answer);
	await retry;
	assert.equal(h.chat.getState().draft, "unfinished private draft");
	assert.equal(h.chat.getState().exchanges.length, 1);
});

test("no key still offers local search; server consent true never silently enables AI", async () => {
	const h = harness();
	await h.load({
		...status,
		consent: { granted: true, adult_ack: true, epoch: 8 },
		provider: {
			name: "Gemini",
			configured: false,
			available: false,
			reason: "provider_key_missing",
		},
	});
	h.education.setAdultAck(true);
	h.education.setExternalConsent(true);
	await h.education.grant();
	assert.equal(h.calls.length, 1);
	assert.equal(h.education.options().use_ai, false);
	h.chat.setDraft("care");
	const p = h.chat.sendMessage();
	h.calls[1].result.resolve(answer);
	await p;
	assert.equal(
		h.chat.getState().exchanges[0].answer?.education?.mode,
		"local_retrieval",
	);
});
test("explicit separate acknowledgments plus fresh consent and provider availability enable future AI only", async () => {
	const h = harness();
	await h.load({
		...status,
		consent: { granted: true, adult_ack: true, epoch: 4 },
	});
	assert.equal(h.education.options().use_ai, false);
	h.education.setAdultAck(true);
	await h.education.grant();
	assert.equal(h.calls.length, 1);
	h.education.setExternalConsent(true);
	const p = h.education.grant();
	assert.equal(h.education.options().use_ai, false);
	assert.deepEqual(h.calls[1].options?.body, {
		disclosure_version: "adult-v1",
		granted: true,
		adult_ack: true,
	});
	h.calls[1].result.resolve({ granted: true, adult_ack: true, epoch: 5 });
	await p;
	assert.deepEqual(h.education.options(), {
		language: "en",
		use_ai: true,
		consent_epoch: 5,
	});
});
test("withdrawal disables outgoing AI synchronously, clears chat and invalidates pending answer even on failure", async () => {
	const h = harness();
	await h.load();
	await h.grant();
	h.chat.setDraft("old");
	const send = h.chat.sendMessage();
	assert.equal(
		(h.calls[2].options?.body as { use_ai: boolean } | undefined)?.use_ai,
		true,
	);
	const withdrawal = h.education.withdraw();
	assert.equal(h.education.options().use_ai, false);
	assert.equal(h.chat.getState().pending, false);
	assert.equal(h.chat.getState().draft, "");
	assert.equal(h.chat.getState().exchanges.length, 0);
	assert.match(
		h.chat.getState().notice ?? "",
		/Gemini turned off.*pending answers cleared/,
	);
	h.calls[2].result.resolve({
		...answer,
		mode: "generated",
		provenance: { ...answer.provenance, model: "gemini-reviewed" },
	});
	await send;
	assert.equal(h.chat.getState().exchanges.length, 0);
	h.calls[3].result.reject(new Error("network down"));
	await withdrawal;
	assert.equal(h.education.options().use_ai, false);
	await h.load({
		...status,
		consent: { granted: true, adult_ack: true, epoch: 1 },
	});
	assert.equal(h.education.options().use_ai, false);
	assert.equal(h.education.getState().externalConsent, false);
});
test("inflight grant/status cannot re-enable after withdrawal; stale withdrawal cannot overwrite a newer owner", async () => {
	for (const pendingType of ["grant", "status"]) {
		const h = harness();
		await h.load();
		h.education.setAdultAck(true);
		h.education.setExternalConsent(true);
		const old =
			pendingType === "grant" ? h.education.grant() : h.education.load();
		const withdraw = h.education.withdraw();
		h.calls[1].result.resolve(
			pendingType === "grant"
				? { granted: true, adult_ack: true, epoch: 1 }
				: { ...status, consent: { granted: true, adult_ack: true, epoch: 1 } },
		);
		await old;
		assert.equal(h.education.options().use_ai, false);
		h.calls[2].result.resolve({ granted: false, adult_ack: false, epoch: 2 });
		await withdraw;
		assert.equal(h.education.getState().status?.consent.epoch, 2);
	}
	const h = harness();
	await h.load();
	const withdraw = h.education.withdraw();
	h.setIdentity("other:token");
	h.education.syncIdentity();
	await h.load();
	h.calls[1].result.resolve({ granted: false, adult_ack: false, epoch: 99 });
	await withdraw;
	assert.equal(h.education.getState().status?.consent.epoch, 0);
});
test("anonymous, account, token and unmount guards drop stale status/grant/withdraw successes and failures", async () => {
	const anonymous = harness(null);
	await anonymous.education.load();
	await anonymous.education.grant();
	assert.equal(anonymous.calls.length, 0);
	for (const transition of [
		null,
		"other:token",
		"account:token2",
		"unmount",
	] as const)
		for (const action of ["load", "grant", "withdraw"] as const)
			for (const fail of [false, true]) {
				const h = harness();
				await h.load();
				h.education.setAdultAck(true);
				h.education.setExternalConsent(true);
				const old = h.education[action]();
				if (transition === "unmount") h.education.dispose();
				else {
					h.setIdentity(transition);
					h.education.syncIdentity();
				}
				if (fail) h.calls[1].result.reject(new Error("old failure"));
				else
					h.calls[1].result.resolve(
						action === "load"
							? status
							: {
									granted: action === "grant",
									adult_ack: action === "grant",
									epoch: 1,
								},
					);
				await old;
				assert.equal(h.education.options().use_ai, false);
				assert.equal(h.education.getState().status, null);
				assert.equal(h.education.getState().error, null);
			}
});
test("language applies to future queries only; older answer language and newer draft survive", async () => {
	const h = harness();
	h.chat.setDraft("old");
	const first = h.chat.sendMessage();
	h.education.setLanguage("es");
	h.chat.setDraft("new draft");
	h.calls[0].result.resolve(answer);
	await first;
	assert.equal(h.chat.getState().draft, "new draft");
	assert.equal(
		h.chat.getState().exchanges[0].answer?.education?.language,
		"en",
	);
	const next = h.chat.sendMessage();
	assert.equal(
		(h.calls[1].options?.body as { language: string } | undefined)?.language,
		"es",
	);
	h.calls[1].result.resolve({
		...answer,
		language: "es",
		sources: [{ ...source, language: "es" }],
	});
	await next;
	assert.equal(h.chat.getState().exchanges.length, 2);
	assert.equal(
		h.chat.getState().exchanges[1].answer?.education?.language,
		"es",
	);
});
test("V2 adapter rejects unsolicited generation, malformed payloads and language mismatch; abstention stays usable", async () => {
	for (const payload of [
		{
			...answer,
			mode: "generated",
			provenance: { ...answer.provenance, model: "gemini-reviewed" },
		},
		{ ...answer, language: "es" },
		{ ...answer, sources: [] },
	]) {
		const h = harness();
		h.chat.setDraft("preserve draft");
		const p = h.chat.sendMessage();
		h.calls[0].result.resolve(payload);
		await p;
		assert.equal(h.chat.getState().draft, "preserve draft");
		assert.equal(h.chat.getState().exchanges[0].answer, undefined);
		assert.match(h.chat.getState().exchanges[0].error ?? "", /unsupported/);
	}
	const h = harness();
	h.chat.setDraft("unsupported");
	const p = h.chat.sendMessage();
	h.calls[0].result.resolve({
		...answer,
		mode: "abstained",
		paragraphs: [],
		sources: [],
	});
	await p;
	assert.equal(
		h.chat.getState().exchanges[0].answer?.education?.mode,
		"abstained",
	);
});
test("status loss or changed epoch clears pending AI and cannot silently re-enable", async () => {
	for (const change of ["failure", "epoch", "provider"] as const) {
		const h = harness();
		await h.load();
		await h.grant();
		h.chat.setDraft("care");
		const pending = h.chat.sendMessage();
		const refresh = h.education.load();
		if (change === "failure") h.calls[3].result.reject(new Error("offline"));
		else
			h.calls[3].result.resolve({
				...status,
				consent: {
					granted: true,
					adult_ack: true,
					epoch: change === "epoch" ? 2 : 1,
				},
				provider: { ...status.provider, available: change !== "provider" },
			});
		await refresh;
		assert.equal(h.education.options().use_ai, false);
		assert.match(h.chat.getState().notice ?? "", /pending answers cleared/);
		h.calls[2].result.resolve({
			...answer,
			mode: "generated",
			provenance: { ...answer.provenance, model: "gemini-reviewed" },
		});
		await pending;
		assert.equal(h.chat.getState().exchanges.length, 0);
		await h.load({
			...status,
			consent: { granted: true, adult_ack: true, epoch: 2 },
		});
		assert.equal(h.education.options().use_ai, false);
	}
});
test("generated answers require whole source chunks; safety stays English even for Spanish requests", async () => {
	const generated = {
		...answer,
		mode: "generated",
		provenance: { ...answer.provenance, model: "gemini-reviewed" },
	};
	for (const text of ["Public source", "A paraphrase.", "Una traducción."])
		assert.throws(() =>
			parseEducationAnswer({
				...generated,
				paragraphs: [{ text, citations: [source.id] }],
			}),
		);
	const safety = {
		...answer,
		mode: "safety",
		paragraphs: [{ text: "Fixed safety", citations: [] }],
		sources: [],
		safety_level: "emergency",
	};
	assert.throws(() => parseEducationAnswer({ ...safety, language: "es" }));
	const h = harness();
	h.education.setLanguage("es");
	h.chat.setDraft("urgent");
	const pending = h.chat.sendMessage();
	h.calls[0].result.resolve(safety);
	await pending;
	assert.equal(
		h.chat.getState().exchanges[0].answer?.education?.language,
		"en",
	);
	assert.equal(h.chat.getState().exchanges[0].answer?.urgency, "emergency");
});

test("clear, owner/token transition and unmount ignore pending V2 answers", async () => {
	for (const action of ["clear", "owner", "token", "unmount"]) {
		const h = harness();
		h.chat.setDraft("private");
		const p = h.chat.sendMessage();
		if (action === "clear") h.chat.clear();
		else if (action === "unmount") h.chat.dispose();
		else {
			h.setIdentity(action === "owner" ? "other:token" : "account:token2");
			h.chat.syncIdentity();
		}
		h.calls[0].result.resolve(answer);
		await p;
		assert.equal(
			h.chat.getState().exchanges.some((e) => e.answer),
			false,
		);
	}
});

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server");
function load(file: string, mocks: Record<string, unknown>) {
	const exports: Record<
		string,
		React.ComponentType<Record<string, unknown>>
	> = {};
	runInNewContext(
		ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			require: (name: string) => {
				if (name === "../../lib/advice-chat-api" && !(name in mocks))
					return { providerReason: (reason: string) => reason };
				if (name === "../native-page" && !(name in mocks))
					return nativeDOM(mocks);
				if (name === "../native-input")
					return {
						__esModule: true,
						default: ({ label, value }: any) =>
							React.createElement(
								"label",
								null,
								label,
								React.createElement("textarea", { defaultValue: value }),
							),
					};
				assert.ok(name in mocks, `Unexpected eager import ${name}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
function nativeDOM(mocks: Record<string, unknown>) {
	const stack = ({ children }: any) =>
		React.createElement("section", null, children);
	const pageText = ({ children, tone }: any) =>
		React.createElement(
			"p",
			tone === "danger" ? { "aria-live": "polite" } : {},
			children,
		);
	return {
		NativePage: ({ children, title }: any) =>
			React.createElement(
				"section",
				null,
				React.createElement("h1", null, title),
				children,
			),
		NativeSection: ({ children, title }: any) =>
			React.createElement(
				"section",
				null,
				React.createElement("h2", null, title),
				children,
			),
		NativeStack: stack,
		NativeContent: stack,
		NativeRow: stack,
		PageText: pageText,
		NativeAction: ({ label, onPress, disabled }: any) =>
			React.createElement(
				"button",
				{ type: "button", disabled, onClick: onPress },
				label,
			),
		PageToggle: ({ label, value, disabled, onChange }: any) =>
			React.createElement(
				"button",
				{
					type: "button",
					role: "switch",
					"aria-checked": value,
					disabled,
					onClick: () => {
						if (!disabled) onChange(!value);
					},
				},
				label,
			),
		PagePicker: ({ label, value, options, onChange }: any) =>
			React.createElement(
				"label",
				null,
				label,
				React.createElement(
					"select",
					{ value, onChange: (event: any) => onChange(event.target.value) },
					options.map((option: any) =>
						React.createElement(
							"option",
							{ key: option.value, value: option.value },
							option.label,
						),
					),
				),
			),
		NativeDisclosure: ({
			label,
			expanded,
			onExpandedChange,
			children,
		}: any) => {
			const component = (mocks["./advice-disclosure"] as any)?.AdviceDisclosure;
			return React.createElement(
				React.Fragment,
				null,
				component
					? React.createElement(component, {
							label,
							expanded,
							onPress: () => onExpandedChange(!expanded),
						})
					: React.createElement(
							"button",
							{
								type: "button",
								"aria-expanded": expanded,
								onClick: () => onExpandedChange(!expanded),
							},
							label,
						),
				expanded ? children : null,
			);
		},
	};
}
const theme = {
	usePresentationTheme: () => ({
		text: "#000",
		primary: "#066",
		secondary: "#555",
	}),
};
const jsx = { "react/jsx-runtime": require("react/jsx-runtime") };
// Native-tree adapters are rendered as inert host tags by this Linux harness.
const text = {
	PresentationText: ({ children }: any) =>
		React.createElement("p", null, children),
};
const link = load("../../src/components/advice/source-link-base.tsx", {
	...jsx,
	"react-native": { Linking: { openURL: async () => {} } },
	"../../lib/advice-api": require("../../src/lib/advice-api"),
});
const adapters = load("../../src/components/advice/advice-controls-base.tsx", {
	...jsx,
	"../presentation/theme": theme,
});
const view = {
	View: ({
		children,
		accessibilityLiveRegion,
	}: {
		children: React.ReactNode;
		accessibilityLiveRegion?: string;
	}) =>
		React.createElement(
			"section",
			{ "aria-live": accessibilityLiveRegion },
			children,
		),
};
function disclosureHarness() {
	const slots: unknown[] = [];
	let cursor = 0;
	const actions = new Map<string, () => void>();
	const hooks = {
		...React,
		useState(initial: unknown) {
			const index = cursor++;
			if (!(index in slots))
				slots[index] = typeof initial === "function" ? initial() : initial;
			return [
				slots[index],
				(value: unknown) => {
					slots[index] =
						typeof value === "function" ? value(slots[index]) : value;
				},
			];
		},
	};
	const actual = load("../../src/components/advice/advice-disclosure.tsx", {
		...jsx,
		"react-native": {
			Pressable: ({ children, accessibilityState, onPress }: any) =>
				React.createElement(
					"button",
					{ "aria-expanded": accessibilityState.expanded, onClick: onPress },
					children,
				),
		},
		"../presentation/text": text,
	});
	const disclosure = {
		AdviceDisclosure(props: Record<string, unknown>) {
			actions.set(props.label as string, props.onPress as () => void);
			return React.createElement(actual.AdviceDisclosure, props);
		},
	};
	return {
		hooks,
		disclosure,
		render(element: React.ReactElement) {
			cursor = 0;
			actions.clear();
			return renderToStaticMarkup(element);
		},
		press(label: string) {
			assert.ok(actions.has(label), `Missing disclosure ${label}`);
			actions.get(label)?.();
		},
	};
}

test("actual Advice screen keeps safety visible, composer early and topic expansion explicit", async () => {
	const h = harness();
	await h.load({
		...status,
		topics: Array.from({ length: 12 }, (_, i) => ({
			id: `topic-${i + 1}`,
			title: `Reviewed topic ${i + 1}!`,
			question: `Question ${i + 1}?`,
		})),
	});
	const catalogueLoad = h.chat.loadCatalogue();
	h.calls[1].result.resolve({
		...catalogue,
		questions: Array.from({ length: 4 }, (_, i) => ({
			id: i === 0 ? "care" : `legacy-${i}`,
			question: `Legacy question ${i + 1}?`,
		})),
		presentation: {
			summary: "Prepared answers, not AI.",
			lens_action: "Remove lenses",
			caution: "Do not wait for chat",
			triage: [
				{
					level: "emergency",
					title: "Emergency",
					text: "Fixed emergency safety",
				},
				{ level: "urgent", title: "Same day", text: "Fixed urgent safety" },
			],
			topics: Array.from({ length: 4 }, (_, i) => ({
				id: i === 0 ? "care" : `legacy-${i}`,
				label: `Legacy care topic ${i + 1}`,
			})),
		},
	});
	await catalogueLoad;
	const pending = h.chat.sendTopic("care", "Reviewed care");
	h.calls[2].result.resolve(answer);
	await pending;
	const interactive = disclosureHarness();
	const componentMocks = {
		...jsx,
		react: interactive.hooks,
		"./advice-disclosure": interactive.disclosure,
		"react-native": view,
		"../presentation/text": text,
		"./source-link": link,
	};
	const settings = load("../../src/components/advice/education-settings.tsx", {
		...componentMocks,
		react: interactive.hooks,
		"./advice-disclosure": interactive.disclosure,
		"./advice-controls": adapters,
	});
	const answers = load(
		"../../src/components/advice/education-answer.tsx",
		componentMocks,
	);
	const destinations: string[] = [];
	const navigationActions = new Map<string, () => void>();
	const rn = ({ children }: any) =>
		React.createElement("section", null, children);
	const rnText = ({ children }: any) =>
		React.createElement("span", null, children);
	const chatLayout = require("../../src/components/advice/chat-layout");
	const screen = load("../../src/components/advice/advice-screen.tsx", {
		...jsx,
		react: {
			...interactive.hooks,
			useRef: (current: any) => ({ current }),
			useEffect() {},
			useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
		},
		"react-native": {
			View: rn,
			Text: rnText,
			ScrollView: rn,
			KeyboardAvoidingView: rn,
			TextInput: ({ accessibilityLabel, value }: any) =>
				React.createElement("textarea", {
					"aria-label": accessibilityLabel,
					defaultValue: value,
				}),
			ActivityIndicator: () => null,
			Linking: { openURL: async () => {} },
			StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
			useColorScheme: () => "light",
			useWindowDimensions: () => ({ width: 393, height: 852, fontScale: 1 }),
		},
		"react-native-safe-area-context": {
			useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
		},
		"@expo/ui": {
			RNHostView: rn,
			BottomSheet: ({ isPresented, children }: any) =>
				isPresented ? children : null,
		},
		"../../lib/advice-api": require("../../src/lib/advice-api"),
		"../../lib/advice-chat-api": {
			chatAPI: () => ({}),
			chatAdviceAPI: () => ({}),
		},
		"./chat-layout": chatLayout,
		"./advice-action": {
			AdviceAction: ({ label, onPress, disabled }: any) => {
				navigationActions.set(label, onPress);
				return React.createElement("button", { disabled }, label);
			},
		},
		"../../lib/advice-controller": { createAdviceController: () => h.chat },
		"../../lib/education-controller": {
			createEducationController: () => h.education,
		},
		"../../lib/education-api": {
			educationAPI: () => ({}),
			educationAdviceAPI: () => ({}),
		},
		"../../lib/api": {
			request() {},
			sessionStore: { account: { id: 1 }, token: "test" },
		},
		"../presentation/screen-frame": { ScreenFrame: view.View },
		"../presentation/text": text,
		"../presentation/theme": theme,
		"./advice-controls": {
			...adapters,
			Button(props: { title: string; onPress: () => void }) {
				navigationActions.set(props.title, props.onPress);
				return React.createElement(adapters.Button, props);
			},
		},
		"./advice-disclosure": interactive.disclosure,
		"./education-answer": answers,
		"./education-settings": settings,
		"./source-link": link,
	});
	const screenProps = {};
	const markup = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(markup, /Educational guidance, not a diagnosis/);
	assert.ok(navigationActions.has("Safety"));
	const openPractice = navigationActions.get("Practice hygiene lessons");
	assert.equal(openPractice, undefined);
	assert.deepEqual(destinations, []);
	assert.match(markup, /Contact lens education · Local sources/);
	assert.match(markup, /Ask a contact lens question/);
	assert.doesNotMatch(markup, /Grant consent|role="switch"/);
	assert.match(markup, /Public source passage/);
	assert.doesNotMatch(markup, /Up to 20 exchanges/);
	navigationActions.get("More options")?.();
	const conversationInfo = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(conversationInfo, /Up to 20 exchanges/);
	assert.match(
		conversationInfo,
		/Earlier messages stay local|not earlier messages/,
	);
	navigationActions.get("Safety")?.();
	const safety = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(safety, /Fixed emergency safety/);
	assert.match(safety, /Fixed urgent safety/);
	assert.match(safety, /Remove lenses/);
	assert.match(safety, /Do not wait for chat/);
	navigationActions.get("Explore all questions")?.();
	const expanded = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	for (let i = 1; i <= 12; i++)
		assert.ok(expanded.includes(`Reviewed topic ${i}!`));
	assert.doesNotMatch(expanded, /Grant consent/);
	navigationActions.get("Education settings")?.();
	const settingsOpen = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(settingsOpen, /Grant consent/);
	assert.match(settingsOpen, /Earlier messages stay local/);
	assert.match(
		settingsOpen,
		/account details, lens records and photos are not sent/,
	);
	assert.doesNotMatch(settingsOpen, /auto[Ff]ocus/);
	navigationActions.get("Done")?.();
	h.education.dispose();
	h.education.mount();
	const loading = h.education.load();
	const loadingMarkup = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(loadingMarkup, /Contact lens education · Local sources/);
	assert.match(loadingMarkup, /Educational guidance, not a diagnosis/);
	h.calls[3].result.reject(new Error("Availability check failed"));
	await loading;
	h.chat.clear("Gemini turned off. Conversation and pending answers cleared.");
	const failed = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(failed, /Contact lens education · Local sources/);
	navigationActions.get("Education settings")?.();
	const failedSettings = interactive.render(
		React.createElement(screen.default, screenProps),
	);
	assert.match(failedSettings, /Availability check failed/);
	assert.match(
		failed,
		/Gemini turned off. Conversation and pending answers cleared/,
	);
	assert.doesNotMatch(failed, /Grant consent|role="switch"|auto[Ff]ocus/);
	assert.match(failed, /Educational guidance, not a diagnosis/);
});

test("settings retain language/enabled state and errors, with explicit consent controls", () => {
	const interactive = disclosureHarness();
	const settings = load("../../src/components/advice/education-settings.tsx", {
		...jsx,
		react: interactive.hooks,
		"./advice-disclosure": interactive.disclosure,
		"react-native": view,
		"../presentation/text": text,
		"./advice-controls": adapters,
		"./source-link": link,
	});
	const h = harness();
	for (const [language, enabled, loading, error] of [
		["en", false, true, null],
		["es", false, false, "Availability failed"],
		["es", true, false, null],
	] as const) {
		const markup = interactive.render(
			React.createElement(settings.EducationSettings, {
				control: h.education,
				state: { ...h.education.getState(), language, enabled, loading, error },
				onLinkError() {},
			}),
		);
		assert.ok(
			markup.includes(
				`${enabled ? "AI replies" : "Local source excerpts"} · ${language === "es" ? "Spanish" : "English"} · Gemini ${enabled ? "enabled" : "off"}`,
			),
		);
		assert.match(markup, /aria-expanded="true"/);
		assert.match(markup, /Language for future questions/);
		assert.match(markup, /Turn off Gemini and clear chat/);
		assert.doesNotMatch(markup, /auto[Ff]ocus/);
		if (error) {
			assert.match(markup, /aria-live="polite"/);
			assert.ok(markup.includes(error));
		}
	}
});

test("numbered references preserve every complete answer paragraph while provenance is collapsed", () => {
	const interactive = disclosureHarness();
	const component = load("../../src/components/advice/education-answer.tsx", {
		...jsx,
		react: interactive.hooks,
		"./advice-disclosure": interactive.disclosure,
		"react-native": view,
		"../presentation/text": text,
		"./source-link": link,
	});
	const second = {
		...source,
		id: "cdc-care.chunk-2",
		excerpt: "Complete second passage, including its qualification.",
	};
	const value = {
		...answer,
		mode: "generated",
		reason: null,
		sources: [source, second],
		paragraphs: [
			{ text: second.excerpt, citations: [second.id] },
			...answer.paragraphs,
		],
		provenance: { ...answer.provenance, model: "gemini-reviewed" },
	};
	const element = React.createElement(component.EducationAnswer, {
		answer: value,
		onLinkError() {},
	});
	const compact = interactive.render(element);
	assert.match(compact, /AI-selected source excerpts/);
	assert.ok(compact.includes(second.excerpt));
	assert.ok(compact.includes(source.excerpt));
	assert.ok(
		compact.indexOf("References: [2]") < compact.indexOf("References: [1]"),
	);
	assert.equal((compact.match(/Source: /g) ?? []).length, 2);
	assert.doesNotMatch(compact, /chunk-1|chunk-2|SHA-256|Corpus revision/);
	interactive.press("View source excerpts and provenance");
	const expanded = interactive.render(element);
	assert.equal(expanded.split(second.excerpt).length - 1, 2);
	assert.equal(expanded.split(source.excerpt).length - 1, 2);
	interactive.press("View source excerpts and provenance");
	const safety = interactive.render(
		React.createElement(component.EducationAnswer, {
			answer: {
				...answer,
				mode: "safety",
				title: "Fixed urgent title",
				paragraphs: [
					{ text: "Complete fixed urgent guidance.", citations: [] },
				],
				sources: [],
				safety_level: "urgent",
			},
			onLinkError() {},
		}),
	);
	assert.match(safety, /Fixed urgent title/);
	assert.match(safety, /Complete fixed urgent guidance/);
});

test("abstention explains unsupported topics and exposes only a bounded reason code before provenance", () => {
	const interactive = disclosureHarness();
	const component = load("../../src/components/advice/education-answer.tsx", {
		...jsx,
		react: interactive.hooks,
		"./advice-disclosure": interactive.disclosure,
		"react-native": view,
		"../presentation/text": text,
		"./source-link": link,
	});
	const render = (reason: string) =>
		interactive.render(
			React.createElement(component.EducationAnswer, {
				answer: {
					...answer,
					mode: "abstained",
					reason,
					paragraphs: [],
					sources: [],
				},
				onLinkError() {},
			}),
		);
	const markup = render("unsupported_general_topic");
	assert.match(markup, /outside the reviewed education topics/);
	assert.match(markup, /Gemini was not called/);
	assert.match(markup, /Choose a reviewed education topic/);
	assert.match(markup, /Response reason: unsupported_general_topic/);
	assert.doesNotMatch(markup, /Corpus revision|Prompt:|Retriever:/);
	const other = render("no_reviewed_passages");
	assert.match(other, /Response reason: no_reviewed_passages/);
	assert.doesNotMatch(other, /Gemini was not called/);
	const unsafe = render("Server exception: secret-token");
	assert.doesNotMatch(unsafe, /Server exception|secret-token/);
});

test("native consent delegates to the bounded native-tree switch without per-control Hosts", () => {
	const { renderToStaticMarkup } = require("react-dom/server");
	for (const platform of ["ios"]) {
		const hosts: Record<string, unknown>[] = [];
		const switches: Record<string, unknown>[] = [];
		const native = load(
			"../../src/components/advice/advice-controls-base.tsx",
			{
				...jsx,
				"@expo/ui": {
					Host: (props: Record<string, unknown>) => {
						hosts.push(props);
						return React.createElement(
							"div",
							null,
							props.children as React.ReactNode,
						);
					},
				},
				"react-native": { Platform: { OS: platform } },
				"../presentation": { usePresentationEpoch: () => 1 },
				"../presentation/theme": theme,
				"../native-page": {
					PageToggle: (props: Record<string, unknown>) => {
						switches.push(props);
						return React.createElement("span", null, props.label as string);
					},
				},
				"../ui": { useColors: () => ({ accent: "#066" }) },
				"../ui-controls": {
					SwitchControl: (props: Record<string, unknown>) => {
						switches.push(props);
						return React.createElement("span", null, props.label as string);
					},
				},
			},
		);
		const label =
			"I consent to optional Gemini processing of reviewed topics and public passages";
		const markup = renderToStaticMarkup(
			React.createElement(native.Toggle, {
				label,
				value: true,
				disabled: false,
				onChange() {},
			}),
		);
		assert.equal(hosts.length, 0, "the measured page owns the only Host");
		assert.equal(switches[0].label, label);
		assert.equal(switches[0].value, true);
		assert.ok(markup.includes(label));
	}
});
