import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SimpleState } from "../../../shared/simple-domain";
import { sessionStore } from "../../lib/api";
import { deviceTimeZone } from "../../lib/simple-controller";
import { useStore } from "../../lib/store";
import { confirm, useAction } from "../ui";
import {
	initialDraft,
	type ScheduleDraft,
	ScheduleValidationError,
	scheduleCommands,
} from "./schedule";

export type SettingsModel = {
	draft: ScheduleDraft;
	change: <K extends keyof ScheduleDraft>(
		key: K,
		value: ScheduleDraft[K],
	) => void;
	disabled: boolean;
	accountDisabled: boolean;
	email: string;
	timeZone: string;
	/** Current account-calendar day from the authoritative server snapshot. */
	today: string;
	error: string;
	accountError: string;
	message: string;
	busy: boolean;
	connectionError: string;
	loading: boolean;
	save: () => void;
	signOut: () => void;
	reload: () => void;
	/** Synchronous route/Skip guard, including the first frame of an operation. */
	canLeave: () => boolean;
	/** Local validation only; transport failures remain in error/connectionError. */
	fieldErrors: Partial<Record<keyof ScheduleDraft, string>>;
	/** Monotonic event counter, incremented only after a complete successful save. */
	savedEvent: number;
	/** New local validation attempt, including repeated saves of the same error. */
	validationEvent: number;
};

export async function confirmedSignOut(
	current: () => boolean,
	email: string,
	logout: () => Promise<void>,
) {
	if (!current()) return false;
	if (
		!(await confirm(
			"Sign out?",
			`Sign out of ${email || "this account"}? Your lens log stays saved.`,
		)) ||
		!current()
	)
		return false;
	await logout();
}

function signature(value: SimpleState) {
	return JSON.stringify([
		value.timeZone,
		...value.eyes.map((eye) => [eye.eye, eye.replacementDays, eye.openedOn]),
	]);
}

/** Reusable schedule controller. Requires the Store provider and a loaded state for
 * the signed-in account. Mount keyed by account ID; pass each authoritative state
 * update. Owns drafts, validation, explicit save, reconciliation and account actions.
 * No writes occur on change; save never replaces lenses or consumes inventory.
 */
