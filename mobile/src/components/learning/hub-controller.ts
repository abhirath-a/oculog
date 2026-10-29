import type { LearningStatus } from "../../lib/learning-api";

type State = {
	status: LearningStatus | null;
	busy: boolean;
	error: string | null;
};
const empty = (): State => ({ status: null, busy: false, error: null });
/** Read-only, per-mount snapshot. Account AND token changes fence every response. */
export function createHubController(
	fetchStatus: () => Promise<LearningStatus>,
	identity: () => string | null,
) {
	let owner = identity(),
		generation = 0,
		active = true,
		trailing: { owner: string; ticket: number } | null = null,
		state = empty();
	const listeners = new Set<() => void>();
	function publish(next: State) {
		state = next;
		for (const listener of listeners) listener();
	}
	function syncIdentity() {
		if (!active) return false;
		const next = identity();
		if (next === owner) return false;
		owner = next;
		trailing = null;
		generation++;
		publish(empty());
		return true;
	}
	async function load() {
		if (!active) return;
		syncIdentity();
		if (!owner) return;
		if (state.busy) {
			trailing = { owner, ticket: generation };
			return;
		}
		const captured = owner,
			ticket = ++generation;
		publish({ ...state, busy: true, error: null });
		try {
			const status = await fetchStatus();
			syncIdentity();
			if (active && owner === captured && generation === ticket)
				publish({ status, busy: false, error: null });
		} catch (error) {
			syncIdentity();
			if (active && owner === captured && generation === ticket)
				publish({
					...state,
					busy: false,
					error:
						error instanceof Error
							? error.message
							: "Could not load learning. Please retry.",
				});
		} finally {
			if (active) syncIdentity();
			// Only this request may consume its queue. An old owner's completion
			// must never flush (or clear) a newer owner's pending refresh.
			if (active && owner === captured && generation === ticket) {
				const queued = trailing;
				trailing = null;
				if (queued?.owner === captured && queued.ticket === ticket)
					await load();
			}
		}
	}
	return {
		getSnapshot: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		syncIdentity,
		load,
		activate() {
			active = true;
			syncIdentity();
		},
		dispose() {
			active = false;
			trailing = null;
			generation++;
			state = empty();
			listeners.clear();
		},
	};
}
