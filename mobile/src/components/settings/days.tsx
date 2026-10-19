import { useEffect, useId, useRef } from "react";
import { usePresentationTheme } from "../presentation";

export type DaysProps = {
	label: string;
	value: string;
	disabled: boolean;
	error: string;
	validationEvent?: number;
	onChange: (value: string) => void;
};

/** Web counterpart; native builds resolve days.ios / days.android. */
export default function Days({
	label,
	value,
	disabled,
	error,
	validationEvent,
	onChange,
}: DaysProps) {
	const theme = usePresentationTheme();
	const id = useId();
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		// A repeated failed submit must refocus even when the error is unchanged.
		void validationEvent;
		if (error && !disabled) ref.current?.focus();
	}, [error, disabled, validationEvent]);
	return (
		<label style={{ display: "grid", gap: 6, color: theme.text }}>
			{label}
			<input
				ref={ref}
				type="text"
				inputMode="numeric"
				maxLength={3}
				value={value}
				disabled={disabled}
				aria-invalid={!!error}
				aria-describedby={error ? `${id}-error` : undefined}
				onChange={(event) => onChange(event.target.value)}
				style={{
					width: "100%",
					boxSizing: "border-box",
					minHeight: 44,
					padding: 10,
					border: `1px solid ${error ? theme.error : theme.divider}`,
					borderRadius: 6,
					background: theme.surface,
					color: theme.text,
					font: "inherit",
				}}
			/>
			{!!error && (
				<span id={`${id}-error`} role="alert" style={{ color: theme.error }}>
					{error}
				</span>
			)}
		</label>
	);
}
