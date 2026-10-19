import {
	Column,
	Text as ComposeText,
	RNHostView,
} from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	onSizeChanged,
	semantics,
} from "@expo/ui/jetpack-compose/modifiers";
import { useState } from "react";
import { View } from "react-native";
import { PresentationText, type SemanticTextProps } from "./text";
import { usePresentationTheme } from "./theme";

const typography = {
	largeTitle: "headlineLarge",
	title: "headlineSmall",
	headline: "titleMedium",
	body: "bodyLarge",
	callout: "bodyMedium",
	caption: "bodySmall",
} as const;

/** SDK 57 has no Compose heading semantic. Measure the actual native parent
 * width before bridging. Yoga then measures wrapping height at that width,
 * not at the viewport's intrinsic width (which requiredSize centers offscreen). */
function Heading({
	children,
	role = "body",
	tone,
	accessibilityLabel,
}: SemanticTextProps) {
	const [availableWidth, setAvailableWidth] = useState(0);
	return (
		<Column
			modifiers={[
				fillMaxWidth(),
				onSizeChanged(({ width }) => setAvailableWidth(width)),
			]}
		>
			{availableWidth > 0 && (
				<RNHostView matchContents>
					<View style={{ width: availableWidth }}>
						<PresentationText
							role={role}
							tone={tone}
							heading
							accessibilityLabel={accessibilityLabel}
						>
							{children}
						</PresentationText>
					</View>
				</RNHostView>
			)}
		</Column>
	);
}

export function SemanticText(props: SemanticTextProps) {
	const { children, role = "body", tone, heading, accessibilityLabel } = props;
	const theme = usePresentationTheme();
	const color =
		tone === "danger"
			? theme.error
			: tone === "secondary"
				? theme.secondary
				: theme.text;
	if (heading) return <Heading {...props} />;
	return (
		<ComposeText
			style={{ typography: typography[role] }}
			color={color}
			modifiers={[
				semantics({ contentDescription: accessibilityLabel ?? children }),
			]}
		>
			{children}
		</ComposeText>
	);
}
