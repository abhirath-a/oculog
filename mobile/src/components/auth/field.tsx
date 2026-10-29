import { Column, TextInput, type TextInputRef, useNativeState } from "@expo/ui";
import {
	accessibilityLabel,
	font,
	frame,
	textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { SemanticText, usePresentationTheme } from "../presentation";

export type AuthInputHandle = { focus(): void; blur(): void };
export type AuthFieldProps = {
	label: string;
	value: string;
	onChange: (value: string) => void;
	secure?: boolean;
	disabled?: boolean;
	autoComplete?: "name" | "email" | "current-password" | "new-password" | "off";
	autoCapitalize?: "none" | "words";
	keyboardType?: "email-address" | "number-pad";
	error?: string;
	maxLength?: number;
	inputRef?: Ref<AuthInputHandle>;
	returnKeyType?: "next" | "done";
	onSubmitEditing?: () => void;
};

/** Native-tree field with a SwiftUI-owned outline and secure entry. */
export function AuthField({
	label,
	value,
	onChange,
	secure = false,
	disabled = false,
	autoComplete,
	autoCapitalize = "none",
	keyboardType,
	error = "",
	maxLength,
	inputRef,
	returnKeyType = "done",
	onSubmitEditing,
}: AuthFieldProps) {
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
	useEffect(() => {
		if (error && !disabled) ref.current?.focus();
	}, [error, disabled]);
	return (
		<Column spacing={6}>
			{/* biome-ignore lint/a11y/useValidAriaRole: native typography role. */}
			<SemanticText role="callout" tone="secondary">
				{label}
			</SemanticText>
			<TextInput
				ref={ref}
				value={text}
				onChangeText={onChange}
				secureTextEntry={secure}
				editable={!disabled}
				autoComplete={autoComplete}
				autoCapitalize={autoCapitalize}
				autoCorrect={false}
				keyboardType={keyboardType}
				maxLength={maxLength}
				returnKeyType={returnKeyType}
				onSubmitEditing={onSubmitEditing}
				modifiers={[
					accessibilityLabel(label),
					font({ textStyle: "body" }),
					textFieldStyle("roundedBorder"),
					frame({ minHeight: 44 }),
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
