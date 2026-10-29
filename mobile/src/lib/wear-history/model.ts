export type HistoryDay = {
	localDate: string;
	worn: boolean | null;
	source: "manual" | "assumed" | "unknown";
};
export type AutomationPreferences = {
	version: 1;
	enabled: boolean;
	weekdays: number[];
	startsOn: string | null;
};
export type WearHistory = {
	version: 1;
	month: string;
	today: string;
	timeZone: string;
	days: HistoryDay[];
	automation: AutomationPreferences;
};
export type DayResult = {
	version: 1;
	day: HistoryDay & { source: "manual" | "unknown" };
};
export type WearHistoryState = {
	history: WearHistory | null;
	loading: boolean;
	busy: boolean;
	error: string;
	month: string;
};

const invalid = (): never => {
	throw new Error("The server returned invalid wear history data.");
};
function object(value: unknown, keys: string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid();
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).length !== keys.length ||
		!keys.every((key) => Object.hasOwn(record, key))
	)
		return invalid();
	return record;
}
export function validMonth(value: unknown): value is string {
	return (
		typeof value === "string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value)
	);
}
function daysInMonth(year: number, month: number): number {
	if (month === 2)
		return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
export function validDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return false;
	const month = value.slice(0, 7);
	const day = Number(value.slice(8));
	return (
		validMonth(month) &&
		day >= 1 &&
		day <= daysInMonth(Number(value.slice(0, 4)), Number(value.slice(5, 7)))
	);
}
/** Literal Gregorian dates; no timezone or millisecond arithmetic. */
export function monthDates(month: string): string[] {
	if (!validMonth(month)) throw new Error("Choose a valid calendar month.");
	return Array.from(
		{ length: daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5))) },
		(_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
	);
}
export function shiftMonth(month: string, offset: number): string {
	if (!validMonth(month) || !Number.isSafeInteger(offset))
		throw new Error("Choose a valid calendar month.");
	const index =
		(Number(month.slice(0, 4)) - 1) * 12 + Number(month.slice(5)) - 1 + offset;
	if (index < 0 || index >= 9999 * 12)
		throw new Error("Calendar month is out of range.");
	return `${String(Math.floor(index / 12) + 1).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}
/** ISO weekday, Monday=0; setUTCFullYear avoids JavaScript's special years 0..99. */
export function weekdayMonday(localDate: string): number {
	if (!validDate(localDate)) throw new Error("Choose a valid calendar date.");
	const date = new Date(0);
	date.setUTCFullYear(
		Number(localDate.slice(0, 4)),
		Number(localDate.slice(5, 7)) - 1,
		Number(localDate.slice(8)),
	);
	return (date.getUTCDay() + 6) % 7;
}
export function localMonth(now = new Date()): string {
	return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
export function validWeekdays(value: unknown): value is number[] {
	return (
		Array.isArray(value) &&
		value.length <= 7 &&
		Array.from(value).every(
			(day) => Number.isInteger(day) && day >= 0 && day <= 6,
		) &&
		new Set(value).size === value.length
	);
}
export function parseAutomationPreferences(
	value: unknown,
): AutomationPreferences {
	const data = object(value, ["version", "enabled", "weekdays", "startsOn"]);
	if (
		data.version !== 1 ||
		typeof data.enabled !== "boolean" ||
		!validWeekdays(data.weekdays) ||
		data.weekdays.some((day, i, days) => i > 0 && day <= (days[i - 1] ?? -1)) ||
		(data.enabled
			? data.weekdays.length === 0 || !validDate(data.startsOn)
			: data.startsOn !== null)
	)
		return invalid();
	return {
		version: 1,
		enabled: data.enabled,
		weekdays: [...data.weekdays],
		startsOn: data.startsOn as string | null,
	};
}
function parseDay(value: unknown): HistoryDay {
	const data = object(value, ["localDate", "worn", "source"]);
	if (
		!validDate(data.localDate) ||
		!(
			(data.source === "unknown" && data.worn === null) ||
			(data.source === "assumed" && data.worn === true) ||
			(data.source === "manual" && typeof data.worn === "boolean")
		)
	)
		return invalid();
	return data as HistoryDay;
}
export function parseDayResult(value: unknown): DayResult {
	const data = object(value, ["version", "day"]);
	const day = parseDay(data.day);
	if (data.version !== 1 || day.source === "assumed") return invalid();
	return { version: 1, day: day as DayResult["day"] };
}
export function parseWearHistory(value: unknown): WearHistory {
	const data = object(value, [
		"version",
		"month",
		"today",
		"timeZone",
		"days",
		"automation",
	]);
	if (
		data.version !== 1 ||
		!validMonth(data.month) ||
		!validDate(data.today) ||
		typeof data.timeZone !== "string" ||
		!data.timeZone ||
		data.timeZone.length > 100 ||
		!Array.isArray(data.days)
	)
		return invalid();
	try {
		new Intl.DateTimeFormat("en", { timeZone: data.timeZone });
	} catch {
		return invalid();
	}
	const dates = monthDates(data.month);
	if (data.days.length !== dates.length) return invalid();
	const days = Array.from(data.days, parseDay);
	if (
		days.some(
			(day, i) =>
				day.localDate !== dates[i] ||
				(day.source === "assumed" && day.localDate >= (data.today as string)),
		)
	)
		return invalid();
	const automation = parseAutomationPreferences(data.automation);
	// An existing rule may appear ahead of today after an account-timezone rollback.
	// Its literal effective date is preserved; assumed day rows are still strictly past-only.
	return {
		version: 1,
		month: data.month,
		today: data.today,
		timeZone: data.timeZone,
		days,
		automation,
	};
}
