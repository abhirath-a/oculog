import {
	OutlinedTextField,
	Text,
	type TextFieldRef,
	useNativeState,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { type Ref, useEffect } from "react";
import { usePresentationTheme } from "../presentation";

/** Material owns its label, outline, secure transformation and IME together. */
export function AndroidPasswordInput({
	inputRef,
	value,
	onChange,
	label,
	disabled,
	autoComplete,
	secure = true,
	autoCapitalize = "none",
	keyboardType,
	returnKeyType = "done",
	onSubmitEditing,
	maxLength,
	error,
}: {
	inputRef: Ref<TextFieldRef>;
	value: string;
	onChange: (value: string) => void;
	label: string;
	disabled: boolean;
	autoComplete?: "name" | "email" | "current-password" | "new-password" | "off";
	secure?: boolean;
	autoCapitalize?: "none" | "words";
	keyboardType?: "email-address" | "number-pad";
	returnKeyType?: "next" | "done";
	onSubmitEditing?: () => void;
	maxLength?: number;
	error?: string;
}) {
	const theme = usePresentationTheme();
	const text = useNativeState(value);
	useEffect(() => {
		if (text.value !== value) text.value = value;
	}, [text, value]);
	return (
		<OutlinedTextField
			ref={inputRef}
			value={text}
			onValueChange={onChange}
			enabled={!disabled}
			singleLine
			maxLength={maxLength}
			isError={!!error}
			visualTransformation={secure ? "password" : "none"}
			keyboardOptions={{
				keyboardType: secure
					? "password"
					: keyboardType === "email-address"
						? "email"
						: keyboardType === "number-pad"
							? "number"
							: "text",
				capitalization: autoCapitalize,
				autoCorrectEnabled: false,
				imeAction: returnKeyType,
			}}
			keyboardActions={{ onNext: onSubmitEditing, onDone: onSubmitEditing }}
			modifiers={[
				fillMaxWidth(),
				semantics({
					contentType: autoComplete === "off" ? undefined : autoComplete,
				}),
			]}
			textStyle={{ color: theme.text }}
			colors={{
				focusedTextColor: theme.text,
				unfocusedTextColor: theme.text,
				focusedLabelColor: theme.primary,
				unfocusedLabelColor: theme.secondary,
				focusedIndicatorColor: theme.primary,
				unfocusedIndicatorColor: theme.divider,
				cursorColor: theme.primary,
			}}
		>
			<OutlinedTextField.Label>
				<Text>{label}</Text>
			</OutlinedTextField.Label>
		</OutlinedTextField>
	);
}
