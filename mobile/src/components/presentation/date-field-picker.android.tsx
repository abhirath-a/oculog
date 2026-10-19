import { DatePickerDialog } from "@expo/ui/jetpack-compose";
import { useEffect, useRef } from "react";
import type { DateFieldPickerProps } from "./date-field-picker";
import { dateOnlyFromDate, dateOnlyToUTC } from "./date-only";

export function DateFieldPicker({
	anchor,
	visible,
	value,
	maximum,
	onDone,
	onCancel,
	onDismiss,
}: DateFieldPickerProps) {
	const latestDismiss = useRef(onDismiss);
	latestDismiss.current = onDismiss;
	// Compose disposes the dialog when removed; there is no trailing sheet animation.
	// Callback identity changes must not dismiss a new session while still hidden.
	useEffect(() => {
		if (!visible) latestDismiss.current();
	}, [visible]);
	return (
		<>
			{anchor}
			{visible && (
				<DatePickerDialog
					initialDate={dateOnlyToUTC(value).toISOString()}
					selectableDates={{ end: dateOnlyToUTC(maximum) }}
					confirmButtonLabel="Done"
					dismissButtonLabel="Cancel"
					onDateSelected={(date) => {
						onDone(dateOnlyFromDate(date, true));
					}}
					onDismissRequest={onCancel}
				/>
			)}
		</>
	);
}
