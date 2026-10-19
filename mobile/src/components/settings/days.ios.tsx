import {
	Button,
	HStack,
	Text,
	TextField,
	type TextFieldRef,
	useNativeState,
	VStack,
} from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	disabled as disable,
	fixedSize,
	font,
	frame,
	keyboardType,
	multilineTextAlignment,
	textFieldStyle,
} from "@expo/ui/swift-ui/modifiers";
import { useEffect, useRef, useState } from "react";
import { useWindowDimensions } from "react-native";
import { SemanticText } from "../presentation";
import type { DaysProps } from "./days";

export default function Days({
	label,
	value,
	disabled,
	error,
	validationEvent,
	onChange,
}: DaysProps) {
	const text = useNativeState(value);
	const [focused, setFocused] = useState(false);
	const { fontScale } = useWindowDimensions();
	const inline = fontScale <= 1.3;
	const Row = inline ? HStack : VStack;
	const ref = useRef<TextFieldRef>(null);
	useEffect(() => {
		if (text.value !== value) text.value = value;
	}, [text, value]);
	useEffect(() => {
		// A repeated failed submit must refocus even when the error is unchanged.
		void validationEvent;
		if (!error || disabled) return;
		const frame = requestAnimationFrame(() => {
			void ref.current?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [error, disabled, validationEvent]);
	return (
		<VStack
			alignment="leading"
			spacing={4}
			modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
		>
			<Row spacing={inline ? 12 : 4} modifiers={[frame({ minHeight: 44 })]}>
				<Text
					modifiers={[
						font({ textStyle: "body" }),
						fixedSize({ horizontal: false, vertical: true }),
						frame({ maxWidth: Infinity, alignment: "leading" }),
					]}
				>
					{label}
				</Text>
				<TextField
					ref={ref}
					text={text}
					onTextChange={onChange}
					onFocusChange={setFocused}
					maxLength={3}
					placeholder="Days"
					modifiers={[
						accessibilityLabel(label),
						keyboardType("numeric"),
						font({ textStyle: "body" }),
						textFieldStyle("plain"),
						multilineTextAlignment(inline ? "trailing" : "leading"),
						frame({ width: inline ? 72 : undefined }),
						frame({ minHeight: 44 }),
						disable(disabled),
					]}
				/>
			</Row>
			{!!error && <SemanticText tone="danger">{error}</SemanticText>}
			{focused && (
				<Button
					onPress={() => {
						void ref.current?.blur();
					}}
					modifiers={[
						accessibilityLabel(`Done editing ${label}`),
						disable(disabled),
					]}
				>
					<Text
						modifiers={[
							font({ textStyle: "body" }),
							fixedSize({ horizontal: false, vertical: true }),
							frame({ minWidth: 44, minHeight: 44 }),
						]}
					>
						Done
					</Text>
				</Button>
			)}
		</VStack>
	);
}
