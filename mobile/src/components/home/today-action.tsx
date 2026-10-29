import { Button, Text } from "@expo/ui";
import {
	accessibilityAddTraits,
	buttonStyle,
	controlSize,
	font,
	frame,
	multilineTextAlignment,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useButtonActionColors } from "../button-action-colors";
import { type TodayActionProps, todayPress } from "./today-tokens";

/** Native-tree child: requires the enclosing Today/sheet Host; never creates one. */
export function TodayAction({
	label,
	onPress,
	emphasis = "secondary",
	disabled,
	danger,
	selected,
}: TodayActionProps) {
	const colors = useButtonActionColors();
	const primary = emphasis === "primary";
	const accent = danger ? colors.danger : colors.accent;
	return (
		<Button
			variant={primary ? "filled" : "outlined"}
			disabled={disabled}
			onPress={todayPress(disabled, onPress)}
			modifiers={[
				buttonStyle(selected ? "glassProminent" : "glass"),
				controlSize("large"),
				tint(disabled ? colors.muted : accent),
				...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
			]}
		>
			<Text
				modifiers={[
					font({ textStyle: "headline" }),
					multilineTextAlignment("center"),
					...(!label.includes("Replace") && !label.includes("Cancel")
						? [frame({ maxWidth: Infinity })]
						: []),
				]}
			>
				{selected ? `✓ ${label}` : label}
			</Text>
		</Button>
	);
}
