import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import ts from "typescript";
import * as hubModel from "../../src/components/learning/hub-model";
import type { AdviceRequest } from "../../src/lib/advice-api";
import {
	type LearningAnswer,
	type LearningQuestion,
	type LearningStatus,
	learningAPI,
	parseLearningAnswer,
	parseLearningStatus,
	safeLearningURL,
} from "../../src/lib/learning-api";
import { createLearningController } from "../../src/lib/learning-controller";

// Server-only answer bank is used solely to construct test fixtures, never in the application bundle.
const bank = JSON.parse(
	readFileSync(
		new URL("../../../backend/learning_data.json", import.meta.url),
		"utf8",
	),
);
const questions: LearningQuestion[] = bank.questions.map(
	({
		correct_option_id: _correct,
		explanation: _explanation,
		...q
	}: Record<string, unknown>) => q,
);
function status(generation = 0): LearningStatus {
	return structuredClone<LearningStatus>({
		version: 1,
		generation,
		policy_revision: "mistakes-new-due-v1",
		source_bank_revision: bank.revision,
		corpus_revision: "a".repeat(64),
		review_status: "source-grounded-not-clinician-validated",
		lessons: bank.lessons.map((l: { id: string }) => ({
			...l,
			questions: questions.filter((q) => q.lesson_id === l.id),
		})),
		progress: {},
		recommended_question: { ...questions[0], reason: "unanswered" },
	});
}
function answer(generation = 0): LearningAnswer {
	const s = status(generation),
		q = questions[0];
	return {
		...s,
		progress: {
			[q.id]: {
				attempts: 1,
				correct: 1,
				last_correct: true,
				last_time: 100,
				review_due: 604900,
			},
		},
		recommended_question: { ...questions[1], reason: "unanswered" },
		feedback: {
			question_id: q.id,
			selected_option_id: "a",
			correct: true,
			explanation: "CDC includes washing and drying.",
			reference: s.lessons[0].reference,
		},
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function harness() {
	let identity: string | null = "one:token1",
		ids = 0;
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
	const controller = createLearningController(
		learningAPI(request),
		() => identity,
		() => `random-attempt-${++ids}-0000`,
	);
	return {
		controller,
		calls,
		setIdentity(next: string | null) {
			identity = next;
			controller.syncIdentity();
		},
	};
}
async function loaded() {
	const h = harness(),
		p = h.controller.load();
	h.calls[0].result.resolve(status());
	await p;
	return h;
}

test("learning contract validates server lessons and feedback without answer keys", () => {
	const parsed = parseLearningStatus(status());
	assert.equal(parsed.lessons.length, 8);
	assert.equal(parsed.lessons.flatMap((l) => l.questions).length, 10);
	assert.ok(!JSON.stringify(parsed).includes("correct_option_id"));
	assert.equal(parseLearningAnswer(answer()).feedback.correct, true);
});
test("contract rejects leaked answers, malformed options, duplicate IDs and mismatched recommendations", () => {
	const leak = structuredClone(status()) as unknown as {
		lessons: { questions: Record<string, unknown>[] }[];
	};
	leak.lessons[0].questions[0].correct_option_id = "a";
	assert.throws(() => parseLearningStatus(leak));
	const duplicate = status();
	duplicate.lessons[0].questions.push(duplicate.lessons[0].questions[0]);
	assert.throws(() => parseLearningStatus(duplicate));
	const wrong = status();
	if (wrong.recommended_question)
		wrong.recommended_question.prompt = "Unreviewed prompt";
	assert.throws(() => parseLearningStatus(wrong));
	const option = status();
	option.lessons[0].questions[0].options = [];
	assert.throws(() => parseLearningStatus(option));
});
test("source URL validation permits only exact HTTPS government hosts", () => {
	for (const value of [
		"http://www.cdc.gov/",
		"https://www.cdc.gov.evil.test/",
		"https://user@www.cdc.gov/",
		"javascript:alert(1)",
		"https://example.org/",
		"https://www.cdc.gov:123/",
	])
		assert.equal(safeLearningURL(value), false);
	assert.equal(safeLearningURL(status().lessons[0].reference.url), true);
	const invalid = status();
	invalid.lessons[0].reference = {
		...invalid.lessons[0].reference,
		url: "https://example.org/",
	};
	assert.throws(() => parseLearningStatus(invalid));
});
test("contract rejects false progress and feedback with unrelated evidence", () => {
	const invalid = answer();
	invalid.progress[questions[0].id].correct = 2;
	assert.throws(() => parseLearningAnswer(invalid));
	const wrong = answer();
	wrong.feedback.reference = wrong.lessons[1].reference;
	assert.throws(() => parseLearningAnswer(wrong));
	const mismatch = answer();
	mismatch.feedback.correct = false;
	assert.throws(() => parseLearningAnswer(mismatch));
});
test("answer lock is synchronous, request uses option IDs and no client grade", async () => {
	const h = await loaded();
	const first = h.controller.answer(questions[0].id, "a"),
		duplicate = h.controller.answer(questions[0].id, "b");
	assert.equal(h.calls.length, 2);
	const body = h.calls[1].options?.body as Record<string, unknown>;
	assert.deepEqual(Object.keys(body).sort(), [
		"client_attempt_id",
		"generation",
		"option_id",
		"question_id",
		"source_bank_revision",
	]);
	assert.equal(body.option_id, "a");
	h.calls[1].result.resolve(answer());
	await Promise.all([first, duplicate]);
	assert.equal(h.controller.getSnapshot().feedback?.correct, true);
	assert.equal(h.controller.getSnapshot().pending, null);
});
test("uncertain recording preserves exact attempt ID and blocks load or changed answers", async () => {
	const h = await loaded(),
		first = h.controller.answer(questions[0].id, "a");
	const body = h.calls[1].options?.body;
	h.calls[1].result.reject(new Error("offline"));
	await first;
	assert.match(h.controller.getSnapshot().error ?? "", /unconfirmed/);
	assert.ok(h.controller.getSnapshot().pending);
	await h.controller.load();
	await h.controller.answer(questions[0].id, "b");
	assert.equal(h.calls.length, 2);
	const retry = h.controller.retry();
	assert.deepEqual(h.calls[2].options?.body, body);
	h.calls[2].result.resolve(answer());
	await retry;
	assert.equal(
		h.controller.getSnapshot().status?.progress[questions[0].id].attempts,
		1,
	);
});
test("account or token changes discard deferred status and answers", async () => {
	for (const next of ["two:token2", "one:token2", null]) {
		const h = await loaded(),
			pending = h.controller.answer(questions[0].id, "a");
		h.setIdentity(next);
		h.calls[1].result.resolve(answer());
		await pending;
		assert.equal(h.controller.getSnapshot().status, null);
		assert.equal(h.controller.getSnapshot().feedback, null);
		assert.equal(h.controller.getSnapshot().pending, null);
	}
	const h = harness(),
		pending = h.controller.load();
	h.setIdentity("two:token2");
	h.calls[0].result.resolve(status());
	await pending;
	assert.equal(h.controller.getSnapshot().status, null);
});
test("identity guard also checks identity when response arrives without a notification", async () => {
	let identity = "one:token1";
	const result = deferred<LearningStatus>();
	const controller = createLearningController(
		{
			status: () => result.promise,
			answer: async () => answer(),
			reset: async () => status(1),
		},
		() => identity,
		() => "random-attempt-0000",
	);
	const pending = controller.load();
	identity = "one:token2";
	result.resolve(status());
	await pending;
	assert.equal(controller.getSnapshot().status, null);
});
test("reset supersedes deferred answers; old feedback cannot return", async () => {
	const h = await loaded(),
		pending = h.controller.answer(questions[0].id, "a");
	const reset = h.controller.reset();
	assert.equal(h.calls[2].path, "/api/oculog/v2/learning/reset");
	h.calls[2].result.resolve(status(1));
	await reset;
	h.calls[1].result.resolve(answer());
	await pending;
	assert.equal(h.controller.getSnapshot().status?.generation, 1);
	assert.equal(h.controller.getSnapshot().feedback, null);
	assert.deepEqual(h.controller.getSnapshot().status?.progress, {});
	await h.controller.retry();
	assert.equal(h.calls.length, 3);
});
test("reset response from another account is ignored", async () => {
	const h = await loaded(),
		reset = h.controller.reset();
	h.setIdentity("two:token2");
	h.calls[1].result.resolve(status(1));
	await reset;
	assert.equal(h.controller.getSnapshot().status, null);
});
test("failed reset requires authoritative reload before any new answer", async () => {
	const h = await loaded(),
		reset = h.controller.reset();
	h.calls[1].result.reject(new Error("offline"));
	await reset;
	assert.equal(h.controller.getSnapshot().resetUncertain, true);
	await h.controller.answer(questions[0].id, "a");
	assert.equal(h.calls.length, 2);
	const reload = h.controller.load();
	h.calls[2].result.resolve(status(1));
	await reload;
	assert.equal(h.controller.getSnapshot().resetUncertain, false);
	const next = h.controller.answer(questions[0].id, "a");
	assert.equal(
		(h.calls[3].options?.body as Record<string, unknown>).generation,
		1,
	);
	h.calls[3].result.resolve(answer(1));
	await next;
});
test("unmount invalidates in-flight callbacks and allows clean remount", async () => {
	const h = harness(),
		pending = h.controller.load();
	h.controller.dispose();
	h.calls[0].result.resolve(status());
	await pending;
	assert.equal(h.controller.getSnapshot().status, null);
	h.controller.activate();
	const reload = h.controller.load();
	h.calls[1].result.resolve(status());
	await reload;
	assert.equal(h.controller.getSnapshot().status?.generation, 0);
});
test("API rejects response epochs and answers that do not match the submitted operation", async () => {
	const h = await loaded(),
		p = h.controller.answer(questions[0].id, "a");
	h.calls[1].result.resolve(answer(1));
	await p;
	assert.equal(h.controller.getSnapshot().feedback, null);
	assert.ok(h.controller.getSnapshot().pending);
	const reset = h.controller.reset();
	h.calls[2].result.resolve(status(0));
	await reset;
	assert.equal(h.controller.getSnapshot().resetUncertain, true);
});
test("screen uses existing accessible controls, inline confirmation, and no compiled bank", () => {
	const screen = readFileSync(
		new URL(
			"../../src/components/learning/learning-screen.tsx",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(screen, /<ScrollView/);
	assert.match(screen, /<Host/);
	assert.match(screen, /<Button\s+label=\{label\}/);
	assert.match(screen, /blocked \? \[disabled\(\)\]/);
	assert.doesNotMatch(screen, /<Pressable|ActivityIndicator/);
	assert.match(screen, /options are not care instructions/);
	assert.match(screen, /Confirm reset/);
	assert.match(screen, /Retry saving answer/);
	assert.doesNotMatch(
		screen,
		/learning_data|correct_option_id|autoFocus|ToolbarView|Animated/,
	);
});
