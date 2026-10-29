import type {
	LearningAnswer,
	LearningStatus,
	LearningSubmission,
	learningAPI,
} from "./learning-api";

type State = {
	status: LearningStatus | null;
	feedback: LearningAnswer["feedback"] | null;
	busy: boolean;
	error: string | null;
	pending: LearningSubmission | null;
	resetUncertain: boolean;
};
const initial = (): State => ({
	status: null,
	feedback: null,
	busy: false,
	error: null,
	pending: null,
	resetUncertain: false,
});
const message = (e: unknown) =>
	e instanceof Error
		? e.message
		: "Could not connect. Check your connection and retry.";
/** Identity includes BOTH account and token. Every operation has a synchronous lock and stale-result guard. */
export function createLearningController(
	api: ReturnType<typeof learningAPI>,
	identity: () => string | null,
	attemptID: () => string,
) {
	let owner = identity(),
		epoch = 0,
		operation = 0,
		active = true,
		state = initial();
	const listeners = new Set<() => void>();
	function publish(next: State) {
		state = next;
		for (const f of listeners) f();
	}
	function syncIdentity() {
		const next = identity();
		if (next !== owner) {
			owner = next;
			epoch++;
			operation++;
			publish(initial());
		}
	}
	function valid(e: number, ticket: number, captured: string | null) {
		if (!active) return false;
		syncIdentity();
		return !!owner && owner === captured && epoch === e && operation === ticket;
	}
	async function load() {
		syncIdentity();
		if (!active || !owner || state.busy || state.pending) return;
		const e = epoch,
			ticket = ++operation,
			captured = owner;
		publish({ ...state, busy: true, error: null });
		try {
			const status = await api.status();
			if (valid(e, ticket, captured))
				publish({
					...state,
					status,
					feedback: null,
					busy: false,
					resetUncertain: false,
				});
		} catch (error) {
			if (valid(e, ticket, captured))
				publish({ ...state, busy: false, error: message(error) });
		}
	}
	async function submit(questionID?: string, optionID?: string) {
		syncIdentity();
		if (
			!active ||
			!owner ||
			state.busy ||
			!state.status ||
			state.resetUncertain
		)
			return;
		let pending = state.pending;
		if (pending && (questionID !== undefined || optionID !== undefined)) return;
		if (!pending) {
			const q = state.status.lessons
				.flatMap((l) => l.questions)
				.find((q) => q.id === questionID);
			if (!q || !q.options.some((o) => o.id === optionID)) return;
			pending = {
				generation: state.status.generation,
				source_bank_revision: state.status.source_bank_revision,
				question_id: q.id,
				option_id: optionID as string,
				client_attempt_id: attemptID(),
			};
		}
		const e = epoch,
			ticket = ++operation,
			captured = owner;
		// Publish locks before the first await. Retry always reuses precisely this body/ID.
		publish({ ...state, pending, busy: true, error: null, feedback: null });
		try {
			const result = await api.answer(pending);
			if (valid(e, ticket, captured))
				publish({
					...state,
					status: result,
					feedback: result.feedback,
					pending: null,
					busy: false,
				});
		} catch (error) {
			if (valid(e, ticket, captured))
				publish({
					...state,
					busy: false,
					error: `Recording is unconfirmed. Retry the same answer, or reset and reload progress. ${message(error)}`,
				});
		}
	}
	async function reset() {
		syncIdentity();
		if (!active || !owner || !state.status || state.resetUncertain) return;
		const generation = state.status.generation;
		// Explicit reset supersedes any in-flight answer, including uncertain retries.
		epoch++;
		const e = epoch,
			ticket = ++operation,
			captured = owner;
		publish({
			...state,
			busy: true,
			feedback: null,
			pending: null,
			error: null,
			resetUncertain: true,
		});
		try {
			const status = await api.reset(generation);
			if (valid(e, ticket, captured)) publish({ ...initial(), status });
		} catch (error) {
			if (valid(e, ticket, captured))
				publish({
					...state,
					busy: false,
					error: `Reset is unconfirmed. Reload to see the server's saved progress before continuing. ${message(error)}`,
				});
		}
	}
	return {
		getSnapshot: () => state,
		subscribe: (f: () => void) => {
			listeners.add(f);
			return () => {
				listeners.delete(f);
			};
		},
		activate: () => {
			active = true;
			syncIdentity();
		},
		syncIdentity,
		load,
		answer: (q: string, o: string) => submit(q, o),
		retry: () => submit(),
		reset,
		clearFeedback: () => {
			if (!state.busy && !state.pending) publish({ ...state, feedback: null });
		},
		dispose: () => {
			active = false;
			epoch++;
			listeners.clear();
			state = initial();
		},
	};
}
