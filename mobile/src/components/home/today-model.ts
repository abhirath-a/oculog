import type {
	SimpleEyeState,
	SimpleState,
} from "../../../shared/simple-domain";

/** Format the server's literal calendar date. Never use the device's date zone. */
export function todayCalendarDate(value: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
	return new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${value}T00:00:00Z`));
}

export function todayLens(eye: SimpleEyeState) {
	const configured = eye.replacementDays !== null;
	const days = eye.daysRemaining;
	const timing =
		days === null
			? null
			: days === 0
				? "Due today"
				: days < 0
					? `${Math.abs(days)} ${days === -1 ? "day" : "days"} overdue`
					: `${days} ${days === 1 ? "day" : "days"} remaining`;
	const task =
		configured && (eye.openedOn === null || (days !== null && days <= 0));
	return {
		name: eye.eye === "left" ? "Left" : "Right",
		configured,
		task,
		status: !configured
			? "Not set up"
			: eye.openedOn === null
				? "No lens open"
				: [eye.dueOn ? `` : null, timing].filter(Boolean).join(" · ") ||
					"Deadline unavailable",
		stock: `${eye.spareCount} ${eye.spareCount === 1 ? "spare" : "spares"}`,
		action: `${eye.openedOn === null ? "Open" : "Replace"} ${eye.eye} lens`,
	};
}

/** Task ordering only; dates/countdowns remain server-owned. Left wins ties. */
export function todayPresentation(state: SimpleState) {
	const eyes = [...state.eyes].sort((a, b) =>
		a.eye === b.eye ? 0 : a.eye === "left" ? -1 : 1,
	);
	const tasks = eyes
		.filter((eye) => todayLens(eye).task)
		.sort(
			(a, b) =>
				(a.openedOn === null ? 1 : 0) - (b.openedOn === null ? 1 : 0) ||
				(a.daysRemaining ?? 0) - (b.daysRemaining ?? 0),
		);
	const needsSetup = eyes.some((eye) => eye.replacementDays === null);
	const due = tasks.find(
		(eye) =>
			eye.openedOn !== null &&
			eye.daysRemaining !== null &&
			eye.daysRemaining <= 0,
	);
	// Actual due tasks precede setup; unopened tasks wait until both eyes are configured.
	const next = due ?? (needsSetup ? undefined : tasks[0]);
	return {
		eyes,
		needsSetup,
		primary: next
			? next.spareCount > 0
				? next.eye
				: "add"
			: needsSetup
				? "setup"
				: null,
	};
}
