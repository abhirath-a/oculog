import { Column, Host, Picker } from "@expo/ui";
import { defaultMinSize, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { accessibilityLabel, frame } from "@expo/ui/swift-ui/modifiers";
import { createElement } from "react";
import { Platform, View } from "react-native";
import { PresentationText } from "./text";
import { usePresentationEpoch, usePresentationTheme } from "./theme";

export type ChoiceControlProps = {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	disabled?: boolean;
	onChange(value: string): void;
};

/** RN-tree control, owns Host. Inside FieldGroup use root Picker directly instead. */
export function ChoiceControl({
	label,
	value,
	options,
	disabled = false,
	onChange,
}: ChoiceControlProps) {
	const theme = usePresentationTheme();
	const paletteEpoch = usePresentationEpoch();
	return (
		<View style={{ gap: 4 }}>
			{/* biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role. */}
			<PresentationText role="callout">{label}</PresentationText>
			{Platform.OS === "web" ? (
				createElement(
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
							font: "inherit",
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
				)
			) : (
				<Host
					key={paletteEpoch}
					matchContents={{ vertical: true }}
					ignoreSafeArea="all"
					style={{ width: "100%" }}
				>
					{/* Root Picker has no label prop; its native container supplies the label. */}
					<Column
						modifiers={
							Platform.OS === "ios"
								? [accessibilityLabel(label), frame({ minHeight: 44 })]
								: [
										semantics({ contentDescription: label }),
										defaultMinSize({ minHeight: 48 }),
									]
						}
					>
						<Picker
							selectedValue={value}
							onValueChange={(next) => {
								if (!disabled) onChange(next);
							}}
							enabled={!disabled}
						>
							{options.map((option) => (
								<Picker.Item
									key={option.value}
									value={option.value}
									label={option.label}
								/>
							))}
						</Picker>
					</Column>
				</Host>
			)}
		</View>
	);
}
