import assert from "node:assert/strict";
import { test } from "node:test";
import { type HistoryDay, monthDates } from "../../src/lib/wear-history/model";
import {
	reportDayStatus,
	reportMonths,
	type WearReport,
	wearTotals,
} from "../../src/lib/wear-history/report";
import { createWearReportPdf } from "../../src/lib/wear-history/report-pdf";

function fixture(from = "2024-01-01", through = "2024-03-31"): WearReport {
	const states: Pick<HistoryDay, "source" | "worn">[] = [
		{ source: "manual", worn: true },
		{ source: "manual", worn: false },
		{ source: "assumed", worn: true },
		{ source: "unknown", worn: null },
	];
	const days = reportMonths(from, through)
		.flatMap(monthDates)
		.filter((date) => date >= from && date <= through)
		.map((localDate, i) => ({ localDate, ...states[i % 4]! }));
	// Assumptions must be strictly before the account's through date.
	days[days.length - 1] = { localDate: through, source: "unknown", worn: null };
	return {
		from,
		through,
		timeZone: "America/New_York",
		days,
		totals: wearTotals(days),
	};
}
function decode(report: WearReport): string {
	const bytes = createWearReportPdf(report);
	assert.ok(bytes instanceof Uint8Array);
	assert.ok(bytes.every((byte) => byte >= 10 && byte <= 126));
	return Buffer.from(bytes).toString("ascii");
}
function streams(pdf: string): string[] {
	return [...pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].map((match) => {
		const start = match.index! + match[0].length;
		const content = pdf.slice(start, start + Number(match[1]));
		assert.equal(
			pdf.slice(start + content.length, start + content.length + 9),
			"endstream",
		);
		return content;
	});
}

test("PDF framing: every byte offset, stream length, object reference and trailer", () => {
	const pdf = decode(fixture());
	assert.ok(pdf.startsWith("%PDF-1.4\n"));
	assert.ok(pdf.endsWith("%%EOF\n"));
	const xref = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)![1]);
	assert.equal(pdf.slice(xref, xref + 5), "xref\n");
	const entries = pdf.slice(xref).split("\n");
	const count = Number(entries[1]!.split(" ")[1]);
	assert.equal(entries[2], "0000000000 65535 f ");
	for (let id = 1; id < count; id++) {
		const entry = entries[id + 2]!;
		assert.match(entry, /^\d{10} 00000 n $/);
		assert.ok(
			pdf.slice(Number(entry.slice(0, 10))).startsWith(`${id} 0 obj\n`),
		);
	}
	assert.match(pdf, new RegExp(`trailer\\n<< /Size ${count} /Root 1 0 R >>`));
	const objectIds = [...pdf.matchAll(/^(\d+) 0 obj$/gm)].map((match) =>
		Number(match[1]),
	);
	assert.equal(objectIds.length, count - 1);
	for (const reference of pdf.matchAll(/\b(\d+) 0 R\b/g))
		assert.ok(objectIds.includes(Number(reference[1])));
	assert.equal(streams(pdf).length, 4);
	assert.equal([...pdf.matchAll(/\/Type \/Page\b/g)].length, 4);
	assert.match(pdf, /\/Type \/Pages \/Count 4/);
	assert.equal([...pdf.matchAll(/\/MediaBox \[0 0 595 842\]/g)].length, 4);
	assert.match(pdf, /\/BaseFont \/Helvetica >>/);
	assert.match(pdf, /\/BaseFont \/Helvetica-Bold >>/);
});

test("cover separates all counts and explains limits; monthly pages include every date and exact status", () => {
	const report = fixture();
	const pages = streams(decode(report));
	const cover = pages[0]!;
	for (const label of [
		"Confirmed worn",
		"Confirmed not worn",
		"Assumed worn",
		"Unknown",
	])
		assert.ok(cover.includes(`(${label})`));
	for (const value of Object.values(report.totals))
		assert.ok(cover.includes(`(${value})`));
	for (const explanation of [
		"not detected or confirmed wear",
		"does not mean no wear",
		"historical snapshot, not medical advice",
		"does not change replacement dates or inventory",
	])
		assert.ok(cover.includes(explanation));
	reportMonths(report.from, report.through).forEach((month, i) => {
		const page = pages[i + 1]!;
		assert.ok(page.includes(`(${month})`));
		const rows = report.days.filter((day) => day.localDate.startsWith(month));
		let previous = -1;
		for (const day of rows) {
			const position = page.indexOf(`(${day.localDate})`);
			assert.ok(position > previous);
			assert.ok(
				page
					.slice(position)
					.startsWith(
						`(${day.localDate}) Tj ET\n0.12 0.19 0.22 rg BT /F1 10 Tf 1 0 0 1 205`,
					),
			);
			assert.ok(
				page
					.slice(position, page.indexOf(" ET\n", page.indexOf("205", position)))
					.includes(`(${reportDayStatus(day)})`),
			);
			previous = position;
		}
		assert.equal(
			[...page.matchAll(/\(2024-\d{2}-\d{2}\) Tj/g)].length,
			rows.length,
		);
	});
	assert.ok(pages[2]!.includes("(2024-02-29)"));
	assert.equal(report.days.length, 91);
	for (let i = 0; i < pages.length; i++) {
		assert.ok(pages[i]!.includes(`(Page ${i + 1} of 4)`));
		assert.ok(
			pages[i]!.includes("2024-01-01 through 2024-03-31 \\(inclusive\\)"),
		);
		assert.ok(pages[i]!.includes("Account timezone: America/New_York"));
	}
});

