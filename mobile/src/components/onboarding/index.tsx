import { useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { ActivityIndicator, View } from "react-native";
import type { SimpleState } from "../../../shared/simple-domain";
import { sessionStore } from "../../lib/api";
import { useStore } from "../../lib/store";
import { PresentationText, ScreenFrame } from "../presentation";
import SettingsForm from "../settings/form";
import { useScheduleSettings } from "../settings/use-schedule-settings";
import { Button } from "../ui";

const title = "Lens setup";
const subtitle = "Optional. You can set up or change this later in Settings.";

function LoadedOnboarding({
	state,
	onSkip,
}: {
	state: SimpleState;
	onSkip: () => void;
}) {
	// The same conflict handling, both-eye validation and persistence as Settings.
	const model = useScheduleSettings(state);
	// Do not lose the partial-eye ledger during an explicit save.
	usePreventRemove(model.busy, () => {});
	const leave = () => {
		if (model.canLeave()) onSkip();
	};
	return (
		<ScreenFrame
			title={title}
			subtitle={subtitle}
			insetMode="stack"
			scrollOwner="content"
		>
			<View
				style={{
					paddingHorizontal: 20,
					paddingBottom: 8,
					gap: 8,
					minWidth: 0,
					alignItems: "stretch",
				}}
			>
				<Button
					title="Skip"
					variant="text"
					fullWidth
					disabled={model.accountDisabled}
					onPress={leave}
				/>
				{model.message === "Changes saved." && !model.busy && (
					<Button
						title="Continue to Today"
						fullWidth
						disabled={model.accountDisabled}
						onPress={leave}
					/>
				)}
			</View>
			<SettingsForm model={model} onboarding />
		</ScreenFrame>
	);
}

export default function Onboarding() {
	const store = useStore();
	const router = useRouter();
	const owner = store.account?.id;
	const token = sessionStore.token;
	const skip = () => {
		// A stale screen must not navigate on behalf of a different session.
		if (
			!owner ||
			sessionStore.account?.id !== owner ||
			sessionStore.token !== token
		)
			return;
		// No completion flag, draft mutation or persistence on the skip path.
		router.replace("/(tabs)/home");
	};

	if (store.state)
		return <LoadedOnboarding state={store.state} onSkip={skip} />;

	return (
		<ScreenFrame
			title={title}
			subtitle={subtitle}
			insetMode="stack"
			scrollOwner="frame"
		>
			<View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
				<Button title="Skip" variant="text" onPress={skip} />
			</View>
			<View style={{ padding: 20, gap: 16 }} accessibilityLiveRegion="polite">
				<PresentationText heading>
					{store.loading ? "Loading your schedule" : "Connect to set up"}
				</PresentationText>
				<PresentationText tone="secondary">
					{store.loading
						? "Getting your saved lens settings. You can skip without waiting."
						: "Your schedule is unavailable. Retry when connected, or skip and set up later in Settings. Your last saved settings will load when connected."}
				</PresentationText>
				{store.loading ? (
					<ActivityIndicator accessibilityLabel="Loading schedule" />
				) : (
					<>
						{!!store.error && (
							<View accessibilityRole="alert">
								<PresentationText tone="danger">{store.error}</PresentationText>
							</View>
						)}
						<Button
							title="Retry connection"
							disabled={store.pending}
							onPress={() => void store.reload()}
						/>
					</>
				)}
			</View>
		</ScreenFrame>
	);
}
