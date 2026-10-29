import {
	type AutomationPreferences,
	type DayResult,
	localMonth,
	parseAutomationPreferences,
	parseDayResult,
	parseWearHistory,
	validDate,
	validMonth,
	validWeekdays,
	type WearHistory,
	type WearHistoryState,
} from "./model";

export type WearHistorySession = { owner: string; token: string } | null;
export type WearHistoryTransport = {
	history(month: string): Promise<WearHistory>;
	day(body: { localDate: string; worn: boolean | null }): Promise<DayResult>;
	automation(body: {
		enabled: boolean;
		weekdays: number[];
	}): Promise<AutomationPreferences>;
};
const sameSession = (a: WearHistorySession, b: WearHistorySession) =>
	a?.owner === b?.owner && a?.token === b?.token;
const message = (error: unknown) =>
	error instanceof Error
		? error.message
		: "Could not load wear history. Please retry.";

export function createWearHistoryController(
	transport: WearHistoryTransport,
	currentSession: () => WearHistorySession,
	initialMonth = localMonth(),
) {
	if (!validMonth(initialMonth))
		throw new Error("Choose a valid calendar month.");
	let state: WearHistoryState = {
		history: null,
		loading: false,
		busy: false,
		error: "",
		month: initialMonth,
	};
	let session = currentSession();
	let active = true;
	let epoch = 0;
	let readTicket = 0;
	let writeTicket = 0;
	let locked = false;
	const listeners = new Set<() => void>();
	function publish(next: WearHistoryState) {
		state = next;
		for (const listener of listeners) listener();
	}
	function syncSession() {
		const next = currentSession();
		if (!sameSession(session, next)) {
			session = next ? { ...next } : null;
			epoch++;
			readTicket++;
			writeTicket++;
			locked = false;
			publish({
				...state,
				history: null,
				loading: false,
				busy: false,
				error: "",
			});
		}
	}
	function valid(captured: WearHistorySession, generation: number) {
		if (!active) return false;
		syncSession();
		return !!captured && sameSession(session, captured) && epoch === generation;
	}
	async function load(month: string) {
		syncSession();
		if (!active || !session) return;
		if (!validMonth(month)) {
			publish({ ...state, error: "Choose a valid calendar month." });
			return;
		}
		const captured = session;
		const generation = epoch;
		const ticket = ++readTicket;
		publish({
			...state,
			month,
			history: state.history?.month === month ? state.history : null,
			loading: true,
			error: "",
		});
		try {
			if (!valid(captured, generation) || ticket !== readTicket) return;
			const history = parseWearHistory(await transport.history(month));
			if (!valid(captured, generation) || ticket !== readTicket) return;
			if (history.month !== month)
				throw new Error("The server returned the wrong calendar month.");
			publish({ ...state, history, loading: false, error: "" });
		} catch (error) {
			if (valid(captured, generation) && ticket === readTicket)
				publish({ ...state, loading: false, error: message(error) });
		}
	}
	async function save(
		kind: "day" | "automation",
		body:
			| { localDate: string; worn: boolean | null }
			| { enabled: boolean; weekdays: number[] },
	): Promise<boolean> {
		syncSession();
		if (!active || !session || locked) return false;
		if ("localDate" in body) {
			if (
				!validDate(body.localDate) ||
				!state.history ||
				body.localDate > state.history.today ||
				!(body.worn === null || typeof body.worn === "boolean")
			) {
				publish({ ...state, error: "Choose today or an earlier valid date." });
				return false;
			}
		} else if (
			typeof body.enabled !== "boolean" ||
			!validWeekdays(body.weekdays) ||
			(body.enabled && !body.weekdays.length)
		) {
			publish({
				...state,
				error: "Select at least one weekday to enable automatic logging.",
			});
			return false;
		}
		const captured = session;
		const generation = epoch;
		const ticket = ++writeTicket;
		const writeMonth = state.month;
		// Separate read/write tickets: navigation must not cancel an acknowledged write.
		locked = true;
		publish({ ...state, busy: true, error: "" });
		let acknowledged = false;
		try {
			if (!valid(captured, generation) || ticket !== writeTicket) return false;
			if (kind === "day" && "localDate" in body) {
				const result = parseDayResult(await transport.day(body));
				if (
					result.day.localDate !== body.localDate ||
					result.day.worn !== body.worn
				)
					throw new Error(
						"The server returned a different wear history change.",
					);
			} else if ("enabled" in body) {
				const result = parseAutomationPreferences(
					await transport.automation(body),
				);
				if (
					result.enabled !== body.enabled ||
					JSON.stringify(result.weekdays) !== JSON.stringify(body.weekdays)
				)
					throw new Error(
						"The server returned different automatic logging preferences.",
					);
			}
			if (!valid(captured, generation) || ticket !== writeTicket) return false;
			acknowledged = true;
			const refreshTicket = readTicket + 1;
			await load(state.month);
			if (
				valid(captured, generation) &&
				readTicket === refreshTicket &&
				state.error
			)
				publish({
					...state,
					error: `Saved, but wear history could not refresh. ${state.error}`,
				});
			return valid(captured, generation) && ticket === writeTicket;
		} catch (error) {
			if (
				valid(captured, generation) &&
				ticket === writeTicket &&
				state.month === writeMonth
			)
				publish({ ...state, error: message(error) });
			return acknowledged && valid(captured, generation);
		} finally {
			if (valid(captured, generation) && ticket === writeTicket) {
				locked = false;
				publish({ ...state, busy: false });
			}
		}
	}
	return {
		getState() {
			syncSession();
			return state;
		},
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		mount() {
			active = true;
			syncSession();
			return load(state.month);
		},
		dispose() {
			active = false;
			epoch++;
			readTicket++;
			writeTicket++;
			locked = false;
			state = {
				...state,
				history: null,
				loading: false,
				busy: false,
				error: "",
			};
		},
		load,
		saveDay: (localDate: string, worn: boolean | null) =>
			save("day", { localDate, worn }),
		saveAutomation: (enabled: boolean, weekdays: number[]) =>
			save("automation", {
				enabled,
				weekdays: Array.isArray(weekdays)
					? [...weekdays].sort((a, b) => a - b)
					: weekdays,
			}),
	};
}
