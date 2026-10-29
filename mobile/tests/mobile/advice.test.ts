import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	type AdviceAnswer,
	type AdviceCatalogue,
	type AdviceRequest,
	adviceAPI,
	isSafeAdviceURL,
	parseAdviceAnswer,
	parseAdviceCatalogue,
} from "../../src/lib/advice-api";
import { createAdviceController } from "../../src/lib/advice-controller";

const catalogue: AdviceCatalogue = {
	version: 1,
	disclaimer: "Test disclaimer",
	safety_notice: "Test safety notice",
	questions: [{ id: "test", question: "Test question?" }],
};
const answer: AdviceAnswer = {
	version: 1,
	id: "test",
	title: "Test title",
	paragraphs: ["Test paragraph."],
	urgency: "routine",
	sources: [{ title: "Test source", url: "https://example.org/reference" }],
	related_question_ids: ["test"],
	matched: true,
};
const fallback: AdviceAnswer = {
	...answer,
	id: null,
	urgency: "unknown",
	matched: false,
};
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function harness() {
	let identity: string | null = "account:token1";
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
	const controller = createAdviceController(adviceAPI(request), () => identity);
	return {
		controller,
		calls,
		setIdentity(next: string | null) {
			identity = next;
		},
	};
}

test("Advice composer delegates to bounded native input with a writing prompt", () => {
	const screen = readFileSync(
		new URL("../../src/components/advice/advice-screen.tsx", import.meta.url),
		"utf8",
	);
	assert.match(
		screen,
		/<TextInput\s+accessibilityLabel="Ask a contact lens question"/,
	);
	assert.match(screen, /value=\{state\.draft\}/);
	assert.match(screen, /onChangeText=\{controller\.setDraft\}/);
	assert.match(screen, /placeholder="Ask anything about lens care…"/);
	assert.match(screen, /multiline\s+maxLength=\{1000\}/);
	assert.match(screen, /scrollEnabled=\{inputHeight >= bounds.max\}/);
});

test("catalogue validates every field, bounded text, unique IDs and arrays", () => {
	assert.deepEqual(parseAdviceCatalogue(catalogue), catalogue);
	for (const field of ["version", "disclaimer", "safety_notice", "questions"]) {
		const value = { ...catalogue } as Record<string, unknown>;
		delete value[field];
		assert.throws(() => parseAdviceCatalogue(value));
	}
	for (const patch of [
		{ version: 2 },
		{ disclaimer: "" },
		{ safety_notice: "x".repeat(4001) },
		{ questions: [{ id: "", question: "Q" }] },
		{ questions: [{ id: "a", question: 1 }] },
		{ questions: Array(101).fill(catalogue.questions[0]) },
		{ questions: [catalogue.questions[0], catalogue.questions[0]] },
	])
		assert.throws(() => parseAdviceCatalogue({ ...catalogue, ...patch }));
});

test("optional server presentation is bounded, references real questions, and accepts legacy catalogues", () => {
	const server = JSON.parse(
		readFileSync(
			new URL("../../../backend/advice.json", import.meta.url),
			"utf8",
		),
	);
	const parsed = parseAdviceCatalogue(server);
	assert.deepEqual(parsed.presentation, server.presentation);
	assert.equal(parseAdviceCatalogue(catalogue).presentation, undefined);
	assert.equal(parsed.presentation?.topics.length, 4);
	for (const patch of [
		{ summary: "" },
		{ summary: "x".repeat(501) },
		{ lens_action: "" },
		{ caution: null },
		{ triage: [] },
		{ triage: [server.presentation.triage[0]] },
		{ triage: [server.presentation.triage[0], server.presentation.triage[0]] },
		{
			triage: [
				{ ...server.presentation.triage[0], level: "routine" },
				server.presentation.triage[1],
			],
		},
		{ topics: [] },
		{ topics: Array(5).fill(server.presentation.topics[0]) },
		{ topics: [server.presentation.topics[0], server.presentation.topics[0]] },
		{ topics: [{ id: "missing", label: "Unknown" }] },
		{ topics: [{ id: "red_eyes", label: "x".repeat(81) }] },
	])
		assert.throws(() =>
			parseAdviceCatalogue({
				...server,
				presentation: { ...server.presentation, ...patch },
			}),
		);
	assert.throws(() => parseAdviceCatalogue({ ...server, presentation: null }));
});

