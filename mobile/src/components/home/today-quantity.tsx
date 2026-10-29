import { TextInput, useNativeState } from "@expo/ui";
import { accessibilityLabel, font, frame } from "@expo/ui/swift-ui/modifiers";
import { useEffect } from "react";
import { usePresentationTheme } from "../presentation/theme";
export type TodayQuantityProps = {
	value: string;
	disabled: boolean;
	label: string;
	onChange(value: string): void;
};

export default function TodayQuantity({
	value,
	disabled,
	label,
	onChange,
}: TodayQuantityProps) {
	const state = useNativeState(value);
	const theme = usePresentationTheme();
	useEffect(() => {
		if (state.value !== value) state.value = value;
	}, [state, value]);
	return (
		<TextInput
			value={state}
			editable={!disabled}
			keyboardType="number-pad"
			returnKeyType="done"
			textStyle={{ color: theme.text }}
			modifiers={[
				font({ textStyle: "body" }),
				frame({ maxWidth: Infinity, minHeight: 44 }),
				accessibilityLabel(label),
			]}
			onChangeText={(next) => {
				if (!disabled) onChange(next);
			}}
		/>
	);
}
