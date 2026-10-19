import {
	Text,
	TextField,
	type TextFieldRef,
	useNativeState,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef } from "react";
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
	const ref = useRef<TextFieldRef>(null);
	useEffect(() => {
		if (text.value !== value) text.value = value;
	}, [text, value]);
	useEffect(() => {
		// A repeated failed submit must refocus even when the error is unchanged.
		void validationEvent;
		if (!error || disabled) return;
		// Flush enabled/supporting-text props before requesting native focus. The
		// enclosing native verticalScroll then brings the composed field into view.
		let cancelled = false;
		const frame = requestAnimationFrame(() => {
			// Android Back hides the IME without clearing Compose focus. Requesting
			// focus on that same field is a no-op; release it before requesting again.
			const input = ref.current;
			if (input)
				void input
					.blur()
					.then(() => {
						if (!cancelled) return input.focus();
					})
					.catch(() => {
						// The native composition may have been disposed during navigation.
					});
		});
		return () => {
			cancelled = true;
			cancelAnimationFrame(frame);
		};
	}, [error, disabled, validationEvent]);
	return (
		<TextField
			ref={ref}
			value={text}
			onValueChange={onChange}
			enabled={!disabled}
			singleLine
			maxLength={3}
			isError={!!error}
			keyboardOptions={{ keyboardType: "number", imeAction: "done" }}
			keyboardActions={{
				onDone: () => {
					void ref.current?.blur();
				},
			}}
			modifiers={[fillMaxWidth(), semantics({ contentDescription: label })]}
		>
			<TextField.Label>
				<Text>{label}</Text>
			</TextField.Label>
			{!!error && (
				<TextField.SupportingText>
					<Text>{error}</Text>
				</TextField.SupportingText>
			)}
		</TextField>
	);
}
