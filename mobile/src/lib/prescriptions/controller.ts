import {
	confirmPrescription,
	draftFromPrescription,
	emptyDraft,
	type Prescription,
	type PrescriptionDraft,
} from "./model";
import { type OCRResult, parsePrescriptionOCR } from "./ocr-parser";
import type { PrescriptionRepository } from "./repository";
export type PrescriptionSession = {
	owner: string | null;
	sessionKey: string | null;
};
export type PrescriptionControllerState = {
	record: Prescription | null;
	draft: PrescriptionDraft;
	loading: boolean;
	busy: boolean;
	error: string | null;
	warnings: string[];
	expiryCandidates: { date: string; label: string }[];
};
const initial = (): PrescriptionControllerState => ({
	record: null,
	draft: emptyDraft(),
	loading: false,
	busy: false,
	error: null,
	warnings: [],
	expiryCandidates: [],
});
export function createPrescriptionController(
	repository: PrescriptionRepository,
	currentSession: () => PrescriptionSession,
) {
	let session = currentSession(),
		generation = 0,
		ticket = 0,
		revision = 0,
		active = true,
		state = initial();
	const listeners = new Set<() => void>();
	const publish = (next: PrescriptionControllerState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	function syncSession() {
		const next = currentSession();
		if (
			next.owner !== session.owner ||
			next.sessionKey !== session.sessionKey
		) {
			session = { ...next };
			generation++;
			ticket++;
			revision++;
			publish(initial());
		}
	}
	function begin() {
		syncSession();
		if (
			!active ||
			!session.owner ||
			!session.sessionKey ||
			state.busy ||
			state.loading
		)
			return null;
		const epoch = generation,
			operation = ++ticket,
			owner = session.owner;
		return {
			owner,
			valid: () => {
				syncSession();
				return active && epoch === generation && operation === ticket;
			},
		};
	}
	const failure = (e: unknown) =>
		e instanceof Error
			? e.message
			: "Prescription operation failed. Retry without deleting your record.";
	return {
		getState: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		syncSession,
		mount() {
			if (!active) {
				active = true;
				generation++;
				ticket++;
				publish(initial());
			}
			syncSession();
		},
		setDraft(draft: PrescriptionDraft) {
			syncSession();
			if (!active || !session.owner || !session.sessionKey) return;
			revision++;
			publish({
				...state,
				draft: {
					expiresOn: draft.expiresOn,
					right: { ...draft.right },
					left: { ...draft.left },
				},
				error: null,
			});
		},
		async load() {
			const task = begin();
			if (!task) return;
			const edit = revision;
			publish({ ...state, loading: true, error: null });
			try {
				const record = await repository.load(task.owner);
				if (task.valid())
					publish({
						...state,
						record,
						draft:
							edit === revision
								? record
									? draftFromPrescription(record)
									: emptyDraft()
								: state.draft,
						loading: false,
					});
			} catch (e) {
				if (task.valid())
					publish({ ...state, loading: false, error: failure(e) });
			}
		},
		async save(options: {
			id: string;
			now: Date;
			contactLensConfirmed: boolean;
			reviewConfirmed: boolean;
		}) {
			const task = begin();
			if (!task) return;
			const edit = revision;
			publish({ ...state, busy: true, error: null });
			try {
				const record = confirmPrescription(state.draft, options);
				await repository.save(task.owner, record);
				if (task.valid())
					publish({
						...state,
						record,
						draft:
							edit === revision ? draftFromPrescription(record) : state.draft,
						busy: false,
					});
			} catch (e) {
				if (task.valid()) publish({ ...state, busy: false, error: failure(e) });
			}
		},
		async remove() {
			const task = begin();
			if (!task) return;
			const edit = revision;
			publish({ ...state, busy: true, error: null });
			try {
				await repository.remove(task.owner);
				if (task.valid())
					publish({
						...state,
						record: null,
						draft: edit === revision ? emptyDraft() : state.draft,
						busy: false,
					});
			} catch (e) {
				if (task.valid()) publish({ ...state, busy: false, error: failure(e) });
			}
		},
		async scan(recognize: () => Promise<OCRResult>) {
			const task = begin();
			if (!task) return;
			const edit = revision;
			publish({ ...state, busy: true, error: null });
			try {
				const result = await recognize();
				if (!task.valid()) return;
				const parsed = parsePrescriptionOCR(result);
				publish({
					...state,
					busy: false,
					...(edit === revision
						? parsed
						: {
								warnings: [
									"Scan finished after manual edits. Your edits were kept; scan again to replace them.",
								],
								expiryCandidates: [],
							}),
				});
			} catch (e) {
				if (task.valid())
					publish({
						...state,
						busy: false,
						error:
							e &&
							typeof e === "object" &&
							"code" in e &&
							e.code === "OCR_CANCELLED"
								? null
								: failure(e),
					});
			}
		},
		dispose() {
			active = false;
			generation++;
			ticket++;
			listeners.clear();
		},
	};
}
