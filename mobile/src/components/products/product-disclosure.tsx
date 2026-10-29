import { Pressable } from "react-native";
import { PresentationText } from "../presentation/text";

export type ProductDisclosureProps = {
	label: string;
	context?: string;
	expanded: boolean;
	onPress(): void;
};

/** Disclosure needs an expanded state, which the shared action Button does not expose. */
export function ProductDisclosure({
	label,
	context,
	expanded,
	onPress,
}: ProductDisclosureProps) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={context ? `${label}: ${context}` : label}
			accessibilityState={{ expanded }}
			onPress={onPress}
			style={({ pressed }) => ({
				alignSelf: "flex-start",
				minHeight: 48,
				minWidth: 48,
				justifyContent: "center",
				paddingVertical: 8,
				opacity: pressed ? 0.65 : 1,
			})}
		>
			<PresentationText tone="primary">{label}</PresentationText>
		</Pressable>
	);
}
