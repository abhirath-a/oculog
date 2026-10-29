import { DatePicker } from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	datePickerStyle,
	disabled as disabledModifier,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState } from "react";
import { NativeAction, NativeStack, NativeText } from "../native-page";

export function ReminderTimeField({
	label,
	hour,
	minute,
	disabled = false,
	onCommit,
}: {
	label: string;
	hour: number;
	minute: number;
	disabled?: boolean;
	onCommit(hour: number, minute: number): void;
}) {
	const [draft, setDraft] = useState({ hour, minute });
	useEffect(() => setDraft({ hour, minute }), [hour, minute]);
	const selection = new Date();
	selection.setHours(draft.hour, draft.minute, 0, 0);
	const changed = hour !== draft.hour || minute !== draft.minute;
	return (
		<NativeStack>
			<DatePicker
				title={label}
				selection={selection}
				displayedComponents={["hourAndMinute"]}
				modifiers={[
					datePickerStyle("compact"),
					accessibilityLabel(label),
					...(disabled ? [disabledModifier()] : []),
				]}
				onDateChange={(date) => {
					if (!disabled)
						setDraft({ hour: date.getHours(), minute: date.getMinutes() });
				}}
			/>
			{changed && (
				<NativeAction
					label="Save reminder time"
					emphasis="primary"
					disabled={disabled}
					onPress={() => {
						if (!disabled) onCommit(draft.hour, draft.minute);
					}}
				/>
			)}
			<NativeText tone="secondary">
				Uses this iPhone’s local time. Changing the picker does not save until
				you choose Save reminder time.
			</NativeText>
		</NativeStack>
	);
}
