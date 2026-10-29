import type { WearHistorySession } from "./controller";
import type { WearHistory } from "./model";
import { loadWearReport, type WearReport } from "./report";

export type WearReportState = {
	report: WearReport | null;
	loading: boolean;
	exporting: boolean;
	error: string;
};
export type WearReportExporter = (
	report: WearReport,
	current: () => boolean,
) => Promise<void>;

export function createWearReportController(
	read: (month: string) => Promise<WearHistory>,
	session: () => WearHistorySession,
	share: WearReportExporter,
) {
	let state: WearReportState = {
		report: null,
		loading: false,
		exporting: false,
		error: "",
	};
	let active = false;
	let scope = "";
	let generation = 0;
	let locked = false;
	const listeners = new Set<() => void>();
	const publish = (next: WearReportState) => {
		state = next;
		for (const listener of listeners) {
			try {
				listener();
			} catch {
				/* Observers cannot turn a completed read/share into a failed operation. */
			}
		}
	};
	function syncSession() {
		const value = session();
		const next = value ? JSON.stringify([value.owner, value.token]) : "";
		if (next !== scope) {
			scope = next;
			generation++;
			locked = false;
			publish({ report: null, loading: false, exporting: false, error: "" });
		}
		return value;
	}
	function capture() {
		const value = syncSession();
		if (!active || !value || locked) return null;
		const ticket = generation;
		const current = () => {
			syncSession();
			return active && generation === ticket && !!scope;
		};
		locked = true;
		return current;
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
		syncSession,
		mount() {
			active = true;
			syncSession();
		},
		dispose() {
			active = false;
			generation++;
			locked = false;
			publish({ report: null, loading: false, exporting: false, error: "" });
		},
		async load(month: string) {
			const current = capture();
			if (!current) return false;
			publish({ report: null, loading: true, exporting: false, error: "" });
			try {
				const report = await loadWearReport(read, month, current);
				if (!current()) return false;
				publish({ report, loading: false, exporting: false, error: "" });
				return true;
			} catch (error) {
				if (current())
					publish({
						report: null,
						loading: false,
						exporting: false,
						error:
							error instanceof Error
								? error.message
								: "Could not load the complete year. Refresh to try again.",
					});
				return false;
			} finally {
				if (current()) locked = false;
			}
		},
		async exportPdf() {
			syncSession();
			const previous = state.report;
			if (!previous) return false;
			const current = capture();
			if (!current) return false;
			publish({ report: previous, loading: false, exporting: true, error: "" });
			try {
				// Fetch the full window again: never export a partial/stale fallback after a failed refresh.
				const report = await loadWearReport(
					read,
					previous.through.slice(0, 7),
					current,
				);
				if (!current()) return false;
				publish({ report, loading: false, exporting: true, error: "" });
				await share(report, current);
				if (!current()) return false;
				publish({ report, loading: false, exporting: false, error: "" });
				return true;
			} catch (error) {
				if (current())
					publish({
						...state,
						loading: false,
						exporting: false,
						error:
							error instanceof Error
								? error.message
								: "Could not export your logs. Try again.",
					});
				return false;
			} finally {
				if (current()) locked = false;
			}
		},
	};
}
