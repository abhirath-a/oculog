import { Button, Icon } from "@expo/ui";
import {
	accessibilityAddTraits,
	accessibilityHidden,
	accessibilityLabel,
	buttonBorderShape,
	buttonStyle,
	controlSize,
	frame,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useButtonActionColors } from "../button-action-colors";
import { type TopicNodeProps, topicSymbols } from "./topic-node.types";
export function TopicNode({ title, index, selected, onPress }: TopicNodeProps) {
	const colors = useButtonActionColors();
	return (
		<Button
			variant="outlined"
			onPress={onPress}
			modifiers={[
				// buttonStyle("glass"),
				buttonStyle(selected ? "glassProminent" : "glass"),
				buttonBorderShape("circle"),
				controlSize("large"),
				frame({ width: 56, height: 56 }),
				tint(colors.accent),
				accessibilityLabel(
					`${title}, ${selected ? "selected" : "not selected"}`,
				),
				...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
			]}
		>
			<Icon
				name={topicSymbols[index % topicSymbols.length] ?? "book"}
				size={24}
				// color={colors.accent}
				modifiers={[accessibilityHidden(true)]}
			/>
		</Button>
	);
}
