import { BottomSheet, DatePicker, Group } from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	datePickerStyle,
	presentationDetents,
} from "@expo/ui/swift-ui/modifiers";
import { TodayForm } from "../home/today-design";
import { NativeAction, NativeRow, NativeSection } from "../native-page";
import type { DateFieldPickerProps } from "../presentation/date-field-picker";
import { dateOnlyFromDate, dateOnlyToLocal } from "../presentation/date-only";

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
	return (
		<BottomSheet
			anchor={anchor}
			isPresented={visible}
			onIsPresentedChange={(presented) => {
				if (!presented) onCancel();
			}}
			onDismiss={onDismiss}
		>
			<Group modifiers={[presentationDetents(["large"])]}>
				<TodayForm>
					<NativeSection title={label}>
						<NativeRow>
							<DatePicker
								selection={dateOnlyToLocal(value)}
								range={{ end: dateOnlyToLocal(maximum) }}
								displayedComponents={["date"]}
								modifiers={[
									datePickerStyle("graphical"),
									accessibilityLabel(label),
								]}
								onDateChange={(date) => onSelect(dateOnlyFromDate(date))}
							/>
							<NativeAction
								label="Done"
								emphasis="primary"
								onPress={() => onDone()}
							/>
							<NativeAction label="Cancel" onPress={onCancel} />
						</NativeRow>
					</NativeSection>
				</TodayForm>
			</Group>
		</BottomSheet>
	);
}
