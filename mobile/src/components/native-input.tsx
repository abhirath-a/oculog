import { TextInput, type TextInputRef, useNativeState } from "@expo/ui";
import { accessibilityLabel, font, frame } from "@expo/ui/swift-ui/modifiers";
import {
	type Ref,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import type { KeyboardTypeOptions } from "react-native";
import { NativeAction, NativeStack, NativeText } from "./native-page";
import { usePresentationTheme } from "./presentation/theme";

export type NativeInputProps = {
	label: string;
	value: string;
	onChange(value: string): void;
	disabled?: boolean;
	error?: string;
	placeholder?: string;
	multiline?: boolean;
	maxLength?: number;
	keyboardType?: KeyboardTypeOptions;
	autoCapitalize?: "none" | "sentences" | "words" | "characters";
	autoCorrect?: boolean;
	inputRef?: Ref<TextInputRef>;
};

export default function NativeInput({
	label,
	value,
	onChange,
	disabled = false,
	error,
	placeholder,
	inputRef,
	...props
}: NativeInputProps) {
	const native = useNativeState(value);
	const ref = useRef<TextInputRef>(null);
	const [focused, setFocused] = useState(false);
	const theme = usePresentationTheme();
	useImperativeHandle(
		inputRef,
		() => ({
			focus: () => {
				if (!disabled) ref.current?.focus();
			},
			blur: () => ref.current?.blur(),
			clear: () => {
				if (!disabled) ref.current?.clear();
			},
			isFocused: () => ref.current?.isFocused() ?? false,
			setSelection: (start, end) =>
				ref.current?.setSelection(start, end) ?? Promise.resolve(),
		}),
		[disabled],
	);
	useEffect(() => {
		if (native.value !== value) native.value = value;
	}, [native, value]);
	return (
		<NativeStack>
			<NativeText>{label}</NativeText>
			<TextInput
				{...props}
				ref={ref}
				returnKeyType={props.multiline ? undefined : "done"}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				value={native}
				editable={!disabled}
				placeholder={placeholder ?? label}
				onChangeText={(next) => {
					if (!disabled) onChange(next);
				}}
				textStyle={{ color: theme.text }}
				modifiers={[
					font({ textStyle: "body" }),
					frame({ maxWidth: Infinity, minHeight: 44 }),
					accessibilityLabel(label),
				]}
			/>
			{!!error && <NativeText tone="error">{error}</NativeText>}
			{focused && props.keyboardType === "number-pad" && (
				<NativeAction
					label={`Done`}
					accesibilityText={`editing ${label}`}
					disabled={disabled}
					onPress={() => {
						if (!disabled) ref.current?.blur();
					}}
				/>
			)}
		</NativeStack>
	);
}
