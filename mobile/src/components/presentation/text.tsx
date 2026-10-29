import { Text as NativeText } from "@expo/ui";
import {
	accessibilityAddTraits,
	font,
	foregroundStyle,
	accessibilityLabel as nativeLabel,
} from "@expo/ui/swift-ui/modifiers";
import { PlatformColor, StyleSheet, Text } from "react-native";
import { usePresentationTheme } from "./theme";

export type SemanticTextProps = {
	children: string;
	role?: "largeTitle" | "title" | "headline" | "body" | "callout" | "caption";
	tone?: "primary" | "secondary" | "danger";
	heading?: boolean;
	accessibilityLabel?: string;
};

// UIKit defaults plus native dynamicTypeRamp. Never cap font scaling or line count.
export const presentationTextStyles = StyleSheet.create({
	largeTitle: { fontSize: 34, fontWeight: "400" },
	title: { fontSize: 28, fontWeight: "600" },
	headline: { fontSize: 17, fontWeight: "600" },
	body: { fontSize: 17, fontWeight: "400" },
	callout: { fontSize: 16, fontWeight: "400" },
	caption: { fontSize: 12, fontWeight: "400" },
});

function useTone(tone: SemanticTextProps["tone"]) {
	const colors = usePresentationTheme();
	return tone === "danger"
		? colors.error
		: tone === "secondary"
			? colors.secondary
			: colors.text;
}

/** RN-tree text; use RNHostView to cross a native parent boundary. */
export function PresentationText({
	children,
	role = "body",
	tone,
	heading,
	accessibilityLabel,
}: SemanticTextProps) {
	const color = useTone(tone);
	return (
		<Text
			selectable
			allowFontScaling
			dynamicTypeRamp={
				role === "title" ? "title1" : role === "caption" ? "caption1" : role
			}
			accessibilityRole={heading ? "header" : undefined}
			accessibilityLabel={accessibilityLabel}
			style={[
				presentationTextStyles[role],
				{
					color:
						tone !== "danger"
							? PlatformColor(tone === "secondary" ? "secondaryLabel" : "label")
							: color,
					flexShrink: 1,
				},
			]}
		>
			{children}
		</Text>
	);
}

/** Native-tree text; parent Host/Form/Column composes this child. */
export function SemanticText({
	children,
	role = "body",
	tone,
	heading,
	accessibilityLabel,
}: SemanticTextProps) {
	const color = useTone(tone);
	return (
		<NativeText
			modifiers={[
				font({ textStyle: role }),
				foregroundStyle(
					tone === "danger"
						? color
						: {
								type: "hierarchical",
								style: tone === "secondary" ? "secondary" : "primary",
							},
				),
				...(heading ? [accessibilityAddTraits(["isHeader"])] : []),
				...(accessibilityLabel ? [nativeLabel(accessibilityLabel)] : []),
			]}
		>
			{children}
		</NativeText>
	);
}
