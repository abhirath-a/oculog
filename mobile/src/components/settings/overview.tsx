import { Button, FieldGroup, Host, ListItem } from "@expo/ui";
import { View } from "react-native";
import {
	PresentationText,
	ScreenFrame,
	SemanticText,
	usePresentationEpoch,
} from "../presentation";
import NativeFields from "./native-fields";
import type { SettingsModel } from "./use-schedule-settings";

export type SettingsOverviewProps = {
	model: SettingsModel;
	summary: string;
	onEdit: () => void;
};

/** Native grouped rows, not an editing surface. */
export default function SettingsOverview({
	model: m,
	summary,
	onEdit,
}: SettingsOverviewProps) {
	const epoch = usePresentationEpoch();
	return (
		<ScreenFrame title="Settings" insetMode="tabs" scrollOwner="content">
			<Host key={epoch} style={{ flex: 1, minWidth: 0 }}>
				<NativeFields>
					<FieldGroup.Section title="Lenses">
						<ListItem
							onPress={m.accountDisabled ? undefined : onEdit}
							supportingText={summary}
						>
							<SemanticText>Lens setup</SemanticText>
						</ListItem>
					</FieldGroup.Section>
					<FieldGroup.Section title="Account">
						<ListItem supportingText={m.email}>
							<SemanticText>Email</SemanticText>
						</ListItem>
						<ListItem supportingText={m.timeZone}>
							<SemanticText>Calendar time zone</SemanticText>
						</ListItem>
					</FieldGroup.Section>
					<FieldGroup.Section>
						<Button
							label="Sign out"
							variant="text"
							style={{ paddingVertical: 12 }}
							disabled={m.accountDisabled}
							onPress={m.signOut}
						/>
					</FieldGroup.Section>
					{!!m.connectionError && (
						<FieldGroup.Section title="Connection">
							<SemanticText tone="danger">{m.connectionError}</SemanticText>
							<Button
								label="Retry connection"
								variant="text"
								style={{ paddingVertical: 12 }}
								disabled={m.loading || m.accountDisabled}
								onPress={m.reload}
							/>
						</FieldGroup.Section>
					)}
				</NativeFields>
			</Host>
			{!!m.accountError && (
				<View style={{ padding: 16 }} accessibilityRole="alert">
					<PresentationText tone="danger">{m.accountError}</PresentationText>
				</View>
			)}
		</ScreenFrame>
	);
}
