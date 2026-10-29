import { useEffect, useRef, useState } from "react";
import type { SimpleState } from "../../../shared/simple-domain";
import { sessionStore } from "../../lib/api";
import { useStore } from "../../lib/store";

/** Optimistic wear selection only. Confirmed state, dates, stock and writes stay with the owner. */
export function useTodayWear(
	state: SimpleState,
	disabled: boolean,
	onLog: (value: boolean) => void,
) {
	const store = useStore();
	const scope = JSON.stringify([
		store.account?.id,
		sessionStore.token,
		state.today,
		state.timeZone,
	]);
	const [draft, setDraft] = useState<{ value: boolean; scope: string } | null>(
		null,
	);
	const dispatching = useRef(false);
	const validDraft =
		draft?.scope === scope && store.online && !store.error ? draft : null;
	const saving = validDraft !== null;
	useEffect(() => {
		// disabled includes the owner's pending action. A settled/rejected action,
		// offline error or account/calendar transition restores confirmed selection.
		if (
			!draft ||
			draft.scope !== scope ||
			!store.online ||
			store.error ||
			!disabled ||
			state.daily.worn === draft.value
		) {
			dispatching.current = false;
			if (draft) setDraft(null);
		}
	}, [draft, scope, store.online, store.error, disabled, state.daily.worn]);
	return {
		selected: saving ? validDraft.value : state.daily.worn,
		saving: saving ? validDraft.value : null,
		disabled: disabled || saving,
		choose(value: boolean) {
			if (disabled || saving || dispatching.current) return;
			dispatching.current = true;
			setDraft({ value, scope });
			try {
				onLog(value);
			} catch (error) {
				dispatching.current = false;
				setDraft(null);
				throw error;
			}
		},
	};
}
