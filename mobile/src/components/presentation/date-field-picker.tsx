import {
	BottomSheet,
	Button,
	DatePicker,
	ScrollView,
	VStack,
} from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	datePickerStyle,
	frame,
	padding,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { dateOnlyFromDate, dateOnlyToLocal } from "./date-only";
import { usePresentationEpoch } from "./theme";

export type DateFieldPickerProps = {
	anchor: ReactNode;
	label: string;
	visible: boolean;
	value: string;
	maximum: string;
	onSelect(value: string): void;
	onDone(value?: string): void;
	onCancel(): void;
	onDismiss(): void;
};

export function DateFieldPicker({
	anchor,
	label,
	visible,
	value,
	maximum,
	onSelect,
	onDone,
	onCancel,
	onDismiss,
}: DateFieldPickerProps) {
	const paletteEpoch = usePresentationEpoch();
	return (
		<BottomSheet
			key={paletteEpoch}
			anchor={anchor}
			isPresented={visible}
			onIsPresentedChange={(presented) => {
				if (!presented) onCancel();
			}}
			onDismiss={onDismiss}
		>
			<ScrollView>
				<VStack spacing={12} modifiers={[padding({ all: 16 })]}>
					<DatePicker
						selection={dateOnlyToLocal(value)}
						range={{ end: dateOnlyToLocal(maximum) }}
						displayedComponents={["date"]}
						modifiers={[datePickerStyle("wheel"), accessibilityLabel(label)]}
						onDateChange={(date) => onSelect(dateOnlyFromDate(date))}
					/>
					<Button
						label="Done"
						onPress={() => onDone()}
						modifiers={[frame({ minHeight: 44 })]}
					/>
					{/* biome-ignore lint/a11y/useValidAriaRole: Installed SwiftUI ButtonRole explicitly includes cancel; this is not a DOM button. */}
					<Button
						label="Cancel"
						role="cancel"
						onPress={onCancel}
						modifiers={[frame({ minHeight: 44 })]}
					/>
				</VStack>
			</ScrollView>
		</BottomSheet>
	);
}
