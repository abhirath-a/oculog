import { DatePicker } from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	datePickerStyle,
	disabled as disabledModifier,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useState } from "react";
import {
	deviceCalendarDate,
	isCalendarDate,
} from "../../lib/prescriptions/calendar";
import { NativeAction, NativeStack, NativeText } from "../native-page";

function localDate(value: string) {
	const [year = 2000, month = 1, day = 1] = value.split("-").map(Number);
	const result = new Date();
	result.setFullYear(year, month - 1, day);
	result.setHours(12, 0, 0, 0);
	return result;
}
/** Picker defaults are staging only: no expiry changes until explicit confirmation. */
export function ExpiryField({
	value,
	disabled = false,
	onChange,
}: {
	value: string;
	disabled?: boolean;
	onChange(value: string): void;
}) {
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	useEffect(() => {
		// A changed source date or disabled state invalidates the staged picker.
		void value;
		void disabled;
		setOpen(false);
		setDraft("");
	}, [value, disabled]);
	return (
		<NativeStack>
			<NativeText>{`Expiry date: ${value || "Not provided / unknown"}`}</NativeText>
			<NativeAction
				label={value ? "Change expiry date" : "Choose expiry date"}
				disabled={disabled}
				onPress={() => {
					if (disabled) return;
					setDraft(
						isCalendarDate(value) ? value : deviceCalendarDate(new Date()),
					);
					setOpen(true);
				}}
			/>
			{open && (
				<NativeStack>
					<NativeText tone="secondary">
						Choose the date printed on the prescription. The initial calendar
						selection is not an inferred expiry.
					</NativeText>
					<DatePicker
						selection={localDate(draft)}
						displayedComponents={["date"]}
						modifiers={[
							datePickerStyle("graphical"),
							accessibilityLabel("Prescription expiry date"),
							...(disabled ? [disabledModifier()] : []),
						]}
						onDateChange={(date) => {
							if (!disabled) setDraft(deviceCalendarDate(date));
						}}
					/>
					<NativeAction
						label={`Use ${draft}`}
						emphasis="primary"
						disabled={disabled || !isCalendarDate(draft)}
						onPress={() => {
							if (!disabled && isCalendarDate(draft)) {
								onChange(draft);
								setOpen(false);
							}
						}}
					/>
					<NativeAction
						label="Cancel date selection"
						onPress={() => setOpen(false)}
					/>
				</NativeStack>
			)}
			{!!value && (
				<NativeAction
					label="Expiry not provided / unknown"
					disabled={disabled}
					onPress={() => {
						if (!disabled) onChange("");
					}}
				/>
			)}
			<NativeText tone="secondary">
				No expiry on the document? Ask your prescriber. Oculog does not
				calculate a legal expiry from the issue date.
			</NativeText>
		</NativeStack>
	);
}
