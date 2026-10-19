import {
	Column,
	RNHostView,
	TextInput,
	type TextInputRef,
	useNativeState,
} from "@expo/ui";
import type { TextFieldRef } from "@expo/ui/jetpack-compose";
import {
	accessibilityLabel,
	font,
	frame,
	textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { Platform } from "react-native";
import { SemanticText, usePresentationTheme } from "../presentation";
import { Field } from "../ui";
import { AndroidPasswordInput } from "./password-input";

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

/** Native-tree field. Existing Settings callers can continue using this API. */
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
	const text = useNativeState(value);
	const ref = useRef<TextInputRef>(null);
	const androidRef = useRef<TextFieldRef>(null);
	const theme = usePresentationTheme();
	useEffect(() => {
		if (text.value !== value) text.value = value;
	}, [text, value]);
	useImperativeHandle(
		inputRef,
		() => ({
			focus: () => {
				if (Platform.OS === "android")
					void androidRef.current?.focus().catch(() => {});
				else ref.current?.focus();
			},
			blur: () => {
				if (Platform.OS === "android")
					void androidRef.current?.blur().catch(() => {});
				else ref.current?.blur();
			},
		}),
		[],
	);
	useEffect(() => {
		if (error && !disabled) {
			if (Platform.OS === "android")
				void androidRef.current?.focus().catch(() => {});
			else ref.current?.focus();
		}
	}, [error, disabled]);
	if (Platform.OS === "web")
		return (
			<RNHostView matchContents>
				<Field
					label={label}
					value={value}
					onChange={onChange}
					secure={secure}
					disabled={disabled}
					autoComplete={autoComplete}
					autoCapitalize={autoCapitalize}
					keyboardType={
						keyboardType === "number-pad" ? "decimal-pad" : keyboardType
					}
				/>
			</RNHostView>
		);
	if (Platform.OS === "android")
		return (
			<Column spacing={6}>
				<AndroidPasswordInput
					inputRef={androidRef}
					label={label}
					value={value}
					onChange={onChange}
					secure={secure}
					disabled={disabled}
					autoComplete={autoComplete}
					autoCapitalize={autoCapitalize}
					keyboardType={keyboardType}
					error={error}
					maxLength={maxLength}
					returnKeyType={returnKeyType}
					onSubmitEditing={onSubmitEditing}
				/>
				{!!error && (
					<SemanticText role="caption" tone="danger">
						{error}
					</SemanticText>
				)}
			</Column>
		);
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
				// SwiftUI owns the complete rounded outline, including SecureField.
				// Keep the minimum target outside that style; no additional padding/border.
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
