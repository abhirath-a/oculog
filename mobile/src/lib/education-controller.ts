import type {
	EducationLanguage,
	EducationOptions,
	EducationStatus,
	educationAPI,
} from "./education-api";

type State = {
	status: EducationStatus | null;
	loading: boolean;
	busy: boolean;
	enabled: boolean;
	adultAck: boolean;
	externalConsent: boolean;
	language: EducationLanguage;
	error: string | null;
};
const initial = (): State => ({
	status: null,
	loading: false,
	busy: false,
	enabled: false,
	adultAck: false,
	externalConsent: false,
	language: "en",
	error: null,
});
const failure = (e: unknown) =>
	e instanceof Error ? e.message : "Education settings could not be updated.";
/** Separate session/token and operation guards. A server grant never restores local enable. */
export function createEducationController(
	api: ReturnType<typeof educationAPI>,
	currentIdentity: () => string | null,
	clearConversation: (notice: string) => void,
) {
	let owner = currentIdentity(),
		generation = 0,
		ticket = 0,
		active = true,
		state = initial();
	const listeners = new Set<() => void>();
	function publish(next: State) {
		state = next;
		for (const listener of listeners) listener();
	}
	function syncIdentity() {
		const next = currentIdentity();
		if (next === owner) return false;
		owner = next;
		generation++;
		ticket++;
		publish(initial());
		return true;
	}
	function valid(epoch: number, identity: string | null, operation: number) {
		if (!active) return false;
		syncIdentity();
		return (
			!!identity &&
			owner === identity &&
			epoch === generation &&
			operation === ticket
		);
	}
	async function load() {
		syncIdentity();
		if (!active || !owner || state.busy || state.loading) return;
		const epoch = generation,
			identity = owner,
			operation = ++ticket;
		publish({ ...state, loading: true, error: null });
		try {
			const status = await api.status();
			if (valid(epoch, identity, operation)) {
				const wasEnabled = state.enabled;
				const enabled =
					wasEnabled &&
					status.consent.granted &&
					status.consent.adult_ack &&
					status.provider.available &&
					status.consent.epoch === state.status?.consent.epoch;
				publish({ ...state, status, loading: false, enabled });
				if (wasEnabled && !enabled)
					clearConversation(
						"Gemini availability or consent changed. Conversation and pending answers cleared; Gemini is off until a new explicit grant.",
					);
			}
		} catch (e) {
			if (valid(epoch, identity, operation)) {
				const wasEnabled = state.enabled;
				publish({
					...state,
					loading: false,
					enabled: false,
					error: failure(e),
				});
				if (wasEnabled)
					clearConversation(
						"Gemini status could not be confirmed. Conversation and pending answers cleared; Gemini is off until a new explicit grant.",
					);
			}
		}
	}
	async function grant() {
		syncIdentity();
		if (
			!active ||
			!owner ||
			state.busy ||
			!state.status ||
			!state.adultAck ||
			!state.externalConsent ||
			!state.status.provider.available
		)
			return;
		const epoch = generation,
			identity = owner,
			operation = ++ticket,
			status = state.status;
		publish({
			...state,
			enabled: false,
			busy: true,
			loading: false,
			error: null,
		});
		try {
			const consent = await api.consent(status.disclosure.version, true, true);
			if (valid(epoch, identity, operation)) {
				if (
					!consent.granted ||
					!consent.adult_ack ||
					consent.epoch <= status.consent.epoch
				)
					throw new Error(
						"Consent was not freshly confirmed. Gemini remains off.",
					);
				publish({
					...state,
					busy: false,
					enabled: true,
					status: { ...status, consent },
				});
			}
		} catch (e) {
			if (valid(epoch, identity, operation))
				publish({ ...state, busy: false, enabled: false, error: failure(e) });
		}
	}
	async function withdraw() {
		syncIdentity();
		if (!active) return;
		const epoch = generation,
			identity = owner,
			operation = ++ticket,
			status = state.status;
		// This happens synchronously before the first await, even if the network fails.
		publish({
			...state,
			enabled: false,
			externalConsent: false,
			busy: !!identity && !!status,
			loading: false,
			error: null,
		});
		clearConversation(
			"Gemini turned off. Conversation and pending answers cleared. Requests already transmitted cannot be recalled.",
		);
		if (!identity || !status) return;
		try {
			const consent = await api.consent(
				status.disclosure.version,
				false,
				false,
			);
			if (valid(epoch, identity, operation)) {
				if (consent.granted || consent.epoch <= status.consent.epoch)
					throw new Error("Withdrawal was not confirmed by the server.");
				publish({ ...state, busy: false, status: { ...status, consent } });
			}
		} catch (e) {
			if (valid(epoch, identity, operation))
				publish({
					...state,
					busy: false,
					error: `Gemini is off on this screen. Server withdrawal could not be confirmed: ${failure(e)}`,
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
		load,
		grant,
		withdraw,
		mount() {
			if (!active) {
				active = true;
				generation++;
				publish(initial());
			}
			syncIdentity();
		},
		dispose() {
			active = false;
			generation++;
			ticket++;
			state = initial();
		},
		setAdultAck(value: boolean) {
			syncIdentity();
			if (active && owner && !state.busy)
				publish({ ...state, adultAck: value });
		},
		setExternalConsent(value: boolean) {
			syncIdentity();
			if (active && owner && !state.busy)
				publish({ ...state, externalConsent: value });
		},
		setLanguage(language: EducationLanguage) {
			syncIdentity();
			if (active && owner && (language === "en" || language === "es"))
				publish({ ...state, language });
		},
		options(): EducationOptions {
			syncIdentity();
			const use_ai = !!(
				active &&
				owner &&
				state.enabled &&
				state.status?.consent.granted &&
				state.status.consent.adult_ack &&
				state.status.provider.available
			);
			return {
				language: state.language,
				use_ai,
				...(use_ai ? { consent_epoch: state.status?.consent.epoch } : {}),
			};
		},
	};
}