test("Advice keeps urgent context visible, composer outside sheets, and complete fixed safety available", () => {
	const screen = readFileSync(
		new URL("../../src/components/advice/advice-screen.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(screen, /setTimeout|Animated/);
	assert.ok(
		screen.indexOf("Educational guidance, not a diagnosis") <
			screen.indexOf("state.exchanges.map"),
	);
	assert.ok(screen.indexOf("<TextInput") < screen.indexOf("<BottomSheet"));
	assert.match(screen, /presentation\.triage\s*\.filter/);
	assert.match(screen, /presentation\.lens_action/);
	assert.match(screen, /presentation\.caution/);
	assert.match(screen, /\{catalogue.safety_notice\}/);
	assert.match(
		screen,
		/For urgent eye problems, seek professional care rather than waiting for the app/,
	);
	assert.match(screen, /panel === "safety"/);
	assert.match(screen, /panel === "questions"/);
});

test("Advice disclosures expose expanded state and retain native button semantics", () => {
	const source = (file: string) =>
		readFileSync(
			new URL(`../../src/components/advice/${file}`, import.meta.url),
			"utf8",
		);
	const native = source("advice-disclosure.tsx");
	assert.match(native, /<Pressable/);
	assert.match(native, /accessibilityRole="button"/);
	assert.match(native, /accessibilityLabel=\{label\}/);
	assert.match(native, /accessibilityState=\{\{ expanded \}\}/);
	assert.match(native, /onPress=\{onPress\}/);
	assert.match(native, /tone="primary"/);
	for (const adapter of [native]) {
		assert.match(adapter, /minHeight: 48/);
		assert.match(adapter, /minWidth: 48/);
		assert.match(adapter, /opacity: pressed \? 0\.65 : 1/);
		assert.doesNotMatch(
			adapter,
			/outline:\s*["']none|height:\s*48|whiteSpace:\s*["']nowrap|preventDefault|onKeyPress|hover|@expo\/ui/,
		);
	}
});

test("answers validate all fields and supported fallback semantics before publishing", () => {
	assert.deepEqual(parseAdviceAnswer(answer), answer);
	assert.deepEqual(parseAdviceAnswer(fallback), fallback);
	for (const field of Object.keys(answer)) {
		const value = { ...answer } as Record<string, unknown>;
		delete value[field];
		assert.throws(() => parseAdviceAnswer(value), field);
	}
	for (const patch of [
		{ version: 2 },
		{ id: "" },
		{ title: "x".repeat(501) },
		{ paragraphs: [] },
		{ paragraphs: Array(21).fill("p") },
		{ paragraphs: ["x".repeat(4001)] },
		{ urgency: "critical" },
		{ matched: "yes" },
		{ matched: false },
		{ id: null },
		{ sources: Array(13).fill(answer.sources[0]) },
		{ sources: [{ title: "", url: "https://example.org" }] },
		{ sources: [{ title: "t", url: "javascript:alert(1)" }] },
		{ related_question_ids: Array(21).fill("a") },
		{ related_question_ids: [null] },
	])
		assert.throws(() => parseAdviceAnswer({ ...answer, ...patch }));
});

test("sources allow only bounded credential-free HTTPS URLs", () => {
	for (const url of ["https://example.org/a?q=b#c", "https://www.nhs.uk/"])
		assert.equal(isSafeAdviceURL(url), true);
	for (const url of [
		"http://example.org",
		"javascript:alert(1)",
		"//example.org",
		"/relative",
		"data:text/html,test",
		"https://user:secret@example.org",
		"https://example.org/\npath",
		"https:\\example.org",
		`https://example.org/${"a".repeat(2048)}`,
		null,
		12,
	])
		assert.equal(isSafeAdviceURL(url), false, String(url));
});

test("client sends exactly one payload field and preserves request errors", async () => {
	const seen: unknown[] = [];
	const api = adviceAPI(
		async <T>(path: string, options?: Record<string, unknown>) => {
			seen.push([path, options]);
			return (options ? answer : catalogue) as T;
		},
	);
	await api.catalogue();
	await api.answer({ question_id: "test" });
	await api.answer({ message: "  hello  " });
	assert.deepEqual(seen, [
		["/api/oculog/v1/advice", undefined],
		[
			"/api/oculog/v1/advice/answer",
			{ method: "POST", body: { question_id: "test" } },
		],
		[
			"/api/oculog/v1/advice/answer",
			{ method: "POST", body: { message: "hello" } },
		],
	]);
	await assert.rejects(api.answer({ message: " " }));
	await assert.rejects(api.answer({ message: "x".repeat(1001) }));
	await assert.rejects(
		api.answer({ question_id: "test", message: "both" } as never),
	);
	const error = Object.assign(new Error("Authentication failed"), {
		status: 401,
	});
	await assert.rejects(
		adviceAPI(async () => {
			throw error;
		}).catalogue(),
		(caught) => caught === error,
	);
});

test("catalogue synchronous duplicate protection, error and retry", async () => {
	const { controller: c, calls } = harness();
	const load = c.loadCatalogue();
	await c.loadCatalogue();
	assert.equal(calls.length, 1);
	calls[0].result.reject(new Error("Cannot reach the server."));
	await load;
	assert.equal(c.getState().catalogueError, "Cannot reach the server.");
	const retry = c.loadCatalogue();
	calls[1].result.resolve(catalogue);
	await retry;
	assert.deepEqual(c.getState().catalogue, catalogue);
	assert.equal(c.getState().catalogueError, null);
});

test("send blocks duplicates synchronously, retains draft on failure, and retries without duplicate exchange", async () => {
	const { controller: c, calls } = harness();
	c.setDraft("my question");
	const pending = c.sendMessage();
	await c.sendMessage();
	assert.equal(calls.length, 1);
	calls[0].result.reject(new Error("Offline"));
	await pending;
	assert.equal(c.getState().draft, "my question");
	assert.equal(c.getState().exchanges[0].error, "Offline");
	const retry = c.retry(c.getState().exchanges[0].key);
	calls[1].result.resolve(answer);
	await retry;
	assert.equal(c.getState().draft, "");
	assert.equal(c.getState().exchanges.length, 1);
	assert.deepEqual(c.getState().exchanges[0].answer, answer);
});

test("prepared questions send IDs, failed questions retry the same payload", async () => {
	const { controller: c, calls } = harness();
	const load = c.loadCatalogue();
	calls[0].result.resolve(catalogue);
	await load;
	const pending = c.sendQuestion("test");
	assert.deepEqual(calls[1].options?.body, { question_id: "test" });
	calls[1].result.reject(new Error("Offline"));
	await pending;
	const retry = c.retry(c.getState().exchanges[0].key);
	assert.deepEqual(calls[2].options?.body, { question_id: "test" });
	calls[2].result.resolve(answer);
	await retry;
	assert.equal(c.getState().exchanges.length, 1);
});

test("newer drafts survive successful older sends and unsupported responses remain errors", async () => {
	const { controller: c, calls } = harness();
	c.setDraft("old");
	const send = c.sendMessage();
	c.setDraft("new");
	calls[0].result.resolve(answer);
	await send;
	assert.equal(c.getState().draft, "new");
	const invalid = c.sendMessage();
	calls[1].result.resolve({ ...answer, version: 9 });
	await invalid;
	assert.equal(c.getState().draft, "new");
	assert.match(c.getState().exchanges[1].error ?? "", /unsupported/);
	assert.equal(c.getState().exchanges[1].answer, undefined);
	c.setDraft("x".repeat(1001));
	assert.equal(c.getState().draft, "new");
});

test("retrying an older failed message does not clear a new draft", async () => {
	const { controller: c, calls } = harness();
	c.setDraft("old question");
	const first = c.sendMessage();
	calls[0].result.reject(new Error("Offline"));
	await first;
	c.setDraft("new question");
	const retry = c.retry(c.getState().exchanges[0].key);
	calls[1].result.resolve(answer);
	await retry;
	assert.equal(c.getState().draft, "new question");
});

test("clear invalidates old responses and cannot clobber a newer request", async () => {
	const { controller: c, calls } = harness();
	c.setDraft("old");
	const old = c.sendMessage();
	c.clear();
	c.setDraft("new");
	const next = c.sendMessage();
	calls[0].result.resolve(answer);
	await old;
	assert.equal(c.getState().pending, true);
	assert.equal(c.getState().exchanges[0].label, "new");
	calls[1].result.resolve(fallback);
	await next;
	assert.deepEqual(c.getState().exchanges[0].answer, fallback);
});

test("signout, account change and token change invalidate catalogue, errors and answers", async () => {
	for (const nextIdentity of [null, "other:token", "account:token2"]) {
		for (const fail of [false, true]) {
			const { controller: c, calls, setIdentity } = harness();
			const load = c.loadCatalogue();
			c.setDraft("private");
			const send = c.sendMessage();
			setIdentity(nextIdentity);
			if (fail) {
				calls[0].result.reject(new Error("Old error"));
				calls[1].result.reject(new Error("Old error"));
			} else {
				calls[0].result.resolve(catalogue);
				calls[1].result.resolve(answer);
			}
			await Promise.all([load, send]);
			assert.equal(c.getState().catalogue, null);
			assert.equal(c.getState().catalogueError, null);
			assert.equal(c.getState().exchanges.length, 0);
			assert.equal(c.getState().draft, "");
		}
	}
});

test("identity is checked before reading old draft or retry input", async () => {
	const { controller: c, calls, setIdentity } = harness();
	c.setDraft("private");
	setIdentity("other:token");
	await c.sendMessage();
	assert.equal(calls.length, 0);
	assert.equal(c.getState().draft, "");
});

test("unmount ignores both success and failure without publishing", async () => {
	for (const fail of [false, true]) {
		const { controller: c, calls } = harness();
		let publications = 0;
		c.subscribe(() => publications++);
		const load = c.loadCatalogue();
		c.setDraft("private");
		const send = c.sendMessage();
		c.dispose();
		const count = publications;
		if (fail) {
			calls[0].result.reject(new Error("Offline"));
			calls[1].result.reject(new Error("Offline"));
		} else {
			calls[0].result.resolve(catalogue);
			calls[1].result.resolve(answer);
		}
		await Promise.all([load, send]);
		assert.equal(publications, count);
		c.mount();
		assert.equal(c.getState().pending, false);
		assert.equal(c.getState().exchanges.length, 0);
	}
});

test("history has a hard 20-exchange cap and never sends history", async () => {
	const { controller: c, calls } = harness();
	for (let i = 0; i < 23; i++) {
		c.setDraft(`Question ${i}`);
		const send = c.sendMessage();
		assert.deepEqual(calls[i].options?.body, { message: `Question ${i}` });
		calls[i].result.resolve(answer);
		await send;
	}
	assert.equal(c.getState().exchanges.length, 20);
	assert.equal(c.getState().exchanges[0].label, "Question 3");
	assert.match(c.getState().notice ?? "", /Older exchanges were cleared/);
});
