import { webTypography } from "./presentation/web-typography";
import type {
	ButtonControlProps,
	SwitchControlProps,
} from "./ui-controls.types";

export function ButtonControl({
	title,
	onPress,
	disabled,
	appearance,
	fullWidth,
	colors,
	danger,
}: ButtonControlProps) {
	const accent = danger ? colors.danger : colors.accent;
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={() => {
				if (!disabled) onPress();
			}}
			style={{
				minHeight: 48,
				padding: "8px 12px",
				...webTypography,
				fontSize: 16,
				fontWeight: 500,
				borderRadius: 6,
				border:
					appearance === "outlined"
						? `1px solid ${accent}`
						: "1px solid transparent",
				backgroundColor: appearance === "filled" ? accent : "transparent",
				color: appearance === "filled" ? colors.onAccent : accent,
				width: fullWidth ? "100%" : undefined,
				opacity: disabled ? 0.5 : 1,
				cursor: disabled ? "default" : "pointer",
			}}
		>
			{title}
		</button>
	);
}

/** Real checkbox supplies Space activation, tab focus, label activation and disabled semantics. */
export function SwitchControl({
	label,
	value,
	disabled,
	onChange,
}: SwitchControlProps) {
	return (
		<label
			style={{
				...webTypography,
				display: "flex",
				alignItems: "center",
				gap: "0.5em",
				minHeight: 48,
			}}
		>
			<input
				style={{ font: "inherit" }}
				type="checkbox"
				role="switch"
				aria-checked={value}
				checked={value}
				disabled={disabled}
				onChange={(event) => {
					if (!disabled) onChange(event.currentTarget.checked);
				}}
			/>
			{label}
		</label>
	);
}
