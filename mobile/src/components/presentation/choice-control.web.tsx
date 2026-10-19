import { createElement } from "react";
import { View } from "react-native";
import type { ChoiceControlProps } from "./choice-control";
import { PresentationText } from "./text";
import { usePresentationTheme } from "./theme";
import { webTypography } from "./web-typography";

export type { ChoiceControlProps } from "./choice-control";

/** A real select retains browser focus, arrow keys, typeahead, and disabled semantics. */
export function ChoiceControl({
	label,
	value,
	options,
	disabled = false,
	onChange,
}: ChoiceControlProps) {
	const theme = usePresentationTheme();
	return (
		<View style={{ gap: 4 }}>
			{/* biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role. */}
			<PresentationText role="callout">{label}</PresentationText>
			{createElement(
				"select",
				{
					"aria-label": label,
					value,
					disabled,
					onChange: (event: { currentTarget: { value: string } }) => {
						if (!disabled) onChange(event.currentTarget.value);
					},
					style: {
						minHeight: 44,
						padding: 8,
						...webTypography,
						width: "100%",
						backgroundColor: theme.surface,
						color: theme.text,
						border: `1px solid ${theme.divider}`,
						borderRadius: 4,
					},
				},
				options.map((option) =>
					createElement(
						"option",
						{ key: option.value, value: option.value },
						option.label,
					),
				),
			)}
		</View>
	);
}
