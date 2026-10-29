import { HStack, Toggle } from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	controlSize,
	frame,
	disabled as nativeDisabled,
	padding,
	toggleStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { localMonth, validMonth } from "../../lib/wear-history/model";
import {
	NativePage,
	NativeRow,
	NativeSection,
	NativeText,
	PageToggle,
} from "../native-page";
import { Feedback, useAction } from "../ui";
import {
	ownsSession,
	useSessionLease,
	useWearController,
	WEEKDAYS,
	WearAction,
} from "./native-support";

export type WearAutomationScreenProps = {
	owner: string;
};

type AutomationDraft = {
	enabled: boolean;
	weekdays: number[];
};

export default function WearAutomationScreen({
	owner,
}: WearAutomationScreenProps) {
	const store = useStore();
	const lease = useSessionLease();

	const initialMonth = store.state?.today.slice(0, 7) ?? localMonth();

	if (
		!lease ||
		!ownsSession(owner) ||
		store.account?.id !== owner ||
		!initialMonth ||
		!validMonth(initialMonth)
	) {
		return (
			<NativePage title="Automatic logging" insetMode="stack">
				<NativeSection title="Your preferences">
					<NativeText>Loading your account calendar…</NativeText>
				</NativeSection>
			</NativePage>
		);
	}

	return (
		<AutomationContent
			key={`${owner}:${lease}`}
			owner={owner}
			lease={lease}
			initialMonth={initialMonth}
		/>
	);
}

