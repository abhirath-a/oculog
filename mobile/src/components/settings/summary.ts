import type { SimpleState } from "../../../shared/simple-domain";

/** Date-only strings remain date-only. Never parse these as UTC instants. */
export function lensSummary(state: SimpleState) {
	const left = state.eyes.find((eye) => eye.eye === "left");
	const right = state.eyes.find((eye) => eye.eye === "right");
	const interval = (days: number | null | undefined) =>
		days == null ? "Not set" : `${days} ${days === 1 ? "day" : "days"}`;
	const opened = (day: string | null | undefined) =>
		day ? `Opened on ${day}` : "No open lens";
	const intervals =
		left?.replacementDays === right?.replacementDays
			? `Both eyes · ${interval(left?.replacementDays)}`
			: `Left · ${interval(left?.replacementDays)}; Right · ${interval(right?.replacementDays)}`;
	const dates =
		left?.openedOn === right?.openedOn
			? left?.openedOn
				? `Both lenses · ${opened(left.openedOn).toLowerCase()}`
				: "No open lenses"
			: `Left · ${opened(left?.openedOn)}; Right · ${opened(right?.openedOn)}`;
	return `${intervals}\n${dates}`;
}
