import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { NativeAction, NativeStack, NativeText } from "../native-page";
import type { DateFieldProps } from "../presentation/date-field";
import { createDateOnlySession } from "../presentation/date-only";
import { usePresentationPaletteHold } from "../presentation/theme";
import { DateFieldPicker } from "./editor-date-picker";

/** Same date-only transaction as the existing field; native bounded action presentation. */
export default function EditorDate({
	label,
	value,
	maximum,
	disabled,
	error,
	inputRef,
	onChange,
}: DateFieldProps) {
	const [session, setSession] = useState<ReturnType<
		typeof createDateOnlySession
	> | null>(null);
	const [draft, setDraft] = useState("");
	const [visible, setVisible] = useState(false);
	const lock = useRef<typeof session>(null);
	const latest = useRef({ disabled, value, maximum, onChange });
	latest.current = { disabled, value, maximum, onChange };
	usePresentationPaletteHold(session !== null);
	const cancel = () => {
		lock.current?.cancel();
		setVisible(false);
	};
	useEffect(() => {
		void disabled;
		void value;
		void maximum;
		lock.current?.cancel();
		setVisible(false);
	}, [disabled, value, maximum]);
	const open = () => {
		if (latest.current.disabled || lock.current) return;
		const next = createDateOnlySession(
			latest.current.value,
			latest.current.maximum,
		);
		lock.current = next;
		setSession(next);
		setDraft(next.draft);
		setVisible(true);
	};
	useImperativeHandle(inputRef, () => ({ focus: open }));
	return (
		<NativeStack>
			<DateFieldPicker
				anchor={
					<NativeAction
						label={`${label}: ${value || "Choose date"}`}
						disabled={disabled}
						onPress={open}
					/>
				}
				label={label}
				visible={visible && !disabled}
				value={draft || value || maximum}
				maximum={maximum}
				onSelect={(next) => {
					if (!session || latest.current.disabled || lock.current !== session)
						return;
					session.select(next);
					setDraft(session.draft);
				}}
				onCancel={() => {
					if (lock.current === session) cancel();
				}}
				onDone={(next) => {
					if (!session || lock.current !== session) return;
					if (next) session.select(next);
					const committed = session.commit(latest.current.disabled);
					setVisible(false);
					if (committed !== undefined) latest.current.onChange(committed);
				}}
				onDismiss={() => {
					if (lock.current !== session) return;
					session?.cancel();
					lock.current = null;
					setSession(null);
					setDraft("");
					setVisible(false);
				}}
			/>
			{!!value && (
				<NativeAction
					label={`Clear ${label.toLowerCase()}`}
					disabled={disabled}
					onPress={() => {
						if (latest.current.disabled) return;
						cancel();
						latest.current.onChange("");
					}}
				/>
			)}
			{!!error && <NativeText tone="error">{error}</NativeText>}
		</NativeStack>
	);
}
