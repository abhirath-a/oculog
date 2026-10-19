import { usePreventRemove } from "expo-router/react-navigation";
import { ActivityIndicator, View } from "react-native";
import type { SimpleState } from "../../../shared/simple-domain";
import { useStore } from "../../lib/store";
import { PresentationText, ScreenFrame } from "../presentation";
import { Button } from "../ui";
import SettingsForm from "./form";
import { useScheduleSettings } from "./use-schedule-settings";

function LoadedLensEditor({ state }: { state: SimpleState }) {
	const model = useScheduleSettings(state);
	// Complete both-eye reconciliation before allowing removal. Back otherwise
	// discards only the local draft. There is no unsaved-changes confirmation.
	usePreventRemove(model.busy, () => {});
	return <SettingsForm model={model} />;
}

export default function LensEditor() {
	const store = useStore();
	if (store.state)
		return <LoadedLensEditor key={store.account?.id} state={store.state} />;
	return (
		<ScreenFrame title="Lens setup" insetMode="stack" scrollOwner="frame">
			<View style={{ gap: 12 }} accessibilityLiveRegion="polite">
				<PresentationText heading>
					{store.loading ? "Loading lens setup" : "Lens setup is unavailable"}
				</PresentationText>
				<PresentationText tone="secondary">
					Connect to load your saved lens settings.
				</PresentationText>
				{store.loading ? (
					<ActivityIndicator accessibilityLabel="Loading lens setup" />
				) : (
					<>
						{!!store.error && (
							<PresentationText tone="danger">{store.error}</PresentationText>
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
