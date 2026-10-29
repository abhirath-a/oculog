import { Pressable } from "react-native";
import { PresentationText } from "../presentation/text";

export type AdviceDisclosureProps = {
	label: string;
	expanded: boolean;
	onPress(): void;
};

/** Advice-only disclosure: shared action buttons do not expose expanded state. */
export function AdviceDisclosure({
	label,
	expanded,
	onPress,
}: AdviceDisclosureProps) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ expanded }}
			onPress={onPress}
			style={({ pressed }) => ({
				alignSelf: "flex-start",
				minHeight: 48,
				minWidth: 48,
				maxWidth: "100%",
				justifyContent: "center",
				paddingVertical: 8,
				opacity: pressed ? 0.65 : 1,
			})}
		>
			<PresentationText tone="primary">{label}</PresentationText>
		</Pressable>
	);
}
