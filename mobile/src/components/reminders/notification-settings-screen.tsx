import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Linking } from "react-native";
import { sessionStore } from "../../lib/api";
import type {
	ReminderKind,
	ReminderPreferences,
} from "../../lib/local-reminders/model";
import {
	notificationContextReady,
	reminderManager,
} from "../../lib/local-reminders/runtime";
import { useStore } from "../../lib/store";
import {
	NativeAction,
	NativePage,
	NativeRow,
	NativeSection,
	NativeText,
	PageToggle,
} from "../native-page";
import { ReminderTimeField } from "./time-field";

const OPTIONS: {
	kind: ReminderKind;
	title: string;
	label: string;
	detail: string;
}[] = [
	{
		kind: "daily",
		title: "Daily lens log",
		label: "Daily check-in reminder",
		detail:
			"A daily prompt to review your wear log. It can still arrive after you have logged; this is not a background check for a missing entry.",
	},
	{
		kind: "replacement",
		title: "Lens replacement",
		label: "Replacement deadline reminders",
		detail:
			"Uses saved open-lens due dates: on the due date and the day after, grouping matching dates. If already overdue, one upcoming alert is used—not a notification storm. This does not measure hours of wear or detect sleeping in lenses.",
	},
	{
		kind: "prescription",
		title: "Prescription renewal",
		label: "Book before the prescription expires",
		detail:
			"Uses only your confirmed, device-saved expiry: normally 30 and 7 days before. If enabled close to expiry, the next feasible reminder before expiry is used. Unknown or already expired dates do not schedule renewal alerts.",
	},
];
function identity() {
	return sessionStore.isValid && sessionStore.account
		? JSON.stringify([sessionStore.account.id, sessionStore.token])
		: null;
}
export default function NotificationSettingsScreen() {
	const state = useSyncExternalStore(
		reminderManager.subscribe,
		reminderManager.getState,
		reminderManager.getState,
	);
	const store = useStore();
	const owner = useRef(sessionStore.account?.id);
	const locked = useRef(false);
	const mounted = useRef(false);
	const [actionBusy, setActionBusy] = useState(false);
	const [linkError, setLinkError] = useState(false);
	const [operationError, setOperationError] = useState(false);
	const operation = useRef(0);
	const renderLease = identity();
	const current = () =>
		!!renderLease &&
		identity() === renderLease &&
		owner.current === sessionStore.account?.id;
	useEffect(() => {
		mounted.current = true;
		void reminderManager.load();
		const unsubscribe = sessionStore.onChange(() => {
			operation.current++;
			locked.current = false;
			setActionBusy(false);
			setLinkError(false);
			setOperationError(false);
		});
		return () => {
			mounted.current = false;
			operation.current++;
			unsubscribe();
		};
	}, []);
	const run = (action: () => Promise<void>, needsContext = true) => {
		if (
			!current() ||
			locked.current ||
			state.loading ||
			state.busy ||
			(needsContext && !notificationContextReady())
		)
			return;
		locked.current = true;
		setActionBusy(true);
		setOperationError(false);
		const key = ++operation.current;
		void Promise.resolve()
			.then(() => {
				if (mounted.current && key === operation.current && current())
					return action();
			})
			.catch(() => {
				if (mounted.current && key === operation.current && current())
					setOperationError(true);
			})
			.finally(() => {
				if (key === operation.current) {
					locked.current = false;
					if (mounted.current) setActionBusy(false);
				}
			});
	};
	const update = (
		kind: ReminderKind,
		patch: Partial<ReminderPreferences[ReminderKind]>,
	) =>
		run(() => {
			const prefs = reminderManager.getState().preferences;
			return reminderManager.updatePreferences({
				...prefs,
				[kind]: { ...prefs[kind], ...patch },
			});
		});
	const busy = actionBusy || state.busy || state.loading;
	const controlsBlocked = busy || !notificationContextReady();
	return (
		<NativePage title="Notifications" insetMode="stack">
			<NativeSection title="Local to this iPhone">
				<NativeRow>
					<NativeText>
						Preferences stay on this device for your signed-in account. No push
						registration, prescription upload or server notification service is
						used.
					</NativeText>
					<NativeText>
						{state.loading
							? "Reading local preferences…"
							: state.permission === "granted"
								? "iOS permission allowed. Focus, quiet delivery and system settings can still delay or silence alerts."
								: state.permission === "denied"
									? "Notifications are blocked in iOS. Oculog preferences alone cannot enable delivery."
									: state.permission === "unavailable"
										? "Local notifications are unavailable in this runtime."
										: "Choose a reminder below to request iOS permission. Permission is not requested automatically."}
					</NativeText>
					<NativeText>{`Scheduled requests reported: ${state.scheduledCount}`}</NativeText>
					{!!state.error && <NativeText tone="error">{state.error}</NativeText>}
					{operationError && (
						<NativeText tone="error">
							Could not update local reminders. Refresh permission and schedules
							before retrying.
						</NativeText>
					)}
					{!!state.notice && (
						<NativeText tone="secondary">{state.notice}</NativeText>
					)}
					<NativeAction
						label="Open iOS notification settings"
						onPress={() => {
							if (current())
								void Linking.openSettings().catch(() => {
									if (mounted.current && current()) setLinkError(true);
								});
						}}
					/>
					{linkError && (
						<NativeText tone="error">
							Could not open iOS settings. Open Settings → Notifications →
							Oculog manually.
						</NativeText>
					)}
					<NativeAction
						label="Refresh permission and schedules"
						disabled={busy}
						onPress={() => run(() => reminderManager.reconcile(), false)}
					/>
				</NativeRow>
			</NativeSection>
			{OPTIONS.map(({ kind, title, label, detail }) => (
				<NativeSection key={kind} title={title}>
					<NativeRow>
						<PageToggle
							label={label}
							value={state.preferences[kind].enabled}
							disabled={controlsBlocked || state.permission === "unavailable"}
							onChange={(enabled) => update(kind, { enabled })}
						/>
						<ReminderTimeField
							label={`${title} time`}
							hour={state.preferences[kind].hour}
							minute={state.preferences[kind].minute}
							disabled={controlsBlocked}
							onCommit={(hour, minute) => update(kind, { hour, minute })}
						/>
						<NativeText tone="secondary">{detail}</NativeText>
					</NativeRow>
				</NativeSection>
			))}
			<NativeSection title="What reminders know">
				<NativeRow>
					<NativeText>
						Replacement alerts use the last confirmed lens schedule, not an
						assumption that you are currently wearing lenses. Reopen Oculog
						after changes elsewhere so this phone can refresh its local alerts.
					</NativeText>
					{store.pending && (
						<NativeText tone="secondary">
							A log or schedule change is pending; reminders retain the last
							confirmed snapshot until it completes.
						</NativeText>
					)}
					<NativeText>
						Notifications avoid prescription values and expiry dates on the lock
						screen. Open the authenticated app to see details. Signing out
						cancels these local reminders; preferences remain saved for the same
						account on this phone.
					</NativeText>
					<NativeText tone="secondary">
						Times follow this iPhone. Your daily log still uses your account’s
						calendar/time zone. Notifications are a convenience, not a guarantee
						or medical monitoring.
					</NativeText>
				</NativeRow>
			</NativeSection>
			<NativeSection title="Pause all Oculog reminders">
				<NativeRow>
					<NativeAction
						label="Turn off these reminders"
						disabled={controlsBlocked}
						onPress={() =>
							run(() => {
								const p = reminderManager.getState().preferences;
								return reminderManager.updatePreferences({
									...p,
									daily: { ...p.daily, enabled: false },
									replacement: { ...p.replacement, enabled: false },
									prescription: { ...p.prescription, enabled: false },
								});
							})
						}
					/>
				</NativeRow>
			</NativeSection>
		</NativePage>
	);
}
