import type { SimpleState } from "../../../shared/simple-domain";
import { positiveInteger } from "../../lib/simple-controller";

export type ScheduleDraft = {
	leftDays: string;
	rightDays: string;
	leftOpened: string;
	rightOpened: string;
	differentIntervals: boolean;
	differentDates: boolean;
};

export function initialDraft(state: SimpleState): ScheduleDraft {
	const left = state.eyes.find((eye) => eye.eye === "left");
	const right = state.eyes.find((eye) => eye.eye === "right");
	if (!left || !right) throw new Error("Both eye settings are required.");
	return {
		leftDays: left.replacementDays === null ? "" : String(left.replacementDays),
		rightDays:
			right.replacementDays === null ? "" : String(right.replacementDays),
		leftOpened: left.openedOn || "",
		rightOpened: right.openedOn || "",
		differentIntervals: left.replacementDays !== right.replacementDays,
		differentDates: left.openedOn !== right.openedOn,
	};
}

export class ScheduleValidationError extends Error {
	constructor(
		public readonly field: keyof ScheduleDraft,
		message: string,
	) {
		super(message);
		this.name = "ScheduleValidationError";
	}
}

function openedDate(raw: string) {
	const value = raw.trim();
	if (!value) return null;
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
		!Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
		new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
	) {
		throw new Error("Use a valid opened date in YYYY-MM-DD format.");
	}
	return value;
}

export function scheduleCommands(
	draft: ScheduleDraft,
	timeZone: string,
	today?: string,
) {
	const interval = (
		value: string,
		label: string,
		field: "leftDays" | "rightDays",
	) => {
		let days: number;
		try {
			days = positiveInteger(value);
		} catch {
			throw new ScheduleValidationError(
				field,
				`${label}: enter a whole number from 1 to 365.`,
			);
		}
		if (days > 365)
			throw new ScheduleValidationError(
				field,
				`${label}: replacement intervals must be between 1 and 365 days.`,
			);
		return days;
	};
	const leftDays = interval(
		draft.leftDays,
		draft.differentIntervals ? "Left interval" : "Interval",
		"leftDays",
	);
	const rightDays = draft.differentIntervals
		? interval(draft.rightDays, "Right interval", "rightDays")
		: leftDays;
	const date = (
		value: string,
		label: string,
		field: "leftOpened" | "rightOpened",
	) => {
		try {
			const opened = openedDate(value);
			if (opened && today && opened > today) throw new Error("Future date");
			return opened;
		} catch {
			throw new ScheduleValidationError(
				field,
				`${label}: use a valid opened date in YYYY-MM-DD format, no later than today.`,
			);
		}
	};
	return [
		{
			eye: "left" as const,
			replacementDays: leftDays,
			openedOn: date(
				draft.leftOpened,
				draft.differentDates ? "Left lens" : "Opened date",
				"leftOpened",
			),
			timeZone,
		},
		{
			eye: "right" as const,
			replacementDays: rightDays,
			openedOn: date(
				draft.differentDates ? draft.rightOpened : draft.leftOpened,
				"Right lens",
				draft.differentDates ? "rightOpened" : "leftOpened",
			),
			timeZone,
		},
	];
}
