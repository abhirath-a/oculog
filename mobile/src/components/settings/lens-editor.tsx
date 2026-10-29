import { usePreventRemove } from "expo-router/react-navigation";
import type { SimpleState } from "../../../shared/simple-domain";
import { useStore } from "../../lib/store";
import {
	NativeAction,
	NativePage,
	NativeRow,
	NativeSection,
	NativeText,
} from "../native-page";
import SettingsForm from "./editor-form";
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
		<NativePage title="Lens setup" insetMode="stack">
			<NativeSection title="Connection">
				<NativeRow>
					<NativeText>
						{store.loading ? "Loading lens setup" : "Lens setup is unavailable"}
					</NativeText>
					<NativeText tone="secondary">
						Connect to load your saved lens settings.
					</NativeText>
					{!!store.error && <NativeText tone="error">{store.error}</NativeText>}
					{!store.loading && (
						<NativeAction
							label="Retry connection"
							emphasis="primary"
							disabled={store.pending}
							onPress={() => {
								if (!store.pending) void store.reload();
							}}
						/>
					)}
				</NativeRow>
			</NativeSection>
		</NativePage>
	);
}
