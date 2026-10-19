// SwiftUI dates are local instants; Compose date-only selections are UTC midnight.
// Keep the calendar components, not the instant, when crossing either bridge.
export function localDateString(date: Date): string {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
}

export function localDate(value: string): Date {
	const [year = 1970, month = 1, day = 1] = value.split("-").map(Number);
	return new Date(year, month - 1, day, 12);
}

export function composeDateString(date: Date): string {
	return [
		date.getUTCFullYear(),
		String(date.getUTCMonth() + 1).padStart(2, "0"),
		String(date.getUTCDate()).padStart(2, "0"),
	].join("-");
}

export function composeDate(value: string): string {
	return `${value}T00:00:00.000Z`;
}