test("partial months, single day, year boundary and full inclusive annual range", () => {
	for (const [from, through, pageCount] of [
		["2024-02-29", "2024-02-29", 2],
		["2023-12-30", "2024-01-02", 3],
		["2023-03-01", "2024-02-29", 13],
		["2023-06-19", "2024-06-18", 14],
	] as const) {
		const report = fixture(from, through);
		const pages = streams(decode(report));
		assert.equal(pages.length, pageCount);
		const dates = pages
			.slice(1)
			.flatMap((page) =>
				[...page.matchAll(/\((\d{4}-\d{2}-\d{2})\) Tj/g)].map(
					(match) => match[1],
				),
			);
		assert.deepEqual(
			dates,
			report.days.map((day) => day.localDate),
		);
	}
});

test("ASCII PDF literals escape parentheses and preserve valid timezone spelling", () => {
	for (const timeZone of [
		"UTC",
		"Etc/GMT+5",
		"Pacific/Chatham",
		"Asia/Kathmandu",
	]) {
		const report = { ...fixture(), timeZone };
		const pdf = decode(report);
		assert.ok(pdf.includes(`(Account timezone: ${timeZone})`));
		assert.ok(pdf.includes("\\(inclusive\\)"));
		// Every literal is closed; backslashes can only introduce a safe PDF escape.
		for (const match of pdf.matchAll(/\((?:\\.|[^()\\])*\) Tj/g)) {
			assert.doesNotMatch(match[0], /\\[^\\()]/);
		}
		assert.deepEqual(createWearReportPdf(report), createWearReportPdf(report));
	}
});

test("reject malformed, injected or inconsistent reports rather than export misleading data", () => {
	const changes: ((report: WearReport) => unknown)[] = [
		() => null,
		() => [],
		() => ({}),
		(report) => ({ ...report, from: "2024-02-30" }),
		(report) => ({ ...report, through: "2023-12-31" }),
		(report) => ({ ...report, through: "2026-01-01" }),
		(report) => ({ ...report, days: report.days.slice(1) }),
		(report) => ({ ...report, days: [...report.days].reverse() }),
		(report) => {
			report.days[1] = report.days[0]!;
			return report;
		},
		(report) => {
			delete (report.days as unknown[])[0];
			return report;
		},
		(report) => {
			report.days[0]!.worn = null;
			return report;
		},
		(report) => {
			report.days[2]!.worn = false;
			return report;
		},
		(report) => {
			report.days[3]!.worn = true;
			return report;
		},
		(report) => {
			report.days.at(-1)!.source = "assumed";
			report.days.at(-1)!.worn = true;
			report.totals = wearTotals(report.days);
			return report;
		},
		(report) => ({ ...report, totals: { ...report.totals, unknown: -1 } }),
		(report) => ({ ...report, totals: { ...report.totals, unknown: NaN } }),
		(report) => ({ ...report, totals: { ...report.totals, unknown: "23" } }),
		(report) => ({ ...report, email: "private@example.com" }),
		(report) => {
			Object.assign(report.days[0]!, { note: "private" });
			return report;
		},
		...[
			"",
			"Not/AZone",
			"UTC) Tj (injection",
			"UTC\\",
			"UTC\n",
			"UTC\u0000",
			"Asia/東京",
			"a".repeat(101),
		].map((timeZone) => (report: WearReport) => ({ ...report, timeZone })),
	];
	for (const change of changes)
		assert.throws(() => createWearReportPdf(change(fixture()) as WearReport));
});
