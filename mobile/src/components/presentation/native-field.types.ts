import type { TextInputProps } from "@expo/ui";
import type { Ref } from "react";

export type NativeFieldHandle = { focus(): void; blur(): void };
export type NativeFieldProps = Pick<
	TextInputProps,
	| "placeholder"
	| "multiline"
	| "keyboardType"
	| "autoComplete"
	| "autoCapitalize"
	| "autoCorrect"
	| "autoFocus"
	| "maxLength"
	| "returnKeyType"
	| "onSubmitEditing"
	| "onFocus"
	| "onBlur"
> & {
	label: string;
	value: string;
	onChange(value: string): void;
	secure?: boolean;
	disabled?: boolean;
	error?: string;
	inputRef?: Ref<NativeFieldHandle>;
};
