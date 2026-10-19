import { useId } from "react";
import { usePresentationTheme } from "../presentation";
import { webTypography } from "../presentation/web-typography";

/** Real radio inputs retain browser focus, arrow keys, and unknown (neither checked). */
export function DailyChoice({
	worn,
	disabled,
	onLog,
}: {
	worn: boolean | null;
	disabled: boolean;
	onLog: (worn: boolean) => void;
	stacked?: boolean;
}) {
	const theme = usePresentationTheme();
	const name = useId();
	return (
		<fieldset
			disabled={disabled}
			style={{
				...webTypography,
				border: 0,
				padding: 0,
				margin: 0,
				minWidth: 0,
			}}
		>
			<legend
				style={{
					position: "absolute",
					width: 1,
					height: 1,
					overflow: "hidden",
					clipPath: "inset(50%)",
				}}
			>
				Did you wear lenses today?
			</legend>
			<div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
				{[true, false].map((value) => (
					<label
						key={String(value)}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							minHeight: 48,
							padding: "0.25em 20px",
							borderRadius: 8,
							border: `1px solid ${theme.primary}`,
							background: worn === value ? theme.primary : theme.surface,
							color: worn === value ? theme.onPrimary : theme.text,
							opacity: disabled ? 0.5 : 1,
							font: "inherit",
							cursor: disabled ? "default" : "pointer",
						}}
					>
						<input
							type="radio"
							name={name}
							checked={worn === value}
							disabled={disabled}
							onChange={() => !disabled && onLog(value)}
							style={{
								font: "inherit",
								accentColor: theme.primary,
								width: 20,
								height: 20,
							}}
						/>
						{value ? "Yes" : "No"}
					</label>
				))}
			</div>
		</fieldset>
	);
}
