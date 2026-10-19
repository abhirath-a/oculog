import { useId, useImperativeHandle, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import type { NativeFieldProps } from "./native-field.types";
import { PresentationText } from "./text";
import { usePresentationTheme } from "./theme";
import { webTypography } from "./web-typography";

export type { NativeFieldHandle, NativeFieldProps } from "./native-field.types";

/** Browser entry point: no native SDK imports or native-tree bridges. */
export function NativeField({
	label,
	value,
	onChange,
	secure = false,
	disabled = false,
	error,
	inputRef,
	autoCapitalize = "none",
	autoCorrect = false,
	...props
}: NativeFieldProps) {
	const theme = usePresentationTheme();
	const id = useId();
	const ref = useRef<TextInput>(null);
	const [focused, setFocused] = useState(false);
	useImperativeHandle(
		inputRef,
		() => ({
			focus: () => {
				if (!disabled) ref.current?.focus();
			},
			blur: () => ref.current?.blur(),
		}),
		[disabled],
	);
	return (
		<View style={{ gap: 4 }}>
			{/* biome-ignore lint/a11y/useValidAriaRole: Presentation typography, not ARIA. */}
			<PresentationText role="callout">{label}</PresentationText>
			<TextInput
				{...props}
				ref={ref}
				value={value}
				onChangeText={(next) => {
					if (!disabled) onChange(next);
				}}
				accessibilityLabel={label}
				aria-invalid={!!error}
				aria-describedby={error ? `${id}-error` : undefined}
				secureTextEntry={secure}
				editable={!disabled}
				autoCapitalize={autoCapitalize}
				autoCorrect={autoCorrect}
				submitBehavior={
					props.returnKeyType === "next"
						? "submit"
						: props.multiline
							? "newline"
							: "blurAndSubmit"
				}
				onSubmitEditing={() => {
					if (!disabled) props.onSubmitEditing?.(value);
				}}
				onFocus={() => {
					setFocused(true);
					props.onFocus?.();
				}}
				onBlur={() => {
					setFocused(false);
					props.onBlur?.();
				}}
				placeholderTextColor={theme.secondary}
				style={{
					minHeight: props.multiline ? 88 : 44,
					padding: 10,
					fontSize: 16,
					fontFamily: webTypography.fontFamily,
					color: theme.text,
					backgroundColor: theme.surface,
					borderWidth: focused ? 2 : 1,
					borderColor: error
						? theme.error
						: focused
							? theme.primary
							: theme.divider,
					borderRadius: 4,
					...(props.multiline ? { textAlignVertical: "top" } : {}),
				}}
			/>
			{!!error && (
				<View
					nativeID={`${id}-error`}
					accessibilityRole="alert"
					accessibilityLiveRegion="polite"
				>
					<PresentationText role="caption" tone="danger">
						{error}
					</PresentationText>
				</View>
			)}
		</View>
	);
}
