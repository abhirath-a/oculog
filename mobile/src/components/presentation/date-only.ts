/** Date-only bridges: SwiftUI uses local calendar days; Compose uses UTC days. */
export function dateOnlyToLocal(value: string): Date {
	const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
	const date = new Date(0);
	date.setFullYear(year, month - 1, day);
	date.setHours(12, 0, 0, 0); // Noon avoids DST's missing/repeated midnight.
	return date;
}

export function dateOnlyToUTC(value: string): Date {
	return new Date(`${value}T00:00:00.000Z`);
}

export function dateOnlyFromDate(date: Date, utc = false): string {
	const year = utc ? date.getUTCFullYear() : date.getFullYear();
	const month = utc ? date.getUTCMonth() + 1 : date.getMonth() + 1;
	const day = utc ? date.getUTCDate() : date.getDate();
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A transaction stays locked until native dismissal completes. Stale callbacks cannot write. */
export function createDateOnlySession(value: string, maximum: string) {
	let active = true;
	let draft = value && value <= maximum ? value : maximum;
	return {
		get draft() {
			return draft;
		},
		select(next: string) {
			if (active && next && next <= maximum) draft = next;
		},
		cancel() {
			active = false;
		},
		commit(disabled: boolean): string | undefined {
			if (!active || disabled) return undefined;
			active = false;
			return draft;
		},
	};
}
