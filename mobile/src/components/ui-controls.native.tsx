import { Button as NativeButton, Switch as NativeSwitch } from "@expo/ui";
import { fillMaxWidth, semantics } from "@expo/ui/jetpack-compose/modifiers";
import {
	buttonStyle,
	controlSize,
	frame,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { Platform } from "react-native";
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
	return (
		<NativeButton
			label={title}
			onPress={onPress}
			disabled={disabled}
			variant={appearance}
			modifiers={
				Platform.OS === "ios"
					? [
							controlSize("regular"),
							frame({
								minHeight: 44,
								...(fullWidth ? { maxWidth: Infinity } : {}),
							}),
							tint(danger ? colors.danger : colors.accent),
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
						]
					: fullWidth
						? [fillMaxWidth()]
						: undefined
			}
		/>
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
			modifiers={
				Platform.OS === "android"
					? [semantics({ contentDescription: label })]
					: undefined
			}
		/>
	);
}
