import {
	Column,
	TextInput as Input,
	RNHostView,
	type TextInputRef,
	useNativeState,
} from "@expo/ui";
import {
	BasicTextField,
	type TextFieldRef,
	useNativeState as useComposeState,
} from "@expo/ui/jetpack-compose";
import {
	defaultMinSize,
	fillMaxWidth,
	padding,
	semantics,
} from "@expo/ui/jetpack-compose/modifiers";
import {
	accessibilityLabel,
	font,
	frame,
	textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useId, useImperativeHandle, useRef } from "react";
import { Platform, TextInput, View } from "react-native";
import type { NativeFieldProps } from "./native-field.types";
import { SemanticText } from "./semantic-text";
import { PresentationText } from "./text";
import { usePresentationTheme } from "./theme";

export type { NativeFieldHandle, NativeFieldProps } from "./native-field.types";

/** Native-tree form row, no Host or scroller. Place in FieldGroup.Section/Column.
 * Web RN input is explicitly bridged. SwiftUI owns its field outline; never
 * simulate rounded input borders through universal style (which clips iOS borders).
 */
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
	const text = useNativeState(value);
	const password = useComposeState(value);
	const ref = useRef<TextInputRef>(null);
	const webRef = useRef<TextInput>(null);
	const passwordRef = useRef<TextFieldRef>(null);
	useEffect(() => {
		if (text.value !== value) text.value = value;
	}, [text, value]);
	useEffect(() => {
		if (password.value !== value) password.value = value;
	}, [password, value]);
	useImperativeHandle(
		inputRef,
		() => ({
			focus: () => {
				if (!disabled)
					(Platform.OS === "web"
						? webRef.current
						: Platform.OS === "android" && secure
							? passwordRef.current
							: ref.current
					)?.focus();
			},
			blur: () =>
				(Platform.OS === "web"
					? webRef.current
					: Platform.OS === "android" && secure
						? passwordRef.current
						: ref.current
				)?.blur(),
		}),
		[disabled, secure],
	);
	const change = (next: string) => {
		if (!disabled) onChange(next);
	};
	if (Platform.OS === "web")
		return (
			<RNHostView matchContents>
				<View style={{ gap: 4 }}>
					{/* biome-ignore lint/a11y/useValidAriaRole: Presentation typography, not ARIA. */}
					<PresentationText role="callout">{label}</PresentationText>
					<TextInput
						{...props}
						ref={webRef}
						value={value}
						onChangeText={change}
						accessibilityLabel={label}
						aria-invalid={!!error}
						aria-describedby={error ? `${id}-error` : undefined}
						secureTextEntry={secure}
						editable={!disabled}
						autoCapitalize={autoCapitalize}
						autoCorrect={autoCorrect}
						onSubmitEditing={() => props.onSubmitEditing?.(value)}
						placeholderTextColor={theme.secondary}
						style={{
							minHeight: props.multiline ? 88 : 44,
							padding: 10,
							fontSize: 16,
							color: theme.text,
							borderWidth: 1,
							borderColor: error ? theme.error : theme.divider,
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
			</RNHostView>
		);
	return (
		<Column spacing={2}>
			{/* biome-ignore lint/a11y/useValidAriaRole: Presentation typography, not ARIA. */}
			<SemanticText role="callout" tone="secondary">
				{label}
			</SemanticText>
			{Platform.OS === "android" && secure ? (
				<BasicTextField
					ref={passwordRef}
					value={password}
					onValueChange={change}
					enabled={!disabled}
					singleLine
					visualTransformation="password"
					autoFocus={props.autoFocus}
					maxLength={props.maxLength}
					keyboardOptions={{
						keyboardType: "password",
						capitalization: "none",
						autoCorrectEnabled: false,
						imeAction: props.returnKeyType === "next" ? "next" : "done",
					}}
					keyboardActions={{
						onNext: props.onSubmitEditing,
						onDone: props.onSubmitEditing,
					}}
					onFocusChanged={(focused) =>
						focused ? props.onFocus?.() : props.onBlur?.()
					}
					modifiers={[
						fillMaxWidth(),
						defaultMinSize({ minHeight: 48 }),
						padding(0, 10, 0, 10),
						semantics({
							contentDescription: label,
							contentType: props.autoComplete,
						}),
					]}
					textStyle={{ color: theme.text, fontSize: 16 }}
				/>
			) : (
				<Input
					{...props}
					ref={ref}
					value={text}
					onChangeText={change}
					secureTextEntry={secure}
					editable={!disabled}
					autoCapitalize={autoCapitalize}
					autoCorrect={autoCorrect}
					placeholderTextColor={theme.secondary}
					modifiers={
						Platform.OS === "ios"
							? [
									accessibilityLabel(label),
									font({ textStyle: "body" }),
									textFieldStyle("roundedBorder"),
									frame({ minHeight: props.multiline ? 88 : 44 }),
								]
							: [
									fillMaxWidth(),
									semantics({ contentDescription: label }),
									defaultMinSize({ minHeight: props.multiline ? 88 : 48 }),
								]
					}
					textStyle={{ color: theme.text }}
				/>
			)}
			{!!error && (
				<SemanticText role="caption" tone="danger">
					{error}
				</SemanticText>
			)}
		</Column>
	);
}
