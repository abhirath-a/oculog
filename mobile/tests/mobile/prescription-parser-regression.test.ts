import assert from "node:assert/strict";
import test from "node:test";
import {
	type OCRLine,
	parsePrescriptionOCR,
} from "../../src/lib/prescriptions/ocr-parser";

// Synthetic normalized boxes only; no patient data.
const box = (
	text: string,
	x: number,
	y: number,
	width = 0.1,
	page = 0,
): OCRLine => ({ text, x, y, width, height: 0.03, confidence: 0.99, page });
const parse = (...lines: OCRLine[]) =>
	parsePrescriptionOCR({ lines, pageCount: 2 });
const headers = () => [box("SPH", 0.3, 0.1), box("CYL", 0.5, 0.1)];
const cells = (y = 0.2) => [box("-2.00", 0.3, y), box("-0.75", 0.5, y)];
const blankWithWarning = (result: ReturnType<typeof parse>) => {
	for (const side of ["right", "left"] as const) {
		assert.equal(result.draft[side].sphere, "");
		assert.equal(result.draft[side].cylinder, "");
	}
	assert.ok(result.warnings.some((w) => /geometry is ambiguous/i.test(w)));
};

test("same-y separate OD/OS anchors cannot both own one cell set", () => {
	const lines = [
		...headers(),
		box("OD", 0.05, 0.2),
		box("OS", 0.18, 0.2),
		...cells(),
	];
	blankWithWarning(parse(...lines));
	blankWithWarning(parse(...lines.reverse()));
	blankWithWarning(
		parse(
			...headers(),
			box("OD", 0.05, 0.2),
			{ ...box("OS", 0.18, 0.2), confidence: 0.5 },
			...cells(),
		),
	);
});

test("disjoint whole-line header panel cannot label numbers in a left panel", () => {
	blankWithWarning(
		parse(box("SPH CYL", 0.6, 0.1, 0.3), box("OD 8.6 14.2", 0.1, 0.2, 0.25)),
	);
	blankWithWarning(
		parse(
			box("SPH", 0.6, 0.1),
			box("CYL", 0.8, 0.1),
			box("OD", 0.01, 0.2, 0.05),
			box("8.6", 0.1, 0.2),
			box("14.2", 0.25, 0.2),
		),
	);
});

test("vertically separated eye anchors uniquely own their aligned table cells", () => {
	const result = parse(
		...headers(),
		box("OD", 0.05, 0.2),
		...cells(),
		box("OS", 0.05, 0.3),
		box("-3.00", 0.3, 0.3),
		box("-1.00", 0.5, 0.3),
	);
	assert.equal(result.draft.right.sphere, "-2.00");
	assert.equal(result.draft.left.sphere, "-3.00");
	assert.equal(result.draft.left.cylinder, "-1.00");
	assert.ok(!result.warnings.some((w) => /geometry/i.test(w)));
});

test("associated whole-line header and row remain supported", () => {
	const result = parse(
		box("SPH CYL", 0.1, 0.1, 0.7),
		box("OD -2.00 -0.75", 0.05, 0.2, 0.75),
	);
	assert.equal(result.draft.right.sphere, "-2.00");
	assert.equal(result.draft.right.cylinder, "-0.75");
});

test("side-by-side tables without provably unique ownership are not guessed", () => {
	blankWithWarning(
		parse(
			box("SPH", 0.15, 0.1),
			box("CYL", 0.3, 0.1),
			box("SPH", 0.65, 0.1),
			box("CYL", 0.8, 0.1),
			box("OD", 0.01, 0.2),
			box("OS", 0.51, 0.2),
			box("-2.00", 0.15, 0.2),
			box("-0.75", 0.3, 0.2),
			box("-3.00", 0.65, 0.2),
			box("-1.00", 0.8, 0.2),
		),
	);
	blankWithWarning(
		parse(
			box("SPH CYL", 0.1, 0.1, 0.7),
			box("OD -2.00 -0.75", 0.05, 0.2, 0.75),
			box("OS", 0.85, 0.2),
		),
	);
});

test("duplicate readings agree; conflicting table values stay blank", () => {
	const base = [...headers(), box("OD", 0.05, 0.2), ...cells()];
	assert.equal(parse(...base, ...cells()).draft.right.sphere, "-2.00");
	for (const readings of [
		[...cells(), box("-3.00", 0.3, 0.2)],
		[box("-3.00", 0.3, 0.2), ...cells()],
	]) {
		const result = parse(...headers(), box("OD", 0.05, 0.2), ...readings);
		assert.equal(result.draft.right.sphere, "");
		assert.equal(result.draft.right.cylinder, "-0.75");
		assert.ok(result.warnings.some((w) => /Conflicting readings/.test(w)));
	}
	blankWithWarning(
		parse(...base, box("SPH", 0.3, 0.08), box("CYL", 0.5, 0.08)),
	);
});

test("partial header overlap and inconsistent or duplicate headers remain ambiguous", () => {
	blankWithWarning(
		parse(
			box("SPH CYL", 0.4, 0.1, 0.4),
			box("OD -2.00 -0.75", 0.05, 0.2, 0.75),
		),
	);
	blankWithWarning(
		parse(
			box("SPH", 0.3, 0.1),
			box("CYL", 0.5, 0.15),
			box("OD", 0.05, 0.2),
			...cells(),
		),
	);
	blankWithWarning(
		parse(
			box("SPH CYL", 0.1, 0.1, 0.7),
			box("SPH CYL", 0.1, 0.08, 0.7),
			box("OD -2.00 -0.75", 0.05, 0.2, 0.75),
		),
	);
});

test("whole-line duplicates agree but conflicting readings cannot restore a value", () => {
	const header = box("SPH CYL", 0.1, 0.1, 0.7);
	const row = box("OD -2.00 -0.75", 0.05, 0.2, 0.75);
	assert.equal(
		parse(header, row, { ...row, y: 0.3 }).draft.right.sphere,
		"-2.00",
	);
	const result = parse(header, row, box("OD -3.00 -0.75", 0.05, 0.26, 0.75), {
		...row,
		y: 0.32,
	});
	assert.equal(result.draft.right.sphere, "");
	assert.ok(result.warnings.some((w) => /Conflicting readings/.test(w)));
});

test("geometry ambiguity does not suppress explicit inline labels or cross pages", () => {
	const result = parse(
		box("OD SPH -2.00", 0.01, 0.2, 0.4),
		box("OS SPH -3.00", 0.5, 0.2, 0.4),
	);
	assert.equal(result.draft.right.sphere, "-2.00");
	assert.equal(result.draft.left.sphere, "-3.00");
	const separatePages = parse(
		...headers(),
		box("OD", 0.05, 0.2),
		...cells(),
		box("OS", 0.05, 0.2, 0.1, 1),
	);
	assert.equal(separatePages.draft.right.sphere, "-2.00");
	assert.equal(separatePages.draft.left.sphere, "");
});