export function useScheduleSettings(state: SimpleState): SettingsModel {
	const store = useStore();
	const action = useAction();
	const accountAction = useAction();
	const [operation, setOperation] = useState<"save" | "signOut" | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const initial = useRef(state);
	const saved = useRef(
		initial.current.eyes.map((eye) => ({
			...eye,
			timeZone: initial.current.timeZone,
		})),
	);
	const [draft, setDraft] = useState(() => initialDraft(initial.current));
	const [fieldErrors, setFieldErrors] = useState<SettingsModel["fieldErrors"]>(
		{},
	);
	const [savedEvent, setSavedEvent] = useState(0);
	const [validationEvent, setValidationEvent] = useState(0);
	const baselineDraft = useRef(initialDraft(state));
	const observed = useRef(signature(state));
	const dirty = useRef(false);
	const revision = useRef(0);
	const renderedRevision = revision.current;
	const locked = useRef(false);
	const latest = useRef({
		state,
		busy: action.busy,
		pending: store.pending,
		loading: store.loading,
		online: store.online,
	});
	latest.current = {
		state,
		busy: action.busy,
		pending: store.pending,
		loading: store.loading,
		online: store.online,
	};
	const reconcile = useCallback(() => {
		const next = {
			state,
			busy: action.busy,
			pending: store.pending,
			loading: store.loading,
		};
		if (
			dirty.current ||
			locked.current ||
			next.busy ||
			next.pending ||
			next.loading
		)
			return;
		if (signature(next.state) === observed.current) return;
		revision.current += 1;
		observed.current = signature(next.state);
		baselineDraft.current = initialDraft(next.state);
		saved.current = next.state.eyes.map((eye) => ({
			...eye,
			timeZone: next.state.timeZone,
		}));
		setFieldErrors({});
		setDraft(baselineDraft.current);
	}, [state, action.busy, store.pending, store.loading]);
	useFocusEffect(reconcile);
	useEffect(reconcile, [reconcile]);
	const timeZone = deviceTimeZone();
	const disabled =
		operation !== null ||
		action.busy ||
		store.pending ||
		store.loading ||
		!store.online;
	const owner = store.account?.id;
	const token = sessionStore.token;
	const current = () =>
		mounted.current &&
		!!owner &&
		sessionStore.account?.id === owner &&
		sessionStore.token === token;
	const blocked = () =>
		locked.current || latest.current.busy || latest.current.pending;
	// Both operations share this synchronous lock, including confirmation time.
	// Separate feedback prevents a cancelled sign-out from changing save status.
	const run = (
		kind: "save" | "signOut",
		fn: () => Promise<unknown>,
		message: string,
	) => {
		if (blocked() || !current()) return;
		locked.current = true;
		setOperation(kind);
		const feedback = kind === "save" ? action : accountAction;
		void feedback.run(fn, message).finally(() => {
			locked.current = false;
			if (mounted.current) setOperation(null);
		});
	};
	async function save() {
		// Guard stale render callbacks and account/session changes before any write.
		if (!current() || revision.current !== renderedRevision) return false;
		const incomingSignature = signature(latest.current.state);
		// Accept only our exact successful schedule, including partially saved eyes.
		if (
			incomingSignature ===
			signature({
				...latest.current.state,
				timeZone: saved.current[0]?.timeZone ?? initial.current.timeZone,
				eyes: saved.current,
			})
		)
			observed.current = incomingSignature;
		if (incomingSignature !== observed.current) {
			if (
				!(await confirm(
					"Schedule changed",
					"Lens settings changed. Keep your edits and update unchanged fields? Review all values before saving again.",
				)) ||
				!current()
			)
				return false;
			const incoming = latest.current.state;
			const refreshed = initialDraft(incoming);
			const merged = { ...draft };
			for (const key of Object.keys(refreshed) as (keyof ScheduleDraft)[]) {
				if (draft[key] === baselineDraft.current[key])
					Object.assign(merged, { [key]: refreshed[key] });
			}
			observed.current = signature(incoming);
			baselineDraft.current = refreshed;
			saved.current = incoming.eyes.map((eye) => ({
				...eye,
				timeZone: incoming.timeZone,
			}));
			revision.current += 1;
			setDraft(merged);
			return false;
		}
		// Validate both eyes before any write. Never replace/decrement inventory here.
		let commands: ReturnType<typeof scheduleCommands>;
		try {
			commands = scheduleCommands(draft, timeZone, latest.current.state.today);
		} catch (error) {
			if (!(error instanceof ScheduleValidationError)) throw error;
			setFieldErrors({ [error.field]: error.message });
			setValidationEvent((event) => event + 1);
			return false;
		}
		let committed = false;
		for (const command of commands) {
			if (!current()) return false;
			const previous = saved.current.find((eye) => eye.eye === command.eye);
			if (
				previous?.replacementDays === command.replacementDays &&
				previous.openedOn === command.openedOn &&
				previous.timeZone === timeZone
			)
				continue;
			if (!(await store.mutate("settings", command))) return false;
			if (!current()) return false;
			committed = true;
			// Preserve partial success so a retry writes only the remaining eye.
			observed.current = signature(latest.current.state);
			saved.current = saved.current.map((eye) =>
				eye.eye === command.eye ? { ...eye, ...command } : eye,
			);
		}
		baselineDraft.current = draft;
		dirty.current = false;
		if (committed) setSavedEvent((event) => event + 1);
	}
	return {
		draft,
		change: (key, value) => {
			if (
				blocked() ||
				latest.current.loading ||
				!latest.current.online ||
				!current()
			)
				return;
			dirty.current = true;
			revision.current += 1;
			setFieldErrors((previous) => {
				const next = { ...previous };
				const relevant: (keyof ScheduleDraft)[] =
					key === "differentIntervals"
						? ["leftDays", "rightDays"]
						: key === "differentDates"
							? ["leftOpened", "rightOpened"]
							: [key];
				for (const field of relevant) delete next[field];
				return next;
			});
			setDraft((previous) => ({ ...previous, [key]: value }));
		},
		disabled,
		accountDisabled: operation !== null || action.busy || store.pending,
		email: store.account?.email || "",
		timeZone: timeZone.replaceAll("_", " "),
		today: state.today,
		error: action.error,
		accountError: accountAction.error,
		message: dirty.current ? "" : action.message,
		busy: operation === "save",
		connectionError:
			store.error ||
			(!store.online ? "You’re offline. Reconnect before saving changes." : ""),
		loading: store.loading,
		fieldErrors,
		savedEvent,
		validationEvent,
		save: () => {
			if (
				!disabled &&
				!latest.current.loading &&
				latest.current.online &&
				!blocked() &&
				current()
			) {
				if (revision.current !== renderedRevision) return;
				// Local validation must not disable the native editor: focus requests sent
				// while Compose is applying enabled=false are discarded, even if JS has
				// already finished the action. Keep the guarded save validation as well.
				try {
					// A changed remote schedule still goes through save's existing review
					// flow first; preflight must not bypass reconciliation/session guards.
					if (signature(latest.current.state) === observed.current)
						scheduleCommands(draft, timeZone, latest.current.state.today);
				} catch (error) {
					if (!(error instanceof ScheduleValidationError)) throw error;
					setFieldErrors({ [error.field]: error.message });
					setValidationEvent((event) => event + 1);
					return;
				}
				setFieldErrors({});
				run("save", save, "Changes saved.");
			}
		},
		signOut: () => {
			if (action.busy || store.pending) return;
			run(
				"signOut",
				() =>
					confirmedSignOut(current, store.account?.email || "", store.logout),
				"",
			);
		},
		canLeave: () => current() && !blocked(),
		reload: () => {
			if (!blocked() && !store.loading && current()) void store.reload();
		},
	};
}
