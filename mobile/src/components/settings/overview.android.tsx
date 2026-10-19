import { Button } from "@expo/ui";
import { Host, ListItem } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { useColorScheme, View } from "react-native";
import {
	PresentationText,
	ScreenFrame,
	SemanticText,
	usePresentationEpoch,
	usePresentationTheme,
} from "../presentation";
import { MaterialSection } from "./material-section.android";
import NativeFields from "./native-fields";
import type { SettingsOverviewProps } from "./overview";

/** A single Material surface per group. Native Button.enabled owns busy
 * semantics; never change a ListItem's modifier array into an absent payload. */
export default function SettingsOverview({
	model: m,
	summary,
	onEdit,
}: SettingsOverviewProps) {
	const epoch = usePresentationEpoch();
	const scheme = useColorScheme();
	const theme = usePresentationTheme();
	return (
		<ScreenFrame title="Settings" insetMode="tabs" scrollOwner="content">
			<Host
				key={epoch}
				style={{ flex: 1, width: "100%", minWidth: 0 }}
				colorScheme={scheme}
			>
				<NativeFields>
					<MaterialSection title="Lenses">
						<Button
							label="Lens setup"
							variant="text"
							disabled={m.accountDisabled}
							onPress={onEdit}
						/>
						<SemanticText tone="secondary">
							{summary.split("; ").join("\n")}
						</SemanticText>
					</MaterialSection>
					<MaterialSection title="Account">
						{[
							{ label: "Email", value: m.email },
							{ label: "Calendar time zone", value: m.timeZone },
						].map((row) => (
							<ListItem
								key={row.label}
								colors={{ containerColor: theme.surface }}
								modifiers={[fillMaxWidth()]}
							>
								<ListItem.HeadlineContent>
									<SemanticText>{row.label}</SemanticText>
								</ListItem.HeadlineContent>
								<ListItem.SupportingContent>
									<SemanticText tone="secondary">{row.value}</SemanticText>
								</ListItem.SupportingContent>
							</ListItem>
						))}
					</MaterialSection>
					<Button
						label="Sign out"
						variant="text"
						disabled={m.accountDisabled}
						onPress={m.signOut}
					/>
					{!!m.connectionError && (
						<MaterialSection title="Connection">
							<SemanticText tone="danger">{m.connectionError}</SemanticText>
							<Button
								label="Retry connection"
								variant="text"
								disabled={m.loading || m.accountDisabled}
								onPress={m.reload}
							/>
						</MaterialSection>
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
