import { NativeAction } from "../native-page";
import { usePresentationTheme } from "../presentation/theme";

export { default as Field } from "../native-input";
export { PageToggle as Toggle } from "../native-page";
export function useColors() {
	const theme = usePresentationTheme();
	return {
		bg: theme.background,
		card: theme.surface,
		text: theme.text,
		muted: theme.secondary,
		line: theme.divider,
		accent: theme.primary,
		onAccent: theme.onPrimary,
		danger: theme.error,
	};
}
export function Button({
	title,
	onPress,
	secondary = false,
	disabled = false,
}: {
	title: string;
	onPress(): void;
	secondary?: boolean;
	disabled?: boolean;
	fullWidth?: boolean;
}) {
	return (
		<NativeAction
			label={title}
			emphasis={secondary ? "secondary" : "primary"}
			disabled={disabled}
			onPress={() => {
				if (!disabled) onPress();
			}}
		/>
	);
}
