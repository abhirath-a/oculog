import assert from "node:assert/strict";
import test from "node:test";
import {
	calendarDaysBetween,
	deviceCalendarDate,
	isCalendarDate,
	shiftCalendarDate,
} from "../../src/lib/prescriptions/calendar";
import {
	confirmPrescription,
	emptyDraft,
	utf8Bytes,
	validateDraft,
	validatePrescription,
} from "../../src/lib/prescriptions/model";
import {
	type OCRLine,
	parsePrescriptionOCR,
} from "../../src/lib/prescriptions/ocr-parser";
import { createPrescriptionRepository } from "../../src/lib/prescriptions/repository";

const line = (text: string, y = 0.1, confidence = 0.99): OCRLine => ({
	text,
	y,
	confidence,
	x: 0.05,
	width: 0.8,
	height: 0.03,
});
const parse = (...lines: OCRLine[]) =>
	parsePrescriptionOCR({ pageCount: 1, lines });
const record = () =>
	confirmPrescription(emptyDraft(), {
		id: "fixture",
		now: new Date("2026-01-01T00:00:00.000Z"),
		contactLensConfirmed: true,
		reviewConfirmed: true,
	});
test("strict literal Gregorian dates and DST-independent arithmetic", () => {
	for (const date of ["2024-02-29", "2000-02-29", "2026-03-08"])
		assert.ok(isCalendarDate(date));
	for (const date of [
		"1900-02-29",
		"2026-02-29",
		"2026-04-31",
		"2026-3-01",
		"2026-03",
		"0000-01-01",
	])
		assert.equal(isCalendarDate(date), false);
	assert.equal(shiftCalendarDate("2026-03-08", 1), "2026-03-09");
	assert.equal(calendarDaysBetween("2026-03-07", "2026-03-10"), 3);
	assert.equal(deviceCalendarDate(new Date(2026, 2, 8, 12)), "2026-03-08");
});
test("strict fields, explicit confirmations, conservative text and UTF8 cap", () => {
	const draft = emptyDraft();
	draft.right.sphere = "−2,50";
	draft.left.sphere = "Plano";
	draft.left.add = "High";
	assert.equal(validateDraft(draft).right.sphere, "-2.50");
	assert.equal(validateDraft(draft).right.cylinder, "");
	assert.throws(() => validateDraft({ ...draft, diagnosis: "invented" }));
	assert.throws(() =>
		validateDraft({ ...draft, right: { ...draft.right, expiry: "invented" } }),
	);
	assert.throws(() =>
		confirmPrescription(draft, {
			id: "x",
			now: new Date(),
			contactLensConfirmed: false,
			reviewConfirmed: true,
		}),
	);
	assert.equal(validatePrescription(record()).expiresOn, null);
	assert.equal(utf8Bytes("aé😀"), 7);
	draft.right.lensName = "😀".repeat(24);
	draft.left.lensName = "😀".repeat(24);
	assert.ok(
		utf8Bytes(
			JSON.stringify(
				confirmPrescription(draft, {
					id: "x",
					now: new Date(),
					contactLensConfirmed: true,
					reviewConfirmed: true,
				}),
			),
		) < 1800,
	);
	assert.throws(() => validatePrescription({ ...record(), rawOCR: "private" }));
});
test("explicit inline shuffled eyes and signed decimal comma powers", () => {
	const result = parse(
		line("OS SPH −2,50 CYL -0.75 AXIS 90 ADD Low"),
		line("OD PWR Plano BC 8.6 DIA 14.2", 0.2),
	);
	assert.equal(result.draft.left.sphere, "-2.50");
	assert.equal(result.draft.left.cylinder, "-0.75");
	assert.equal(result.draft.right.sphere, "Plano");
	assert.equal(result.draft.right.diameter, "14.2");
});
test("clear full-line table header and shuffled rows", () => {
	const result = parse(
		line("SPH CYL AXIS BC DIA ADD", 0.1),
		line("OS -2.00 -0.75 90 8.6 14.2 Low", 0.2),
		line("OD Plano -0.50 80 8.5 14.0 High", 0.3),
	);
	assert.equal(result.draft.left.sphere, "-2.00");
	assert.equal(result.draft.right.add, "High");
});
test("unlabeled, OU, low confidence and conflicting readings do not invent values", () => {
	assert.equal(parse(line("-2.00 90 8.6")).draft.right.sphere, "");
	assert.equal(parse(line("OU SPH -2.00")).draft.left.sphere, "");
	assert.equal(parse(line("OD SPH -2.00", 0.1, 0.7)).draft.right.sphere, "");
	assert.equal(
		parse(line("OD SPH -2.00"), line("OD SPH -3.00", 0.2)).draft.right.sphere,
		"",
	);
	assert.equal(
		parsePrescriptionOCR({
			pageCount: 1,
			lines: [{ ...line("OD SPH 2"), x: NaN }],
		}).draft.right.sphere,
		"",
	);
});
test("expiry excludes DOB and issue, ambiguous and month-only require correction", () => {
	assert.equal(
		parse(line("DOB 2000-01-01"), line("Issue 2026-01-01", 0.2)).draft
			.expiresOn,
		"",
	);
	assert.equal(parse(line("Expiry 2028-02-29")).draft.expiresOn, "2028-02-29");
	const ambiguous = parse(line("Expires 03/04/2028"));
	assert.equal(ambiguous.draft.expiresOn, "");
	assert.equal(ambiguous.expiryCandidates.length, 2);
	assert.equal(parse(line("Expiry 04/2028")).draft.expiresOn, "");
	assert.equal(parse(line("Expiry 2027-02-29")).draft.expiresOn, "");
	assert.equal(parse(line("Expires 13/04/2028")).draft.expiresOn, "2028-04-13");
});
test("repository serializes, snapshots owner and recovers from write/read failures without deleting", async () => {
	const values = new Map<string, string>();
	const keys: string[] = [];
	let fail = true;
	let notices = 0;
	const repo = createPrescriptionRepository({
		async keyForOwner(owner) {
			keys.push(owner);
			return `hash-${owner}`;
		},
		async getItem(key) {
			return values.get(key) ?? null;
		},
		async setItem(key, value) {
			if (fail) throw new Error("locked");
			values.set(key, value);
		},
		async removeItem(key) {
			values.delete(key);
		},
	});
	repo.subscribe(() => notices++);
	await assert.rejects(repo.save("A", record()), /locked/);
	assert.equal(notices, 0);
	fail = false;
	await Promise.all([repo.save("A", record()), repo.save("B", record())]);
	assert.equal((await repo.load("A"))?.id, "fixture");
	assert.equal(notices, 2);
	assert.deepEqual(keys.slice(0, 3), ["A", "A", "B"]);
	values.set("hash-A", '{"private":"invalid"}');
	await assert.rejects(repo.load("A"), /not been deleted/);
	assert.ok(values.has("hash-A"));
	await repo.remove("A");
	assert.equal(await repo.load("A"), null);
});
