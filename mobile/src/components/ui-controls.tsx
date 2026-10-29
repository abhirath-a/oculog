import { Button as NativeButton, Switch as NativeSwitch, Text } from "@expo/ui";
import {
	buttonStyle,
	controlSize,
	fixedSize,
	frame,
	multilineTextAlignment,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
import { useButtonActionColors } from "./button-action-colors";
import type {
	ButtonControlProps,
	SwitchControlProps,
} from "./ui-controls.types";

export function ButtonControl({
	title,
	onPress,
	disabled,
	appearance,
	fullWidth,
	glass,
	colors,
	danger,
}: ButtonControlProps) {
	const palette = useButtonActionColors();
	const accent = danger ? colors.danger : palette.accent;
	const foreground = disabled
		? palette.muted
		: appearance === "filled"
			? palette.onAccent
			: accent;
	return (
		<NativeButton
			onPress={() => {
				if (!disabled) onPress();
			}}
			disabled={disabled}
			variant={appearance}
			modifiers={[
				controlSize("regular"),
				frame({
					minHeight: 44,
					...(fullWidth ? { maxWidth: Infinity } : {}),
				}),
				tint(disabled ? palette.muted : accent),
				...(glass && appearance !== "text"
					? [
							buttonStyle(
								Number.parseInt(String(Platform.Version), 10) >= 26
									? appearance === "filled"
										? "glassProminent"
										: "glass"
									: appearance === "filled"
										? "borderedProminent"
										: "bordered",
							),
						]
					: []),
			]}
		>
			<Text
				textStyle={{ color: foreground }}
				modifiers={[
					multilineTextAlignment("center"),
					fixedSize({ horizontal: false, vertical: true }),
				]}
			>
				{title}
			</Text>
		</NativeButton>
	);
}

export function SwitchControl({
	label,
	value,
	disabled,
	onChange,
}: SwitchControlProps) {
	return (
		<NativeSwitch
			label={label}
			value={value}
			disabled={disabled}
			onValueChange={onChange}
		/>
	);
}
