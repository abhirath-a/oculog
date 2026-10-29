import { Button, Column, Row } from "@expo/ui";
import {
	accessibilityAddTraits,
	accessibilityLabel,
	accessibilityValue,
	frame,
} from "@expo/ui/swift-ui/modifiers";

/** SwiftUI selection primitive rendered inside the enclosing native Host. */
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
	const Layout = stacked ? Column : Row;
	return (
		<Layout spacing={12}>
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
						modifiers={[
							frame({ minHeight: 44, minWidth: 88 }),
							accessibilityLabel(
								`Did you wear lenses today: ${value ? "Yes" : "No"}`,
							),
							accessibilityValue(selected ? "Selected" : "Not selected"),
							accessibilityAddTraits(selected ? ["isSelected"] : []),
						]}
					/>
				);
			})}
		</Layout>
	);
}
