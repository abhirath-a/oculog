import { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import { sessionStore } from "../../lib/api";
import { useStore } from "../../lib/store";
import { TodayText } from "../home/today-design";
import TodayFeedback from "../home/today-feedback";
import { OnboardingAction, OnboardingPage } from "../onboarding/page";
import { notifySuccess } from "../presentation/haptics";
import { LensSetupFields } from "./lens-setup-fields";
import type { SettingsModel } from "./use-schedule-settings";

/** iOS presentation only. The existing controller still owns every write/ledger. */
export default function EditorForm({ model }: { model: SettingsModel }) {
	const owner = useStore().account?.id;
	const token = sessionStore.token;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: token snapshots a mutable session; rotation must invalidate old callbacks.
	const current = useCallback(
		() =>
			mounted.current &&
			!!owner &&
			sessionStore.account?.id === owner &&
			sessionStore.token === token,
		[owner, token],
	);
	const previousEvent = useRef(model.savedEvent);
	useEffect(() => {
		if (previousEvent.current === model.savedEvent) return;
		previousEvent.current = model.savedEvent;
		if (current()) void notifySuccess().catch(() => {});
	}, [model.savedEvent, current]);
	const change: SettingsModel["change"] = (key, value) => {
		if (current() && !model.disabled && model.canLeave())
			model.change(key, value);
	};
	return (
		<View style={{ flex: 1, minHeight: 0 }}>
			<OnboardingPage
				insetMode="stack"
				footer={
					<>
						{model.busy && (
							<TodayText tone="secondary">Saving your plan…</TodayText>
						)}
						<OnboardingAction
							label={model.busy ? "Saving…" : "Save changes"}
							primary
							disabled={model.disabled}
							onPress={() => {
								if (current() && !model.disabled && model.canLeave())
									model.save();
							}}
						/>
					</>
				}
			>
				<TodayText tone="secondary">
					Your prescribed timing, in one place. Today uses this plan to show
					each lens’s replacement date.
				</TodayText>
				<LensSetupFields
					key={JSON.stringify([owner, token])}
					model={model}
					change={change}
					current={current}
				/>
			</OnboardingPage>
			<TodayFeedback
				visible
				action={{
					busy: model.busy,
					error: model.error,
					message: model.message,
				}}
				addAction={{ busy: false, error: "", message: "" }}
			/>
		</View>
	);
}
