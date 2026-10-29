import {
	type HistoryDay,
	monthDates,
	parseWearHistory,
	shiftMonth,
	validDate,
	validMonth,
	type WearHistory,
} from "./model";

export type WearTotals = {
	confirmedWear: number;
	confirmedNoWear: number;
	assumedWear: number;
	unknown: number;
};
export type WearReport = {
	from: string;
	through: string;
	timeZone: string;
	days: HistoryDay[];
	totals: WearTotals;
};

/** Inclusive rolling twelve-month window ending on the account's authoritative today. */
export function wearReportRange(today: string) {
	if (!validDate(today) || Number(today.slice(0, 4)) < 2)
		throw new Error("The account calendar cannot be exported yet.");
	const previousMonth = shiftMonth(today.slice(0, 7), -12);
	const previousDates = monthDates(previousMonth);
	const anniversary =
		previousDates[Math.min(Number(today.slice(8)), previousDates.length) - 1]!;
	const from =
		anniversary === previousDates.at(-1)
			? `${shiftMonth(previousMonth, 1)}-01`
			: previousDates[Number(anniversary.slice(8))]!;
	return { from, through: today };
}

export function reportMonths(from: string, through: string): string[] {
	if (!validDate(from) || !validDate(through) || from > through)
		throw new Error("Invalid report date range.");
	const months: string[] = [];
	for (
		let month = from.slice(0, 7);
		month <= through.slice(0, 7);
		month = shiftMonth(month, 1)
	) {
		months.push(month);
		if (months.length > 13)
			throw new Error("The report must cover at most twelve months.");
		if (month === through.slice(0, 7)) break;
	}
	return months;
}

export function wearTotals(days: readonly HistoryDay[]): WearTotals {
	const result = {
		confirmedWear: 0,
		confirmedNoWear: 0,
		assumedWear: 0,
		unknown: 0,
	};
	for (const day of days) {
		if (day.source === "assumed") result.assumedWear++;
		else if (day.source === "unknown") result.unknown++;
		else if (day.worn) result.confirmedWear++;
		else result.confirmedNoWear++;
	}
	return result;
}

export function reportDayStatus(day: HistoryDay): string {
	if (day.source === "assumed") return "Assumed worn - not confirmed";
	if (day.source === "unknown") return "Unknown - not logged";
	return day.worn ? "Confirmed worn" : "Confirmed not worn";
}

/** No missing month is replaced with fabricated unknown days. No writes or background retries. */
export async function loadWearReport(
	read: (month: string) => Promise<WearHistory>,
	initialMonth: string,
	current: () => boolean,
): Promise<WearReport> {
	const check = () => {
		if (!current()) throw new Error("Your session changed. Reopen wear logs.");
	};
	const readMonth = async (month: string) => {
		check();
		const history = parseWearHistory(await read(month));
		check();
		if (history.month !== month)
			throw new Error("The server returned a different calendar month.");
		return history;
	};
	if (!validMonth(initialMonth))
		throw new Error("Choose a valid account calendar month.");
	const anchor = await readMonth(initialMonth);
	const range = wearReportRange(anchor.today);
	const days: HistoryDay[] = [];
	for (const month of reportMonths(range.from, range.through)) {
		const history = month === anchor.month ? anchor : await readMonth(month);
		if (
			history.today !== anchor.today ||
			history.timeZone !== anchor.timeZone ||
			JSON.stringify(history.automation) !== JSON.stringify(anchor.automation)
		)
			throw new Error(
				"Your account calendar or automatic logging settings changed. Refresh the report and try again.",
			);
		days.push(
			...history.days.filter(
				(day) => day.localDate >= range.from && day.localDate <= range.through,
			),
		);
	}
	check();
	return {
		...range,
		timeZone: anchor.timeZone,
		days,
		totals: wearTotals(days),
	};
}
