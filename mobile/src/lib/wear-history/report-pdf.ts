import { monthDates, validDate } from "./model";
import {
	reportDayStatus,
	reportMonths,
	type WearReport,
	wearTotals,
} from "./report";

const invalid = (): never => {
	throw new Error("Invalid wear report data.");
};
function record(
	value: unknown,
	keys: string[],
): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

/** Reject incomplete calendars and contradictory counts before producing any bytes. */
function validate(report: WearReport): string[] {
	if (
		!record(report, ["from", "through", "timeZone", "days", "totals"]) ||
		!validDate(report.from) ||
		!validDate(report.through) ||
		report.from > report.through ||
		typeof report.timeZone !== "string" ||
		!/^[\x20-\x7e]{1,100}$/.test(report.timeZone) ||
		!Array.isArray(report.days)
	)
		return invalid();
	try {
		new Intl.DateTimeFormat("en", { timeZone: report.timeZone });
	} catch {
		return invalid();
	}
	const months = reportMonths(report.from, report.through);
	const dates = months
		.flatMap(monthDates)
		.filter((date) => date >= report.from && date <= report.through);
	if (dates.length !== report.days.length) return invalid();
	for (let i = 0; i < dates.length; i++) {
		const day = report.days[i];
		if (
			!record(day, ["localDate", "source", "worn"]) ||
			day.localDate !== dates[i] ||
			!(
				(day.source === "manual" && typeof day.worn === "boolean") ||
				(day.source === "unknown" && day.worn === null) ||
				(day.source === "assumed" &&
					day.worn === true &&
					day.localDate < report.through)
			)
		)
			return invalid();
	}
	const totals = wearTotals(report.days);
	const keys = Object.keys(totals) as (keyof typeof totals)[];
	if (
		!record(report.totals, keys) ||
		keys.some((key) => report.totals[key] !== totals[key])
	)
		return invalid();
	return months;
}

// All output is ASCII, so JavaScript character counts equal PDF byte offsets.
function literal(text: string): string {
	return text.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, "\\$&");
}
const ink = "0.12 0.19 0.22";
const muted = "0.35 0.42 0.45";
const accent = "0.08 0.36 0.35";
function text(
	x: number,
	y: number,
	size: number,
	value: string,
	bold = false,
	color = ink,
): string {
	return `${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${literal(value)}) Tj ET\n`;
}
function box(
	x: number,
	y: number,
	width: number,
	height: number,
	color: string,
): string {
	return `${color} rg ${x} ${y} ${width} ${height} re f\n`;
}
function footer(report: WearReport, page: number, count: number): string {
	return (
		box(48, 53, 499, 1, "0.84 0.88 0.88") +
		text(
			48,
			36,
			9,
			`${report.from} through ${report.through} (inclusive)`,
			false,
			muted,
		) +
		text(475, 36, 9, `Page ${page} of ${count}`, false, muted)
	);
}

/** Pure on-device PDF 1.4; no identifiers, metadata, network, or file-system access. */
export function createWearReportPdf(report: WearReport): Uint8Array {
	const months = validate(report);
	const count = months.length + 1;
	const range = `${report.from} through ${report.through} (inclusive)`;
	let cover =
		box(0, 812, 595, 30, accent) +
		text(48, 772, 11, "OCULOG / WEAR HISTORY", true, accent) +
		text(48, 721, 32, "Your wear report", true) +
		text(48, 687, 12, range) +
		text(48, 663, 11, `Account timezone: ${report.timeZone}`, false, muted) +
		text(48, 609, 15, "At a glance", true);
	const cards: [string, number][] = [
		["Confirmed worn", report.totals.confirmedWear],
		["Confirmed not worn", report.totals.confirmedNoWear],
		["Assumed worn", report.totals.assumedWear],
		["Unknown", report.totals.unknown],
	];
	cards.forEach(([label, value], i) => {
		const x = 48 + (i % 2) * 256;
		const y = 490 - Math.floor(i / 2) * 112;
		cover +=
			box(x, y, 243, 96, "0.94 0.96 0.96") +
			text(x + 16, y + 53, 28, String(value), true, accent) +
			text(x + 16, y + 23, 12, label);
	});
	cover +=
		text(
			48,
			335,
			11,
			`${report.days.length} calendar days / ${months.length} monthly pages`,
			false,
			muted,
		) + text(48, 285, 15, "How to read this report", true);
	[
		"Confirmed entries are manually recorded, not detected or medically verified.",
		"Assumed worn is an automatic assumption, not detected or confirmed wear.",
		"Unknown means not logged. It does not mean no wear.",
		"This is a historical snapshot, not medical advice.",
		"Recording logs does not change replacement dates or inventory.",
	].forEach((line, i) => {
		cover += text(48, 254 - i * 25, 11, line, false, muted);
	});
	const pages = [cover + footer(report, 1, count)];
	months.forEach((month, i) => {
		let content =
			box(0, 812, 595, 30, accent) +
			text(48, 774, 11, "WEAR HISTORY / DAILY LOG", true, accent) +
			text(48, 735, 26, month, true) +
			text(48, 708, 11, range, false, muted) +
			text(48, 687, 10, `Account timezone: ${report.timeZone}`, false, muted) +
			box(48, 643, 499, 25, accent) +
			text(60, 651, 10, "DATE", true, "1 1 1") +
			text(205, 651, 10, "STATUS", true, "1 1 1");
		report.days
			.filter((day) => day.localDate.startsWith(`${month}-`))
			.forEach((day, row) => {
				const y = 625 - row * 17;
				if (row % 2 === 0) content += box(48, y - 5, 499, 17, "0.95 0.97 0.97");
				content +=
					text(60, y, 10, day.localDate) +
					text(205, y, 10, reportDayStatus(day));
			});
		pages.push(content + footer(report, i + 2, count));
	});

	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Count ${count} /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
	];
	pages.forEach((content, i) => {
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`,
		);
		objects.push(
			`<< /Length ${content.length} >>\nstream\n${content}endstream`,
		);
	});
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	objects.forEach((object, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = pdf.length;
	pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1))
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return Uint8Array.from(pdf, (character) => character.charCodeAt(0));
}
