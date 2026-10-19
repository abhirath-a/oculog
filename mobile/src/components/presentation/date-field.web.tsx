import { createElement, useId, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import type { DateFieldProps } from "./date-field";
import { SemanticText } from "./semantic-text";
import { usePresentationTheme } from "./theme";
import { webTypography } from "./web-typography";

export type { DateFieldProps } from "./date-field";

export function DateField({
	label,
	value,
	maximum,
	disabled,
	error,
	inputRef,
	onChange,
}: DateFieldProps) {
	const theme = usePresentationTheme();
	const id = useId();
	const webInput = useRef<HTMLInputElement>(null);
	useImperativeHandle(
		inputRef,
		() => ({
			focus: () => {
				if (!disabled) webInput.current?.focus();
			},
		}),
		[disabled],
	);
	return (
		<View style={{ gap: 4 }}>
			{/* biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role. */}
			<SemanticText role="callout">{label}</SemanticText>
			{createElement("input", {
				type: "date",
				ref: webInput,
				"aria-label": label,
				"aria-invalid": !!error,
				"aria-describedby": error ? `${id}-error` : undefined,
				value,
				max: maximum,
				disabled,
				onChange: (event: { currentTarget: { value: string } }) => {
					if (!disabled) onChange(event.currentTarget.value);
				},
				style: {
					minHeight: 44,
					minWidth: 0,
					padding: 8,
					...webTypography,
					width: "100%",
					boxSizing: "border-box",
					colorScheme: "light dark",
					color: theme.text,
					backgroundColor: theme.surface,
					border: `1px solid ${error ? theme.error : theme.divider}`,
					borderRadius: 4,
				},
			})}
			{!!value &&
				createElement(
					"button",
					{
						type: "button",
						disabled,
						style: { ...webTypography, minHeight: 44 },
						onClick: () => {
							if (!disabled) onChange("");
						},
					},
					`Clear ${label.toLowerCase()}`,
				)}
			{!!error &&
				createElement(
					"span",
					{
						id: `${id}-error`,
						role: "alert",
						style: { ...webTypography, color: theme.error },
					},
					error,
				)}
		</View>
	);
}
