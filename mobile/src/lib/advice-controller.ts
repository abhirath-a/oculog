import type {
	AdviceAnswer,
	AdviceCatalogue,
	AdviceInput,
	adviceAPI,
} from "./advice-api";

export type AdviceExchange = {
	key: number;
	label: string;
	input: AdviceInput;
	answer?: AdviceAnswer;
	error?: string;
};
export type AdviceState = {
	catalogue: AdviceCatalogue | null;
	catalogueLoading: boolean;
	catalogueError: string | null;
	exchanges: AdviceExchange[];
	pending: boolean;
	draft: string;
	notice: string | null;
};
const initial = (): AdviceState => ({
	catalogue: null,
	catalogueLoading: false,
	catalogueError: null,
	exchanges: [],
	pending: false,
	draft: "",
	notice: null,
});
const failure = (error: unknown) =>
	error instanceof Error
		? error.message
		: "Could not load advice. Please try again.";

/** In-memory only. Identity includes both account ID and session token. */
export function createAdviceController(
	api: ReturnType<typeof adviceAPI>,
	currentIdentity: () => string | null,
) {
	let identity = currentIdentity();
	let state = initial();
	let generation = 0;
	let catalogueTicket = 0;
	let answerTicket = 0;
	let sequence = 0;
	let active = true;
	const listeners = new Set<() => void>();
	function publish(next: AdviceState) {
		state = next;
		for (const listener of listeners) listener();
	}
	function syncIdentity() {
		const next = currentIdentity();
		if (next === identity) return false;
		identity = next;
		generation++;
		publish(initial());
		return true;
	}
	function valid(epoch: number, owner: string | null) {
		if (!active) return false;
		syncIdentity();
		return !!owner && owner === identity && epoch === generation;
	}
	async function loadCatalogue() {
		syncIdentity();
		if (!active || !identity || state.catalogueLoading) return;
		const epoch = generation,
			owner = identity,
			ticket = ++catalogueTicket;
		publish({ ...state, catalogueLoading: true, catalogueError: null });
		try {
			const catalogue = await api.catalogue();
			if (valid(epoch, owner) && ticket === catalogueTicket)
				publish({ ...state, catalogue, catalogueLoading: false });
		} catch (error) {
			if (valid(epoch, owner) && ticket === catalogueTicket)
				publish({
					...state,
					catalogueLoading: false,
					catalogueError: failure(error),
				});
		}
	}
	async function send(input: AdviceInput, label: string, retryKey?: number) {
		syncIdentity();
		if (!active || !identity || state.pending) return;
		const epoch = generation,
			owner = identity,
			ticket = ++answerTicket;
		const originalDraft = state.draft;
		const key = retryKey ?? ++sequence;
		let exchanges =
			retryKey === undefined
				? [...state.exchanges, { key, label, input }]
				: state.exchanges.map((item) =>
						item.key === key ? { key, label, input } : item,
					);
		const removed = exchanges.length > 20;
		exchanges = exchanges.slice(-20);
		publish({
			...state,
			pending: true,
			exchanges,
			notice: removed
				? "Only the latest 20 exchanges are kept. Older exchanges were cleared."
				: state.notice,
		});
		try {
			const answer = await api.answer(input);
			if (valid(epoch, owner) && ticket === answerTicket)
				publish({
					...state,
					pending: false,
					draft:
						"message" in input &&
						originalDraft.trim() === input.message &&
						state.draft === originalDraft
							? ""
							: state.draft,
					exchanges: state.exchanges.map((item) =>
						item.key === key ? { ...item, answer } : item,
					),
				});
		} catch (error) {
			if (valid(epoch, owner) && ticket === answerTicket)
				publish({
					...state,
					pending: false,
					exchanges: state.exchanges.map((item) =>
						item.key === key ? { ...item, error: failure(error) } : item,
					),
				});
		}
	}
	return {
		getState: () => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		syncIdentity,
		mount() {
			if (!active) {
				active = true;
				publish(initial());
			}
			syncIdentity();
		},
		dispose() {
			active = false;
			generation++;
		},
		loadCatalogue,
		setDraft(draft: string) {
			syncIdentity();
			if (active && identity && draft.length <= 1000)
				publish({ ...state, draft });
		},
		sendMessage() {
			syncIdentity();
			const message = state.draft.trim();
			if (!message || message.length > 1000) return Promise.resolve();
			return send({ message }, message);
		},
		sendQuestion(questionId: string) {
			syncIdentity();
			const question = state.catalogue?.questions.find(
				(q) => q.id === questionId,
			);
			return question
				? send({ question_id: question.id }, question.question)
				: Promise.resolve();
		},
		/** Reviewed V2 topic; reuses every existing request and draft guard. */
		sendTopic(topicId: string, title: string) {
			return send({ topic_id: topicId }, title);
		},
		retry(key: number) {
			syncIdentity();
			const item = state.exchanges.find(
				(exchange) => exchange.key === key && exchange.error,
			);
			return item ? send(item.input, item.label, item.key) : Promise.resolve();
		},
		clear(notice = "Conversation cleared.") {
			syncIdentity();
			// Conversation invalidation must not cancel independent fixed-safety loading.
			answerTicket++;
			publish({
				...state,
				exchanges: [],
				pending: false,
				draft: "",
				notice,
			});
		},
	};
}
