import {
	Host,
	Picker,
	RNHostView,
	Text as SwiftText,
	VStack,
} from "@expo/ui/swift-ui";
import {
	background,
	padding,
	pickerStyle,
	shadow,
	shapes,
	tag,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { View } from "react-native";
import { usePresentationTheme } from "../presentation/theme";

type Mode = "login" | "register";
export function AuthModePicker({
	mode,
	disabled,
	onChange,
}: {
	mode: Mode;
	disabled: boolean;
	onChange(mode: Mode): void;
}) {
	return (
		<View
			pointerEvents={disabled ? "none" : "auto"}
			style={{ height: 40, opacity: disabled ? 0.5 : 1 }}
		>
			<Host style={{ flex: 1 }}>
				<Picker
					label="Account mode"
					selection={mode}
					onSelectionChange={(value) => {
						if (!disabled && (value === "login" || value === "register"))
							onChange(value);
					}}
					modifiers={[pickerStyle("segmented")]}
				>
					<SwiftText modifiers={[tag("login")]}>Sign in</SwiftText>
					<SwiftText modifiers={[tag("register")]}>Create account</SwiftText>
				</Picker>
			</Host>
		</View>
	);
}
export function AuthCard({
	width,
	children,
}: {
	width: number;
	children: ReactNode;
}) {
	const theme = usePresentationTheme();
	const inset = 22;
	return (
		<Host matchContents style={{ width }}>
			<VStack
				modifiers={[
					padding({ all: inset }),
					background(
						theme.surface,
						shapes.roundedRectangle({ cornerRadius: 24 }),
					),
					shadow({ color: "#00000018", radius: 14, x: 0, y: 5 }),
				]}
			>
				<RNHostView matchContents>
					<View style={{ width: width - inset * 2, gap: 22 }}>{children}</View>
				</RNHostView>
			</VStack>
		</Host>
	);
}
