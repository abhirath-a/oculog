import { Button, Column } from "@expo/ui";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { accessibilityLabel, frame } from "@expo/ui/swift-ui/modifiers";
import {
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { Platform } from "react-native";
import { DateFieldPicker } from "./date-field-picker";
import { createDateOnlySession } from "./date-only";
import { SemanticText } from "./semantic-text";
import { usePresentationPaletteHold } from "./theme";

export type DateFieldProps = {
	label: string;
	value: string;
	maximum: string;
	disabled: boolean;
	error?: string;
	inputRef?: Ref<{ focus(): void }>;
	onChange(value: string): void;
};

/** Only the trigger participates in form layout; the platform owns presentation. */
export function DateField({
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
	// Keep the picker controlled without replacing the guarded session identity.
	const [draft, setDraft] = useState("");
	const [visible, setVisible] = useState(false);
	const lock = useRef<typeof session>(null);
	// Don't replace a native presenter during its selection/dismissal transaction.
	usePresentationPaletteHold(session !== null);
	const latest = useRef({ disabled, value, maximum, onChange });
	latest.current = { disabled, value, maximum, onChange };
	const cancel = () => {
		lock.current?.cancel();
		setVisible(false);
	};
	useEffect(() => {
		// These controlled props are invalidation signals, not values to copy into
		// the native draft. Any change cancels the current selection transaction.
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
	const description = `${label}, ${value || "No date selected"}`;
	const trigger = (
		<Button
			label={value || "Choose date"}
			disabled={disabled}
			variant="text"
			modifiers={
				Platform.OS === "ios"
					? [accessibilityLabel(description), frame({ minHeight: 44 })]
					: [semantics({ contentDescription: description })]
			}
			onPress={open}
		/>
	);
	return (
		<Column spacing={4}>
			{/* biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role. */}
			<SemanticText role="callout">{label}</SemanticText>
			<DateFieldPicker
				anchor={trigger}
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
				<Button
					label={`Clear ${label.toLowerCase()}`}
					variant="text"
					disabled={disabled}
					onPress={() => {
						if (latest.current.disabled) return;
						cancel();
						latest.current.onChange("");
					}}
				/>
			)}
			{!!error && <SemanticText tone="danger">{error}</SemanticText>}
		</Column>
	);
}
