import type {
	SimpleAddRequest,
	SimpleDayRequest,
	SimpleEye,
	SimpleReplaceRequest,
	SimpleSettingsRequest,
	SimpleState,
} from "../../shared/simple-domain";
export type Eye = SimpleEye;
export type Commands = {
	settings: SimpleSettingsRequest;
	add: SimpleAddRequest;
	replace: SimpleReplaceRequest;
	day: SimpleDayRequest;
};
export type SimpleTransport = {
	state: () => Promise<SimpleState>;
	post: <K extends keyof Commands>(
		route: K,
		body: Commands[K],
	) => Promise<SimpleState>;
};
export type Snapshot = {
	state: SimpleState | null;
	loading: boolean;
	pending: boolean;
	online: boolean;
	error: string;
};
/** One authoritative snapshot. Account changes invalidate every outstanding operation. */
export class SimpleController {
	private epoch = 0;
	private sequence = 0;
	private owner: string | null = null;
	private listeners = new Set<() => void>();
	snapshot: Snapshot = {
		state: null,
		loading: false,
		pending: false,
		online: false,
		error: "",
	};
	constructor(
		private transport: SimpleTransport,
		private message: (error: unknown) => string,
		private now: () => Date = () => new Date(),
	) {}
	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};
	private update(value: Partial<Snapshot>) {
		this.snapshot = { ...this.snapshot, ...value };
		for (const listener of this.listeners) listener();
	}
	account(owner: string | null) {
		this.owner = owner;
		this.epoch++;
		this.sequence++;
		this.update({
			state: null,
			loading: false,
			pending: false,
			online: false,
			error: "",
		});
	}
	/** A new token for the same account keeps the display but requires a fresh read. */
	session(owner: string | null) {
		if (owner !== this.owner || !owner) {
			this.account(owner);
			return;
		}
		this.epoch++;
		this.sequence++;
		this.update({ loading: false, pending: false, online: false, error: "" });
	}
	private failure(error: unknown) {
		this.update({ error: this.message(error), online: false });
	}
	private acceptsRead(epoch: number, sequence: number) {
		return epoch === this.epoch && sequence === this.sequence;
	}
	async reload() {
		if (!this.owner || this.snapshot.pending) return;
		const epoch = this.epoch;
		const sequence = ++this.sequence;
		this.update({ loading: true, error: "", online: false });
		try {
			const state = await this.transport.state();
			if (this.acceptsRead(epoch, sequence)) {
				this.update({ state, online: true });
			}
		} catch (error) {
			if (this.acceptsRead(epoch, sequence)) this.failure(error);
		} finally {
			if (this.acceptsRead(epoch, sequence)) this.update({ loading: false });
		}
	}
	/** Foreground polling is local-only unless the account's calendar day changed. */
	async checkDay(active: boolean) {
		const { state, online, loading, pending } = this.snapshot;
		if (!active || !this.owner || !state || !online || loading || pending)
			return;
		if (calendarDate(state.timeZone, this.now()) !== state.today)
			await this.reload();
	}
	private requireWritable() {
		if (
			!this.owner ||
			!this.snapshot.online ||
			this.snapshot.loading ||
			this.snapshot.pending
		)
			throw new Error("Reconnect before saving. No changes have been queued.");
	}
	async mutate<K extends keyof Commands>(route: K, body: Commands[K]) {
		this.requireWritable();
		const epoch = this.epoch;
		if (route === "day") {
			const current = this.snapshot.state;
			if (!current) throw new Error("Refresh before logging today.");
			if (calendarDate(current.timeZone, this.now()) !== current.today)
				await this.reload();
			if (epoch !== this.epoch) return false;
			this.requireWritable();
			const latest = this.snapshot.state!;
			if (calendarDate(latest.timeZone, this.now()) !== latest.today)
				throw new Error(
					"The calendar day changed. Refresh before logging today.",
				);
			body = { ...body, localDate: latest.today } as Commands[K];
		}
		// Supersede outstanding reads; only the server response may update stock.
		++this.sequence;
		this.update({ pending: true, error: "" });
		try {
			const state = await this.transport.post(route, body);
			if (epoch !== this.epoch) return false;
			this.update({ state, online: true });
			return true;
		} catch (error) {
			if (epoch === this.epoch) this.failure(error);
			throw error;
		} finally {
			if (epoch === this.epoch) this.update({ pending: false });
		}
	}
}
export function remainingLabel(days: number | null) {
	if (days === null) return "Not wearing lenses";
	if (days === 0) return "Replace today";
	if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} overdue`;
	return `${days} ${days === 1 ? "day" : "days"} left`;
}
/** Formatting in the account timezone handles both 23- and 25-hour DST days. */
export function calendarDate(timeZone: string, now: Date) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const value = (type: string) =>
		parts.find((part) => part.type === type)!.value;
	return `${value("year")}-${value("month")}-${value("day")}`;
}
export function deviceTimeZone() {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}
export function positiveInteger(value: string) {
	const number = Number(value);
	if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
		throw new Error("Enter a whole number greater than zero.");
	}
	return number;
}
