import { isCalendarDate } from "./calendar";
export type EyeValues = {
	sphere: string;
	cylinder: string;
	axis: string;
	baseCurve: string;
	diameter: string;
	add: string;
	lensName: string;
};
export type PrescriptionDraft = {
	expiresOn: string;
	right: EyeValues;
	left: EyeValues;
};
export type Prescription = {
	version: 1;
	id: string;
	confirmedAt: string;
	expiresOn: string | null;
	right: EyeValues;
	left: EyeValues;
};
export const EYE_FIELDS = [
	"sphere",
	"cylinder",
	"axis",
	"baseCurve",
	"diameter",
	"add",
	"lensName",
] as const;
export const MAX_RECORD_BYTES = 1800;
const eye = (): EyeValues => ({
	sphere: "",
	cylinder: "",
	axis: "",
	baseCurve: "",
	diameter: "",
	add: "",
	lensName: "",
});
export function emptyDraft(): PrescriptionDraft {
	return { expiresOn: "", right: eye(), left: eye() };
}
export function draftFromPrescription(record: Prescription): PrescriptionDraft {
	return {
		expiresOn: record.expiresOn ?? "",
		right: { ...record.right },
		left: { ...record.left },
	};
}
export class PrescriptionValidationError extends Error {
	constructor(public readonly errors: Record<string, string>) {
		super(Object.values(errors).join(" "));
		this.name = "PrescriptionValidationError";
	}
}
function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function exact(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	return (
		Object.keys(value).length === keys.length &&
		keys.every((k) => Object.hasOwn(value, k))
	);
}
/** Structural text normalization only. No power conversions or clinical ranges. Throws bounded field errors. */
export function validateDraft(input: unknown): PrescriptionDraft {
	const errors: Record<string, string> = {};
	const out = emptyDraft();
	if (!object(input) || !exact(input, ["expiresOn", "right", "left"]))
		throw new PrescriptionValidationError({
			draft: "Only prescription fields are accepted.",
		});
	if (
		typeof input.expiresOn !== "string" ||
		(input.expiresOn !== "" && !isCalendarDate(input.expiresOn))
	)
		errors.expiresOn =
			"Expiry must be an exact YYYY-MM-DD calendar date, or empty for unknown.";
	else out.expiresOn = input.expiresOn;
	for (const side of ["right", "left"] as const) {
		const values = input[side];
		if (!object(values) || !exact(values, EYE_FIELDS)) {
			errors[side] = "Only the documented eye fields are accepted.";
			continue;
		}
		for (const field of EYE_FIELDS) {
			const raw = values[field];
			const key = `${side}.${field}`;
			if (
				typeof raw !== "string" ||
				raw.length > (field === "lensName" ? 48 : 16)
			) {
				errors[key] = `${key} is too long or is not text.`;
				continue;
			}
			let text = raw.trim().replace(/\u2212/g, "-");
			if (field === "lensName") {
				if (
					[...text].some(
						(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
					)
				)
					errors[key] = "Lens name must be plain text.";
			} else {
				text = text.replace(/^(\+|-)?(\d*),(\d+)$/, "$1$2.$3");
				const number = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
				const named =
					(field === "sphere" && /^plano$/i.test(text)) ||
					(field === "add" && /^(low|med|medium|high)$/i.test(text));
				if (text && !number.test(text) && !named)
					errors[key] =
						`${key} must be numeric text${field === "sphere" ? " or Plano" : field === "add" ? " or a named ADD level" : ""}.`;
				if (field === "axis" && text && !/^\d{1,3}$/.test(text))
					errors[key] = "Axis must be whole-degree text.";
			}
			out[side][field] = text;
		}
	}
	if (Object.keys(errors).length) throw new PrescriptionValidationError(errors);
	return out;
}
export function utf8Bytes(text: string): number {
	let bytes = 0;
	for (const char of text) {
		const n = char.codePointAt(0) ?? 0;
		bytes += n <= 0x7f ? 1 : n <= 0x7ff ? 2 : n <= 0xffff ? 3 : 4;
	}
	return bytes;
}
export function confirmPrescription(
	draft: PrescriptionDraft,
	options: {
		id: string;
		now: Date;
		contactLensConfirmed: boolean;
		reviewConfirmed: boolean;
	},
): Prescription {
	if (options.contactLensConfirmed !== true || options.reviewConfirmed !== true)
		throw new PrescriptionValidationError({
			confirmation:
				"Confirm contact-lens prescription and review against the original before saving.",
		});
	if (
		typeof options.id !== "string" ||
		!/^[A-Za-z0-9_-]{1,80}$/.test(options.id)
	)
		throw new Error("Invalid prescription identifier.");
	if (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime()))
		throw new Error("Invalid confirmation time.");
	const value = validateDraft(draft);
	const record: Prescription = {
		version: 1,
		id: options.id,
		confirmedAt: options.now.toISOString(),
		...value,
		expiresOn: value.expiresOn || null,
	};
	if (utf8Bytes(JSON.stringify(record)) >= MAX_RECORD_BYTES)
		throw new Error(
			"Prescription exceeds the device storage limit. Shorten lens names.",
		);
	return record;
}
export function validatePrescription(value: unknown): Prescription {
	if (
		!object(value) ||
		!exact(value, [
			"version",
			"id",
			"confirmedAt",
			"expiresOn",
			"right",
			"left",
		]) ||
		value.version !== 1 ||
		typeof value.confirmedAt !== "string" ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.confirmedAt) ||
		!isCalendarDate(value.confirmedAt.slice(0, 10)) ||
		!Number.isFinite(new Date(value.confirmedAt).getTime()) ||
		(value.expiresOn !== null && typeof value.expiresOn !== "string")
	)
		throw new Error("Stored prescription is invalid; it has not been deleted.");
	const record = confirmPrescription(
		{
			expiresOn: value.expiresOn ?? "",
			right: value.right,
			left: value.left,
		} as PrescriptionDraft,
		{
			id: value.id as string,
			now: new Date(value.confirmedAt),
			contactLensConfirmed: true,
			reviewConfirmed: true,
		},
	);
	if (record.confirmedAt !== value.confirmedAt)
		throw new Error("Invalid confirmation timestamp.");
	return record;
}
