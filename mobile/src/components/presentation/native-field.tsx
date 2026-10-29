import { Column, TextInput, type TextInputRef, useNativeState } from "@expo/ui";
import {
	accessibilityLabel,
	font,
	frame,
	textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useImperativeHandle, useRef } from "react";
import type { NativeFieldProps } from "./native-field.types";
import { SemanticText } from "./semantic-text";
import { usePresentationTheme } from "./theme";

export type { NativeFieldHandle, NativeFieldProps } from "./native-field.types";

/** iOS entry point never evaluates Compose, even for secure fields. */
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
	const text = useNativeState(value);
	const ref = useRef<TextInputRef>(null);
	useEffect(() => {
		if (text.value !== value) text.value = value;
	}, [text, value]);
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
		<Column spacing={2}>
			{/* biome-ignore lint/a11y/useValidAriaRole: Presentation typography, not ARIA. */}
			<SemanticText role="callout" tone="secondary">
				{label}
			</SemanticText>
			<TextInput
				{...props}
				ref={ref}
				value={text}
				onChangeText={(next) => {
					if (!disabled) onChange(next);
				}}
				secureTextEntry={secure}
				editable={!disabled}
				autoCapitalize={autoCapitalize}
				autoCorrect={autoCorrect}
				placeholderTextColor={theme.secondary}
				modifiers={[
					accessibilityLabel(label),
					font({ textStyle: "body" }),
					textFieldStyle("roundedBorder"),
					frame({ minHeight: props.multiline ? 88 : 44 }),
				]}
				textStyle={{ color: theme.text }}
			/>
			{!!error && (
				<SemanticText role="caption" tone="danger">
					{error}
				</SemanticText>
			)}
		</Column>
	);
}
