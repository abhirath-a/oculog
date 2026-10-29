import type { SimpleState } from "../../../shared/simple-domain";
import {
	deviceCalendarDate,
	isCalendarDate,
	shiftCalendarDate,
} from "../prescriptions/calendar";
import type { Prescription } from "../prescriptions/model";

export type ReminderKind = "daily" | "replacement" | "prescription";
export type ReminderPreferences = { version: 1 } & Record<
	ReminderKind,
	{ enabled: boolean; hour: number; minute: number }
>;
export type ReminderSnapshot = {
	owner: string | null;
	sessionKey: string | null;
	state: SimpleState | null;
	prescription: Prescription | null;
};
export const FEATURE = "oculog.local-reminders.v1";
export const KINDS: ReminderKind[] = ["daily", "replacement", "prescription"];
export function defaultPreferences(): ReminderPreferences {
	return {
		version: 1,
		daily: { enabled: false, hour: 21, minute: 0 },
		replacement: { enabled: false, hour: 9, minute: 0 },
		prescription: { enabled: false, hour: 9, minute: 0 },
	};
}
export function validatePreferences(value: unknown): ReminderPreferences {
	if (
		!value ||
		typeof value !== "object" ||
		(value as ReminderPreferences).version !== 1
	)
		throw new Error("Invalid reminder preferences.");
	const result = defaultPreferences();
	for (const kind of KINDS) {
		const item = (value as ReminderPreferences)[kind];
		if (
			!item ||
			typeof item.enabled !== "boolean" ||
			!Number.isInteger(item.hour) ||
			item.hour < 0 ||
			item.hour > 23 ||
			!Number.isInteger(item.minute) ||
			item.minute < 0 ||
			item.minute > 59
		)
			throw new Error("Invalid reminder time or switch.");
		result[kind] = {
			enabled: item.enabled,
			hour: item.hour,
			minute: item.minute,
		};
	}
	return result;
}
export type ReminderPlan = {
	id: string;
	kind: ReminderKind;
	title: string;
	body: string;
	/** Internal ledger coverage; adapters hash these before any native payload. */
	receiptKeys?: string[];
	retainReceiptKeys?: string[];
	skipIfCovered?: string[][];
	trigger:
		| { type: "daily"; hour: number; minute: number }
		| { type: "date"; date: Date };
};
export const DAILY_NOTICE =
	"Daily check-ins may still arrive after you log. Reminders use device time and the last saved schedule.";
