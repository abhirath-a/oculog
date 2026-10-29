import { Column, Host, Picker } from "@expo/ui";
import { accessibilityLabel, frame } from "@expo/ui/swift-ui/modifiers";
import { View } from "react-native";
import { PresentationText } from "./text";
import { usePresentationEpoch } from "./theme";

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
	const paletteEpoch = usePresentationEpoch();
	return (
		<View style={{ gap: 4 }}>
			{/* biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role. */}
			<PresentationText role="callout">{label}</PresentationText>
			<Host
				key={paletteEpoch}
				matchContents={{ vertical: true }}
				ignoreSafeArea="all"
				style={{ width: "100%" }}
			>
				{/* Root Picker has no label prop; its native container supplies the label. */}
				<Column
					modifiers={[accessibilityLabel(label), frame({ minHeight: 44 })]}
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
		</View>
	);
}
