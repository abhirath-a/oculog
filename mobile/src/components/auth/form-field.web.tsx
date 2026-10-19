import { useId, useImperativeHandle, useRef, useState } from "react";
import { usePresentationTheme } from "../presentation";
import { webTypography } from "../presentation/web-typography";
import type { AuthFieldProps } from "./field";

/** Real label/input association, autofill and keyboard focus in the browser. */
export function FormField({
	label,
	value,
	onChange,
	secure,
	disabled,
	autoComplete,
	autoCapitalize = "none",
	keyboardType,
	maxLength,
	inputRef,
	returnKeyType,
	onSubmitEditing,
	error,
	hint,
}: AuthFieldProps & { hint?: string }) {
	const theme = usePresentationTheme();
	const id = useId();
	const ref = useRef<HTMLInputElement>(null);
	const [focused, setFocused] = useState(false);
	useImperativeHandle(
		inputRef,
		() => ({
			focus: () => ref.current?.focus(),
			blur: () => ref.current?.blur(),
		}),
		[],
	);
	const description = error || hint;
	return (
		<div
			style={{
				...webTypography,
				display: "flex",
				flexDirection: "column",
				gap: "0.375em",
				color: theme.text,
			}}
		>
			<label htmlFor={id} style={{ fontSize: 16 }}>
				{label}
			</label>
			<input
				ref={ref}
				id={id}
				name={
					autoComplete === "new-password" && label === "Confirm password"
						? "password-confirm"
						: autoComplete || id
				}
				type={
					secure
						? "password"
						: keyboardType === "email-address"
							? "email"
							: "text"
				}
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				disabled={disabled}
				autoComplete={autoComplete}
				autoCapitalize={autoCapitalize}
				autoCorrect="off"
				spellCheck={false}
				maxLength={maxLength}
				inputMode={
					keyboardType === "email-address"
						? "email"
						: keyboardType === "number-pad"
							? "numeric"
							: undefined
				}
				enterKeyHint={returnKeyType}
				aria-invalid={!!error}
				aria-describedby={description ? `${id}-help` : undefined}
				onKeyDown={(event) => {
					if (
						event.key !== "Enter" ||
						event.nativeEvent.isComposing ||
						disabled
					)
						return;
					event.preventDefault();
					onSubmitEditing?.();
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				style={{
					boxSizing: "border-box",
					width: "100%",
					minWidth: 0,
					minHeight: 48,
					padding: "10px 12px",
					font: "inherit",
					fontSize: 16,
					borderRadius: 6,
					border: `1px solid ${error ? theme.error : theme.divider}`,
					outline: focused ? `2px solid ${theme.primary}` : undefined,
					outlineOffset: 2,
					color: theme.text,
					backgroundColor: theme.surface,
					opacity: disabled ? 0.6 : 1,
				}}
			/>
			{description && (
				<div
					id={`${id}-help`}
					aria-live={error ? "polite" : undefined}
					style={{
						fontSize: 13,
						lineHeight: 1.5,
						color: error ? theme.error : theme.secondary,
					}}
				>
					{description}
				</div>
			)}
		</div>
	);
}
