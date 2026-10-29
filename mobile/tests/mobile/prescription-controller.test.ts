import assert from "node:assert/strict";
import test from "node:test";
import { createPrescriptionController } from "../../src/lib/prescriptions/controller";
import {
	confirmPrescription,
	emptyDraft,
	type Prescription,
} from "../../src/lib/prescriptions/model";
import type { OCRResult } from "../../src/lib/prescriptions/ocr-parser";
import type { PrescriptionRepository } from "../../src/lib/prescriptions/repository";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const confirmed = () =>
	confirmPrescription(emptyDraft(), {
		id: "test",
		now: new Date(),
		contactLensConfirmed: true,
		reviewConfirmed: true,
	});
function fixture() {
	let session = { owner: "A", sessionKey: "token-1" };
	const load = deferred<Prescription | null>(),
		save = deferred<void>(),
		remove = deferred<void>();
	const writes: string[] = [];
	const repository: PrescriptionRepository = {
		load: () => load.promise,
		save: async (owner) => {
			writes.push(owner);
			await save.promise;
		},
		remove: () => remove.promise,
		subscribe: () => () => {},
	};
	const controller = createPrescriptionController(repository, () => session);
	return {
		controller,
		load,
		save,
		remove,
		writes,
		setSession: (owner: string, sessionKey: string) => {
			session = { owner, sessionKey };
		},
	};
}
test("load stale account/token completion never populates next session", async () => {
	for (const [owner, token] of [
		["B", "token-2"],
		["A", "token-2"],
	]) {
		const f = fixture();
		const pending = f.controller.load();
		f.setSession(owner, token);
		f.load.resolve(confirmed());
		await pending;
		assert.equal(f.controller.getState().record, null);
		assert.equal(f.controller.getState().loading, false);
	}
});
test("manual edits during load and OCR survive", async () => {
	const f = fixture();
	const load = f.controller.load();
	const draft = emptyDraft();
	draft.right.sphere = "-4";
	f.controller.setDraft(draft);
	f.load.resolve(confirmed());
	await load;
	assert.equal(f.controller.getState().draft.right.sphere, "-4");
	const ocr = deferred<OCRResult>();
	const scan = f.controller.scan(() => ocr.promise);
	draft.right.sphere = "-5";
	f.controller.setDraft(draft);
	ocr.resolve({
		pageCount: 1,
		lines: [
			{ text: "OD SPH -2", confidence: 1, x: 0, y: 0, width: 0.5, height: 0.1 },
		],
	});
	await scan;
	assert.equal(f.controller.getState().draft.right.sphere, "-5");
});
test("save lock is synchronous, stale owner completion cannot publish and write failures preserve record", async () => {
	const f = fixture();
	const options = {
		id: "x",
		now: new Date(),
		contactLensConfirmed: true,
		reviewConfirmed: true,
	};
	const first = f.controller.save(options);
	await f.controller.save(options);
	assert.deepEqual(f.writes, ["A"]);
	f.setSession("B", "token-2");
	f.save.resolve();
	await first;
	assert.equal(f.controller.getState().record, null);
	const g = fixture();
	const load = g.controller.load();
	g.load.resolve(confirmed());
	await load;
	const prior = g.controller.getState().record;
	const save = g.controller.save(options);
	g.save.reject(new Error("Keychain locked"));
	await save;
	assert.equal(g.controller.getState().record, prior);
	assert.match(g.controller.getState().error ?? "", /locked/);
});
test("controller reactivates after effect cleanup and does not accept anonymous drafts", async () => {
	const f = fixture();
	f.controller.dispose();
	f.controller.mount();
	const load = f.controller.load();
	f.load.resolve(confirmed());
	await load;
	assert.equal(f.controller.getState().record?.id, "test");
	f.setSession("", "");
	f.controller.syncSession();
	const draft = emptyDraft();
	draft.right.sphere = "-8";
	f.controller.setDraft(draft);
	assert.equal(f.controller.getState().draft.right.sphere, "");
});
test("scanner cancellation preserves existing details without an error", async () => {
	const f = fixture();
	const draft = emptyDraft();
	draft.left.sphere = "-2";
	f.controller.setDraft(draft);
	await f.controller.scan(async () => {
		throw Object.assign(new Error("cancelled"), { code: "OCR_CANCELLED" });
	});
	assert.equal(f.controller.getState().draft.left.sphere, "-2");
	assert.equal(f.controller.getState().error, null);
});
test("scan and delete stale token completions and errors are ignored", async () => {
	for (const operation of ["scan", "remove"] as const) {
		const f = fixture();
		const ocr = deferred<OCRResult>();
		const pending =
			operation === "scan"
				? f.controller.scan(() => ocr.promise)
				: f.controller.remove();
		f.setSession("A", "new-token");
		if (operation === "scan") ocr.reject(new Error("old failure"));
		else f.remove.resolve();
		await pending;
		assert.equal(f.controller.getState().error, null);
		assert.equal(f.controller.getState().busy, false);
	}
});
