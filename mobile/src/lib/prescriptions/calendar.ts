/** Literal Gregorian dates; UTC is used only as an arithmetic coordinate. */
export function isCalendarDate(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		return false;
	const [y = 0, m = 0, d = 0] = value.split("-").map(Number);
	if (y < 1 || m < 1 || m > 12 || d < 1) return false;
	const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
	return (
		d <=
		([31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0)
	);
}
function coordinate(iso: string): number {
	if (!isCalendarDate(iso))
		throw new Error("An exact valid calendar date is required.");
	const [y = 0, m = 0, d = 0] = iso.split("-").map(Number);
	const date = new Date(0);
	date.setUTCFullYear(y, m - 1, d);
	date.setUTCHours(0, 0, 0, 0);
	return date.getTime();
}
export function shiftCalendarDate(iso: string, days: number): string {
	if (!Number.isSafeInteger(days))
		throw new Error("Calendar day offset must be an integer.");
	const date = new Date(coordinate(iso) + days * 86400000);
	const result = date.toISOString().slice(0, 10);
	if (!isCalendarDate(result))
		throw new Error("Calendar date is outside the supported range.");
	return result;
}
export function calendarDaysBetween(from: string, to: string): number {
	return (coordinate(to) - coordinate(from)) / 86400000;
}
export function deviceCalendarDate(date: Date): string {
	if (!Number.isFinite(date.getTime()))
		throw new Error("Invalid current date.");
	const result = `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	if (!isCalendarDate(result)) throw new Error("Unsupported current date.");
	return result;
}
