import { isCalendarDate } from "./calendar";
import {
	type EyeValues,
	emptyDraft,
	type PrescriptionDraft,
	validateDraft,
} from "./model";
export type OCRLine = {
	text: string;
	confidence: number;
	x: number;
	y: number;
	width: number;
	height: number;
	page?: number;
};
export type OCRResult = { lines: OCRLine[]; pageCount: number };
const labelPattern = "SPH(?:ERE)?|PWR|CYL(?:INDER)?|AXIS|BC|DIA(?:METER)?|ADD";
const fieldFor = (label: string): keyof EyeValues =>
	(
		({
			SPH: "sphere",
			SPHERE: "sphere",
			PWR: "sphere",
			CYL: "cylinder",
			CYLINDER: "cylinder",
			AXIS: "axis",
			BC: "baseCurve",
			DIA: "diameter",
			DIAMETER: "diameter",
			ADD: "add",
		}) as Record<string, keyof EyeValues>
	)[label.toUpperCase()] ?? "sphere";
const eyePattern = /\b(OD|OS|RIGHT|LEFT)\b/gi;
const token =
	"([+−-]?(?:\\d+(?:[.,]\\d+)?|[.,]\\d+)|Plano|Low|Medium|Med|High)";
export function parsePrescriptionOCR(result: OCRResult): {
	draft: PrescriptionDraft;
	expiryCandidates: { date: string; label: string }[];
	warnings: string[];
} {
	const draft = emptyDraft(),
		warnings = new Set<string>(),
		candidates = new Map<string, string>();
	const output = () => ({
		draft,
		expiryCandidates: [...candidates].map(([date, label]) => ({ date, label })),
		warnings: [...warnings],
	});
	if (
		!result ||
		!Number.isInteger(result.pageCount) ||
		result.pageCount < 1 ||
		result.pageCount > 3 ||
		!Array.isArray(result.lines) ||
		result.lines.length > 500
	) {
		warnings.add(
			"OCR result is malformed or exceeds document limits. Enter values manually.",
		);
		return output();
	}
	const validLine = (line: OCRLine) =>
		line &&
		typeof line.text === "string" &&
		line.text.length <= 500 &&
		["confidence", "x", "y", "width", "height"].every(
			(k) =>
				typeof line[k as keyof OCRLine] === "number" &&
				Number.isFinite(line[k as keyof OCRLine] as number),
		) &&
		line.confidence >= 0 &&
		line.confidence <= 1 &&
		line.x >= 0 &&
		line.y >= 0 &&
		line.width > 0 &&
		line.height > 0 &&
		line.x + line.width <= 1.01 &&
		line.y + line.height <= 1.01 &&
		(line.page === undefined ||
			(Number.isInteger(line.page) &&
				line.page >= 0 &&
				line.page < result.pageCount));
	if (!result.lines.every(validLine)) {
		warnings.add("OCR geometry is malformed. Enter values manually.");
		return output();
	}
	const lines = result.lines.filter((l) => {
		if (l.confidence < 0.8) {
			warnings.add("Low-confidence text was not used.");
			return false;
		}
		return true;
	});
	const seen = new Map<string, string>();
	const conflicts = new Set<string>();
	function put(side: "right" | "left", field: keyof EyeValues, value: string) {
		const test = emptyDraft();
		test[side][field] = value;
		try {
			value = validateDraft(test)[side][field];
		} catch {
			warnings.add("A labeled value could not be read safely.");
			return;
		}
		const key = `${side}.${field}`;
		if (conflicts.has(key)) return;
		const prior = seen.get(key);
		if (prior !== undefined && prior.toLowerCase() !== value.toLowerCase()) {
			draft[side][field] = "";
			conflicts.add(key);
			warnings.add("Conflicting readings require manual review.");
			return;
		}
		seen.set(key, value);
		draft[side][field] = value;
	}
	let uncertainExpiry = false;
	for (const line of lines) {
		const text = line.text;
		if (
			/\b(expir(?:y|es|ation)|valid\s+(?:until|through|to))\b/i.test(text) &&
			!/\b(DOB|birth|issued?|exam)\b/i.test(text)
		) {
			const iso = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
			let found = false;
			for (const date of iso)
				if (isCalendarDate(date)) {
					candidates.set(date, "Labeled expiry — review original");
					found = true;
				}
			for (const match of text.matchAll(
				/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g,
			)) {
				const a = Number(match[1]),
					b = Number(match[2]),
					year = match[3];
				const choices = new Set(
					[
						`${year}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`,
						`${year}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`,
					].filter(isCalendarDate),
				);
				for (const date of choices)
					candidates.set(
						date,
						choices.size > 1
							? "Ambiguous numeric expiry — choose against original"
							: "Labeled expiry — review original",
					);
				if (choices.size !== 1) uncertainExpiry = true;
				found ||= choices.size > 0;
			}
			if (!found) {
				uncertainExpiry = true;
				warnings.add(
					"Expiry needs an exact calendar date from the prescriber.",
				);
			}
		}
		if (/\bOU\b/i.test(text)) {
			warnings.add("OU-only values were not assigned to either eye.");
			continue;
		}
		const eyes = [...text.matchAll(eyePattern)];
		for (let i = 0; i < eyes.length; i++) {
			const match = eyes[i];
			if (!match) continue;
			const side = /^(OD|RIGHT)$/i.test(match[0]) ? "right" : "left";
			const segment = text.slice(
				(match.index ?? 0) + match[0].length,
				eyes[i + 1]?.index ?? text.length,
			);
			for (const value of segment.matchAll(
				new RegExp(
					`\\b(${labelPattern})\\b\\s*[:=]?\\s*${token}(?=\\s|$|;)`,
					"gi",
				),
			))
				put(side, fieldFor(value[1] ?? ""), value[2] ?? "");
		}
	}
	const geometryWarning = () =>
		warnings.add("Table geometry is ambiguous. Enter values manually.");
	const sameRow = (a: OCRLine, b: OCRLine) =>
		(a.page ?? 0) === (b.page ?? 0) &&
		Math.abs(a.y + a.height / 2 - (b.y + b.height / 2)) <
			Math.max(a.height, b.height) * 0.5;
	const eyeRows = result.lines.filter((l) =>
		/\b(OD|OS|RIGHT|LEFT|OU)\b/i.test(l.text),
	);
	const uniqueOwner = (row: OCRLine, cell: OCRLine) => {
		const owners = eyeRows.filter((anchor) => sameRow(anchor, cell));
		return (
			owners.length === 1 &&
			owners[0] === row &&
			[...row.text.matchAll(/\b(OD|OS|RIGHT|LEFT|OU)\b/gi)].length === 1
		);
	};
	const overlaps = (a: OCRLine, b: OCRLine) =>
		a.x < b.x + b.width && b.x < a.x + a.width;
	// Whole-line tables: the ordered numeric cells must lie beneath the header span.
	for (const row of lines) {
		const match = row.text.trim().match(/^(OD|OS|RIGHT|LEFT)\s+(.+)$/i);
		if (!match || /\bOU\b/i.test(row.text)) continue;
		const cells = (match[2] ?? "").trim().split(/\s+/);
		if (!cells.every((c) => new RegExp(`^${token}$`, "i").test(c))) continue;
		if (!uniqueOwner(row, row)) {
			geometryWarning();
			continue;
		}
		// Whole-line OCR has no word boxes: estimate numeric centers from text
		// positions, and require every center to overlap the header's horizontal span.
		// Column identity comes from the exact count and explicit label order.
		const numericCenters = [...row.text.trim().matchAll(/\S+/g)]
			.slice(1)
			.map(
				(cell) =>
					row.x +
					(row.width * (cell.index + cell[0].length / 2)) /
						row.text.trim().length,
			);
		const headers = lines.filter(
			(h) =>
				(h.page ?? 0) === (row.page ?? 0) &&
				h.y + h.height <= row.y + 0.005 &&
				row.y - h.y < 0.25 &&
				h.text.trim().split(/\s+/).length === cells.length &&
				h.text
					.trim()
					.split(/\s+/)
					.every((c) => new RegExp(`^(${labelPattern})$`, "i").test(c)),
		);
		const associated = headers.filter((h) =>
			numericCenters.every(
				(center) => center >= h.x && center <= h.x + h.width,
			),
		);
		if (associated.length !== 1) {
			geometryWarning();
			continue;
		}
		const header = associated[0];
		if (!header) continue;
		const fields = header.text.trim().split(/\s+/).map(fieldFor);
		if (new Set(fields).size !== fields.length) {
			geometryWarning();
			continue;
		}
		const side = /^(OD|RIGHT)$/i.test(match[1] ?? "") ? "right" : "left";
		fields.forEach((field, i) => {
			put(side, field, cells[i] ?? "");
		});
	}
	// Table cells must form a distinct row, with explicit headers above each column.
	for (const row of lines) {
		const match = row.text.trim().match(/^(OD|OS|RIGHT|LEFT)\s*:?$/i);
		if (!match) continue;
		const side = /^(OD|RIGHT)$/i.test(match[1] ?? "") ? "right" : "left";
		const headers = lines.filter(
			(l) =>
				(l.page ?? 0) === (row.page ?? 0) &&
				l.y + l.height <= row.y + 0.005 &&
				row.y - l.y < 0.25 &&
				new RegExp(`^(${labelPattern})$`, "i").test(l.text.trim()),
		);
		if (headers.length < 2) {
			geometryWarning();
			continue;
		}
		for (const cell of lines.filter(
			(l) =>
				l !== row &&
				sameRow(l, row) &&
				new RegExp(`^${token}$`, "i").test(l.text.trim()),
		)) {
			if (!uniqueOwner(row, cell) || cell.x < row.x + row.width) {
				geometryWarning();
				continue;
			}
			const matching = headers.filter(
				(h) =>
					overlaps(h, cell) &&
					cell.x + cell.width / 2 >= h.x &&
					cell.x + cell.width / 2 <= h.x + h.width,
			);
			const header = matching.length === 1 ? matching[0] : undefined;
			if (
				header &&
				headers.some(
					(peer) =>
						peer !== header &&
						sameRow(peer, header) &&
						fieldFor(peer.text.trim()) !== fieldFor(header.text.trim()),
				)
			)
				put(side, fieldFor(header.text.trim()), cell.text.trim());
			else geometryWarning();
		}
	}
	if (candidates.size === 1 && !uncertainExpiry)
		draft.expiresOn = [...candidates.keys()][0] ?? "";
	else if (candidates.size > 1 || uncertainExpiry)
		warnings.add(
			"Expiry was not selected: resolve ambiguity against the original.",
		);
	warnings.add(
		"OCR suggestions are unconfirmed. Check every value against the original.",
	);
	return output();
}
