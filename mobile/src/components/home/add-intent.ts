import type { Eye } from "../../lib/simple-controller";

/** A sheet owns one unfinished addition. Successful eyes survive dismiss/retry. */
export class AddIntent {
	private key = "";
	readonly completed = new Set<Eye>();

	async save(
		owner: string,
		eye: string,
		quantity: number,
		write: (eye: Eye, quantity: number) => Promise<boolean>,
	) {
		const key = JSON.stringify([owner, eye, quantity]);
		if (key !== this.key) {
			this.key = key;
			this.completed.clear();
		}
		const targets: Eye[] = eye === "both" ? ["left", "right"] : [eye as Eye];
		for (const target of targets) {
			if (this.completed.has(target)) continue;
			if (!(await write(target, quantity))) return false;
			this.completed.add(target);
		}
		this.completed.clear();
		this.key = "";
		return true;
	}
}

export function homeLayout(width: number, fontScale: number) {
	// Width is the usable content width after Page's horizontal padding.
	// Text scaling must still leave room for two readable cards.
	const readableWidth = Math.min(width, 960) / Math.max(1, fontScale);
	return {
		pairedEyes: readableWidth >= 720,
		columns: readableWidth >= 900,
	};
}

export function dateHeading(date: string | undefined) {
	if (!date) return "Today";
	const parsed = new Date(`${date}T12:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(parsed);
}
