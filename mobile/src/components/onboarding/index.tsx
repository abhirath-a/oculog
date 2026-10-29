import { useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";
import type { SimpleState } from "../../../shared/simple-domain";
import { sessionStore } from "../../lib/api";
import { useStore } from "../../lib/store";
import { TodayText } from "../home/today-design";
import { notifySuccess } from "../presentation/haptics";
import { LensSetupFields } from "../settings/lens-setup-fields";
import {
	type SettingsModel,
	useScheduleSettings,
} from "../settings/use-schedule-settings";
import {
	OnboardingAction,
	OnboardingHeading,
	OnboardingPage,
	OnboardingSection,
	type OnboardingStage,
	ReadyContent,
	WelcomeContent,
} from "./page";

type FlowProps = {
	stage: OnboardingStage;
	current(): boolean;
	move(stage: OnboardingStage): void;
	leave(): void;
};

type SaveAttempt = {
	savedEvent: number;
	validationEvent: number;
	draft: string;
};

/** The controller stays mounted during every step, including Ready and review.
 * Save is still entirely owned by the existing controller, including its partial-eye ledger.
 */
function LoadedOnboarding({
	state,
	stage,
	current,
	move,
	leave,
}: FlowProps & { state: SimpleState }) {
	const model = useScheduleSettings(state);
	usePreventRemove(model.busy, () => {});
	const attempt = useRef<SaveAttempt | null>(null);
	const [request, setRequest] = useState(0);
	const latest = useRef(model);
	latest.current = model;
	const canAct = () => current() && model.canLeave();
	const go = (next: OnboardingStage) => {
		if (!canAct()) return;
		attempt.current = null;
		move(next);
	};
	const skip = () => {
		if (!canAct()) return;
		attempt.current = null;
		leave();
	};
	const save = () => {
		if (stage !== "setup" || !canAct() || model.disabled) return;
		attempt.current = {
			savedEvent: model.savedEvent,
			validationEvent: model.validationEvent,
			draft: JSON.stringify(model.draft),
		};
		model.save();
		// canLeave reads the controller's synchronous lock. If Save did not start
		// (validation, stale revision, disabled), an old success message is NOT proof.
		if (model.canLeave()) attempt.current = null;
		setRequest((value) => value + 1);
	};
	useEffect(() => {
		void request;
		const pending = attempt.current;
		if (!pending || model.busy || !model.canLeave()) return;
		attempt.current = null;
		// A started run clears its old feedback. Inspect only after its lock releases:
		// conflict/cancel/partial failure returns false and cannot produce this message.
		// A valid explicit no-op save can succeed without incrementing savedEvent.
		if (
			!current() ||
			stage !== "setup" ||
			model.message !== "Changes saved." ||
			model.error ||
			model.connectionError ||
			model.validationEvent !== pending.validationEvent ||
			Object.keys(model.fieldErrors).length > 0 ||
			JSON.stringify(model.draft) !== pending.draft
		)
			return;
		move("ready");
		if (model.savedEvent > pending.savedEvent)
			void notifySuccess().catch(() => {});
	}, [request, model, current, stage, move]);
	const change: SettingsModel["change"] = (key, value) => {
		if (
			!current() ||
			stage !== "setup" ||
			latest.current.disabled ||
			!model.canLeave()
		)
			return;
		attempt.current = null;
		model.change(key, value);
	};
	return (
		<OnboardingPage
			footer={
				stage === "welcome" ? (
					<>
						<OnboardingAction
							label="Set up my lenses"
							primary
							disabled={model.accountDisabled}
							onPress={() => go("setup")}
						/>
						<OnboardingAction
							label="Explore first"
							disabled={model.accountDisabled}
							onPress={skip}
						/>
					</>
				) : stage === "ready" ? (
					<>
						<OnboardingAction
							label="Go to Today"
							primary
							disabled={model.accountDisabled}
							onPress={skip}
						/>
						<OnboardingAction
							label="Review setup"
							disabled={model.accountDisabled}
							onPress={() => go("setup")}
						/>
					</>
				) : (
					<>
						{model.busy && (
							<TodayText tone="secondary">Saving lens schedule…</TodayText>
						)}
						<OnboardingAction
							label={model.busy ? "Saving…" : "Save lens schedule"}
							primary
							disabled={model.disabled}
							onPress={save}
						/>
						<OnboardingAction
							label="Set up later"
							disabled={model.accountDisabled}
							onPress={skip}
						/>
					</>
				)
			}
		>
			{stage === "welcome" ? (
				<WelcomeContent />
			) : stage === "ready" ? (
				<ReadyContent />
			) : (
				<>
					<OnboardingAction
						label="Back to welcome"
						disabled={model.accountDisabled}
						onPress={() => go("welcome")}
					/>
					<OnboardingHeading
						step="Step 2 of 2"
						title="Your lens schedule"
						compact
						detail="Set your prescribed timing. Add opened dates when you’re ready."
					/>
					<LensSetupFields model={model} change={change} current={current} />
				</>
			)}
		</OnboardingPage>
	);
}

/** Identity-keyed presentation state is also token-keyed: no old step, picker,
 * attempt or callback can cross an account/session boundary.
 */
function SessionOnboarding({
	owner,
	token,
}: {
	owner: string | undefined;
	token: typeof sessionStore.token;
}) {
	const store = useStore();
	const router = useRouter();
	const [stage, setStage] = useState<OnboardingStage>("welcome");
	const stageRef = useRef(stage);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const current = () =>
		mounted.current &&
		!!owner &&
		sessionStore.account?.id === owner &&
		sessionStore.token === token &&
		stageRef.current === stage;
	const move = (next: OnboardingStage) => {
		if (!current()) return;
		stageRef.current = next;
		setStage(next);
	};
	const leave = () => {
		if (!current() || store.pending) return;
		// Explore/skip never writes settings or an onboarding-completion flag.
		router.replace("/(tabs)/home");
	};
	// Retain the loaded controller through transient unavailability in this session.
	const loaded = useRef<SimpleState | null>(null);
	if (store.state) loaded.current = store.state;
	if (loaded.current)
		return (
			<LoadedOnboarding
				state={loaded.current}
				stage={stage}
				current={current}
				move={move}
				leave={leave}
			/>
		);
	return (
		<OnboardingPage
			footer={
				stage === "welcome" ? (
					<>
						<OnboardingAction
							label="Set up my lenses"
							primary
							disabled={store.pending}
							onPress={() => {
								if (!store.pending) move("setup");
							}}
						/>
						<OnboardingAction
							label="Explore first"
							disabled={store.pending}
							onPress={leave}
						/>
					</>
				) : (
					<OnboardingAction
						label="Set up later"
						disabled={store.pending}
						onPress={leave}
					/>
				)
			}
		>
			{stage === "welcome" ? (
				<WelcomeContent />
			) : (
				<>
					<OnboardingAction
						label="Back to welcome"
						disabled={store.pending}
						onPress={() => {
							if (!store.pending) move("welcome");
						}}
					/>
					<OnboardingHeading
						step="Step 2 of 2"
						title="Your lens schedule"
						detail="Saving your prescribed schedule makes Today show useful replacement dates. You can also set up later in Account."
					/>
					<OnboardingSection
						title={
							store.loading ? "Loading your schedule" : "Connect to set up"
						}
					>
						<TodayText tone="secondary">
							{store.loading
								? "Getting your saved lens settings. You can set up later without waiting."
								: "Your schedule is unavailable. Retry when connected, or explore first and set up later in Account."}
						</TodayText>
						{!!store.error && <TodayText tone="error">{store.error}</TodayText>}
						<OnboardingAction
							label="Retry connection"
							disabled={store.loading || store.pending}
							onPress={() => {
								if (current() && !store.loading && !store.pending)
									void store.reload();
							}}
						/>
					</OnboardingSection>
				</>
			)}
		</OnboardingPage>
	);
}

export default function Onboarding() {
	const store = useStore();
	const owner = store.account?.id;
	const token = sessionStore.token;
	return (
		<SessionOnboarding
			key={JSON.stringify([owner, token])}
			owner={owner}
			token={token}
		/>
	);
}