function localTime(day: string, hour: number, minute: number): Date {
	const [year = 0, month = 0, date = 0] = day.split("-").map(Number);
	const result = new Date(0);
	result.setFullYear(year, month - 1, date);
	result.setHours(hour, minute, 0, 0);
	return result;
}
function nextTime(now: Date, hour: number, minute: number): Date {
	const today = deviceCalendarDate(now);
	const time = localTime(today, hour, minute);
	return time.getTime() > now.getTime()
		? time
		: localTime(shiftCalendarDate(today, 1), hour, minute);
}
export function buildReminderPlans(
	snapshot: ReminderSnapshot,
	prefs: ReminderPreferences,
	now: Date,
): ReminderPlan[] {
	if (!snapshot.owner || !snapshot.sessionKey) return [];
	const plans: ReminderPlan[] = [];
	const today = deviceCalendarDate(now);
	const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const add = (
		kind: ReminderKind,
		identity: string,
		date: Date,
		coverage: Pick<
			ReminderPlan,
			"receiptKeys" | "retainReceiptKeys" | "skipIfCovered"
		> = {},
	) => {
		const time = prefs[kind];
		plans.push({
			id: `${kind}:${identity}:${time.hour}:${time.minute}:${zone}`,
			kind,
			title: "Oculog",
			body:
				kind === "replacement"
					? "Review your lens replacement schedule."
					: "Book an eye-care appointment to review your prescription.",
			trigger: { type: "date", date },
			...coverage,
		});
	};
	if (prefs.daily.enabled)
		plans.push({
			id: `daily:${prefs.daily.hour}:${prefs.daily.minute}:${zone}`,
			kind: "daily",
			title: "Oculog",
			body: "Take a moment to review your lens log.",
			trigger: {
				type: "daily",
				hour: prefs.daily.hour,
				minute: prefs.daily.minute,
			},
		});
	if (prefs.replacement.enabled && snapshot.state) {
		if (snapshot.state.eyes.length > 2)
			throw new Error(
				"Replacement reminders require a paired-eye saved schedule.",
			);
		const groups = new Map<
			string,
			{ eyes: string[]; coverage: string[]; retain: string[] }
		>();
		const overdue: string[] = [];
		const overdueCoverage: string[][] = [];
		for (const eye of snapshot.state.eyes) {
			if (
				!eye.id ||
				!eye.openedOn ||
				!isCalendarDate(eye.openedOn) ||
				eye.openedOn > today ||
				!eye.dueOn ||
				!isCalendarDate(eye.dueOn)
			)
				continue;
			const cycle = `${eye.eye}:${eye.dueOn}`;
			let hasUpcoming = false;
			for (const day of [eye.dueOn, shiftCalendarDate(eye.dueOn, 1)]) {
				const time = localTime(
					day,
					prefs.replacement.hour,
					prefs.replacement.minute,
				);
				if (time.getTime() <= now.getTime()) continue;
				hasUpcoming = true;
				const group = groups.get(day) ?? { eyes: [], coverage: [], retain: [] };
				group.eyes.push(cycle);
				group.coverage.push(`${cycle}:${day}`);
				group.retain.push(
					`${cycle}:${eye.dueOn}`,
					`${cycle}:${shiftCalendarDate(eye.dueOn, 1)}`,
					`${cycle}:overdue`,
				);
				groups.set(day, group);
			}
			if (eye.dueOn < today && !hasUpcoming) {
				overdue.push(cycle);
				overdueCoverage.push([
					`${cycle}:${eye.dueOn}`,
					`${cycle}:${shiftCalendarDate(eye.dueOn, 1)}`,
					`${cycle}:overdue`,
				]);
			}
		}
		for (const [day, { eyes, coverage, retain }] of groups)
			add(
				"replacement",
				`${day}:${eyes.sort().join(",")}`,
				localTime(day, prefs.replacement.hour, prefs.replacement.minute),
				{ receiptKeys: coverage, retainReceiptKeys: retain },
			);
		if (overdue.length) {
			const next = nextTime(
				now,
				prefs.replacement.hour,
				prefs.replacement.minute,
			);
			add("replacement", `overdue:${overdue.sort().join(",")}`, next, {
				receiptKeys: overdue.map((cycle) => `${cycle}:overdue`),
				skipIfCovered: overdueCoverage,
			});
		}
	}
	const rx = snapshot.prescription;
	if (
		prefs.prescription.enabled &&
		rx?.version === 1 &&
		rx.id &&
		rx.confirmedAt &&
		rx.expiresOn &&
		isCalendarDate(rx.expiresOn) &&
		rx.expiresOn > today
	) {
		const expiry = rx.expiresOn;
		const times = new Map<number, { identity: string; date: Date }>();
		let missed = false;
		for (const lead of [30, 7]) {
			const date = localTime(
				shiftCalendarDate(expiry, -lead),
				prefs.prescription.hour,
				prefs.prescription.minute,
			);
			if (date.getTime() > now.getTime())
				times.set(date.getTime(), { identity: `${expiry}:${lead}`, date });
			else missed = true;
		}
		if (missed) {
			const date = nextTime(
				now,
				prefs.prescription.hour,
				prefs.prescription.minute,
			);
			if (deviceCalendarDate(date) < expiry && !times.has(date.getTime()))
				times.set(date.getTime(), { identity: `${expiry}:near`, date });
		}
		for (const { identity, date } of times.values()) {
			const near = identity.endsWith(":near");
			add("prescription", identity, date, {
				receiptKeys: near
					? [`${expiry}:near`]
					: identity.endsWith(":30")
						? [`${expiry}:30`]
						: [],
				retainReceiptKeys: [`${expiry}:30`, `${expiry}:near`],
				skipIfCovered: near ? [[`${expiry}:30`, `${expiry}:near`]] : [],
			});
		}
	}
	return plans;
}

export type ReminderPermission =
	| "undetermined"
	| "granted"
	| "denied"
	| "unavailable";
export type ReminderState = {
	preferences: ReminderPreferences;
	loading: boolean;
	busy: boolean;
	permission: ReminderPermission;
	scheduledCount: number;
	error: string | null;
	notice: string | null;
};
export interface ReminderManager {
	getState(): ReminderState;
	subscribe(listener: () => void): () => void;
	setSnapshot(snapshot: ReminderSnapshot): void;
	load(): Promise<void>;
	updatePreferences(preferences: ReminderPreferences): Promise<void>;
	reconcile(): Promise<void>;
	dispose(): void;
}