function AutomationContent({
	owner,
	lease,
	initialMonth,
}: WearAutomationScreenProps & {
	lease: string;
	initialMonth: string;
}) {
	const { controller, state, generation, lock, current, currentMonth } =
		useWearController(owner, lease, initialMonth);

	const action = useAction();

	const [enabled, setEnabled] = useState(false);
	const [weekdays, setWeekdays] = useState<number[]>([]);
	const [initialized, setInitialized] = useState(false);
	const [saving, setSaving] = useState(false);
	const [pending, setPending] = useState(false);

	const draft = useRef<AutomationDraft>({
		enabled: false,
		weekdays: [],
	});

	const revision = useRef(0);
	const savedRevision = useRef(0);
	const flushing = useRef(false);
	const mounted = useRef(false);

	const runtime = useRef({
		controller,
		generation,
		lock,
		current,
		currentMonth,
		action,
	});

	runtime.current = {
		controller,
		generation,
		lock,
		current,
		currentMonth,
		action,
	};

	useEffect(() => {
		mounted.current = true;

		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		if (initialized || !state.history) return;

		const automation = state.history.automation;

		const initial: AutomationDraft = {
			enabled: automation.enabled,
			weekdays: [...automation.weekdays],
		};

		draft.current = initial;
		setEnabled(initial.enabled);
		setWeekdays(initial.weekdays);
		setInitialized(true);
	}, [initialized, state.history]);

	const flush = useCallback(async () => {
		if (flushing.current || !mounted.current) return;

		flushing.current = true;
		setSaving(true);

		try {
			while (mounted.current && savedRevision.current < revision.current) {
				const { controller, generation, lock, current, currentMonth, action } =
					runtime.current;

				if (!current() || !currentMonth() || lock.current) {
					break;
				}

				const snapshot: AutomationDraft = {
					enabled: draft.current.enabled,
					weekdays: [...draft.current.weekdays],
				};

				const targetRevision = revision.current;
				const ticket = generation.current;

				if (snapshot.enabled && snapshot.weekdays.length === 0) {
					break;
				}

				lock.current = true;

				try {
					let saved = false;
					await action.run(async () => {
						const acknowledged = await controller.saveAutomation(
							snapshot.enabled,
							snapshot.weekdays,
						);

						if (!acknowledged) {
							throw new Error("Could not save automatic logging preferences.");
						}

						saved = true;
						return true;
					}, "Preferences saved.");

					if (!mounted.current || !current() || ticket !== generation.current) {
						break;
					}

					if (!saved) break;

					savedRevision.current = targetRevision;
					setPending(savedRevision.current < revision.current);
				} catch {
					// useAction handles operation feedback.
					// Leave the draft pending for manual retry.
					break;
				} finally {
					if (ticket === generation.current) {
						lock.current = false;
					}
				}
			}
		} finally {
			flushing.current = false;

			if (mounted.current) {
				setSaving(false);
				setPending(savedRevision.current < revision.current);
			}
		}
	}, []);

	const update = useCallback(
		(next: AutomationDraft) => {
			const { currentMonth, action } = runtime.current;

			if (!mounted.current || !initialized || !currentMonth()) {
				return;
			}

			const previous = draft.current;

			if (
				previous.enabled === next.enabled &&
				previous.weekdays.length === next.weekdays.length &&
				previous.weekdays.every((day, index) => day === next.weekdays[index])
			) {
				return;
			}

			draft.current = next;
			revision.current += 1;

			setEnabled(next.enabled);
			setWeekdays(next.weekdays);
			setPending(true);

			action.clearFeedback();
			void flush();
		},
		[flush, initialized],
	);

	const changeEnabled = useCallback(
		(value: boolean) => {
			update({
				...draft.current,
				enabled: value,
			});
		},
		[update],
	);

	const changeWeekday = useCallback(
		(index: number, checked: boolean) => {
			const previous = draft.current.weekdays;

			const nextWeekdays = checked
				? [...new Set([...previous, index])].sort((a, b) => a - b)
				: previous.filter((day) => day !== index);

			update({
				...draft.current,
				weekdays: nextWeekdays,
			});
		},
		[update],
	);

	const blocked = !initialized || state.loading;
	const invalid = enabled && weekdays.length === 0;

	return (
		<NativePage
			title="Automatic logging"
			subtitle="Optional assumed-wear rules"
			insetMode="stack"
		>
			<NativeText>
				Select the days you typically wear your lenses. Wear is automatically
				logged after each selected day ends. Changes are saved automatically.
			</NativeText>

			<NativeSection title="Your preferences">
				<NativeRow>
					{state.loading && !initialized && (
						<NativeText>Loading saved preferences…</NativeText>
					)}

					{!!state.error && <NativeText tone="error">{state.error}</NativeText>}

					{!initialized && !state.loading && (
						<WearAction
							label="Retry loading preferences"
							blocked={state.busy}
							onPress={() => {
								if (currentMonth()) {
									void controller.load(initialMonth);
								}
							}}
						/>
					)}

					<PageToggle
						label="Enable assumed-wear logging"
						value={enabled}
						disabled={blocked}
						onChange={changeEnabled}
					/>
				</NativeRow>
			</NativeSection>

			{enabled && (
				<NativeSection title="Assumed-wear logging">
					<HStack
						spacing={5}
						modifiers={[padding({ vertical: 12 }), frame({ minHeight: 44 })]}
					>
						{WEEKDAYS.map((label, index) => (
							<Toggle
								key={label}
								label={label.slice(0, 1)}
								isOn={weekdays.includes(index)}
								modifiers={[
									toggleStyle("button"),
									controlSize("small"),
									accessibilityLabel(
										`${label}: assume wear after the day ends`,
									),
									nativeDisabled(blocked),
									frame({
										maxWidth: Infinity,
										minHeight: 44,
									}),
								]}
								onIsOnChange={(checked) => {
									changeWeekday(index, checked);
								}}
							/>
						))}
					</HStack>

					{invalid && (
						<NativeText tone="error">
							Select at least one weekday to enable automatic logging.
						</NativeText>
					)}
				</NativeSection>
			)}

			<Feedback action={action} busyLabel="Saving preferences…" />

			{/* {!saving && pending && !invalid && ( */}
			{/*   <WearAction */}
			{/*     label="Retry saving" */}
			{/*     blocked={blocked} */}
			{/*     onPress={() => void flush()} */}
			{/*   /> */}
			{/* )} */}
		</NativePage>
	);
}
