import { Button, Column, Row } from "@expo/ui";
import {
	selectable,
	selectableGroup,
	semantics,
} from "@expo/ui/jetpack-compose/modifiers";
import {
	accessibilityAddTraits,
	accessibilityLabel,
	accessibilityValue,
	frame,
} from "@expo/ui/swift-ui/modifiers";
import { Platform, Pressable, Text, View } from "react-native";
import { usePresentationTheme } from "../presentation";

/** Native-tree selection primitive. Web universal layout is RN internally, so no bridge is needed there. */
export function DailyChoice({
	worn,
	disabled,
	onLog,
	stacked = false,
}: {
	worn: boolean | null;
	disabled: boolean;
	onLog: (worn: boolean) => void;
	stacked?: boolean;
}) {
	const theme = usePresentationTheme();
	const Layout = stacked ? Column : Row;
	if (Platform.OS === "web") {
		return (
			<View
				accessibilityRole="radiogroup"
				accessibilityLabel="Did you wear lenses today?"
				style={{ gap: 12, flexDirection: "row", flexWrap: "wrap" }}
			>
				{[true, false].map((value) => (
					<Pressable
						key={String(value)}
						accessibilityRole="radio"
						accessibilityLabel={`Did you wear lenses today: ${value ? "Yes" : "No"}`}
						accessibilityState={{ checked: worn === value, disabled }}
						aria-checked={worn === value}
						aria-disabled={disabled}
						disabled={disabled}
						onPress={() => !disabled && onLog(value)}
						style={{
							minHeight: 48,
							padding: 12,
							borderWidth: 1,
							borderRadius: 8,
							borderColor: theme.primary,
							backgroundColor: worn === value ? theme.primary : theme.surface,
							opacity: disabled ? 0.5 : 1,
						}}
					>
						<Text
							style={{
								color: worn === value ? theme.onPrimary : theme.text,
								fontSize: 16,
							}}
						>
							{value ? "Yes" : "No"}
						</Text>
					</Pressable>
				))}
			</View>
		);
	}
	return (
		<Layout
			spacing={12}
			modifiers={Platform.OS === "android" ? [selectableGroup()] : undefined}
		>
			{[true, false].map((value) => {
				const selected = worn === value;
				const choose = () => {
					if (!disabled) onLog(value);
				};
				return (
					<Button
						key={String(value)}
						label={value ? "Yes" : "No"}
						variant={selected ? "filled" : "outlined"}
						disabled={disabled}
						onPress={choose}
						modifiers={
							Platform.OS === "ios"
								? [
										frame({ minHeight: 44, minWidth: 88 }),
										accessibilityLabel(
											`Did you wear lenses today: ${value ? "Yes" : "No"}`,
										),
										accessibilityValue(selected ? "Selected" : "Not selected"),
										accessibilityAddTraits(selected ? ["isSelected"] : []),
									]
								: [
										selectable(selected, choose, "radioButton"),
										semantics({
											contentDescription: `Did you wear lenses today: ${value ? "Yes" : "No"}`,
										}),
									]
						}
					/>
				);
			})}
		</Layout>
	);
}
