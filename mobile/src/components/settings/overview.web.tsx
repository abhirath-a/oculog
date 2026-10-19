import { View } from "react-native";
import {
	PresentationText,
	ScreenFrame,
	usePresentationTheme,
} from "../presentation";
import { webTypography } from "../presentation/web-typography";
import { Button } from "../ui";
import type { SettingsOverviewProps } from "./overview";

// Format literal calendar components. No instant or timezone conversion is involved.
function openedLabel(value: string) {
	return value.replace(
		/Opened on (\d{4})-(\d{2})-(\d{2})/i,
		(_, year, month, day) => {
			const name = [
				"Jan",
				"Feb",
				"Mar",
				"Apr",
				"May",
				"Jun",
				"Jul",
				"Aug",
				"Sep",
				"Oct",
				"Nov",
				"Dec",
			][Number(month) - 1];
			return name
				? `Opened ${Number(day)} ${name} ${year}`
				: `Opened ${year}-${month}-${day}`;
		},
	);
}

/** Reflow the existing summary, not the editor draft, into per-eye supporting lines. */
function supportingLines(summary: string) {
	const [intervals = "Not set", dates = "No open lenses"] = summary.split("\n");
	const clause = (line: string, eye: string, shared: string) => {
		if (line.startsWith(`${shared} · `)) return line.slice(shared.length + 3);
		return (
			line
				.split("; ")
				.find((part) => part.startsWith(`${eye} · `))
				?.slice(eye.length + 3) ?? line
		);
	};
	return ["Left", "Right"].map((eye) => {
		const interval = clause(intervals, eye, "Both eyes");
		const opened = clause(dates, eye, "Both lenses");
		return `${eye}: ${interval === "Not set" ? "Interval not set" : interval} · ${opened === "No open lenses" ? "No open lens" : openedLabel(opened)}`;
	});
}

/** Web has no native UI imports. The lens row remains a real navigation link. */
export default function SettingsOverview({
	model: m,
	summary,
	onEdit,
}: SettingsOverviewProps) {
	const theme = usePresentationTheme();
	const section = {
		borderBottomWidth: 1,
		borderColor: theme.divider,
		paddingVertical: 16,
		gap: 12,
	} as const;
	return (
		<ScreenFrame title="Settings" insetMode="tabs" scrollOwner="frame">
			<View style={section}>
				<PresentationText heading>Lenses</PresentationText>
				<style>{`
					.oculog-lens-row:focus-visible { outline: 2px solid ${theme.primary}; outline-offset: 4px; }
					@media (hover: hover) { .oculog-lens-row:not([aria-disabled="true"]):hover { background-color: color-mix(in srgb, currentColor 6%, transparent); } }
					.oculog-lens-row:not([aria-disabled="true"]):active { background-color: color-mix(in srgb, currentColor 10%, transparent); }
				`}</style>
				<a
					className="oculog-lens-row"
					href={m.accountDisabled ? undefined : "/lens-editor"}
					role={m.accountDisabled ? "link" : undefined}
					tabIndex={0}
					aria-disabled={m.accountDisabled}
					onClick={(event) => {
						if (m.accountDisabled) {
							event.preventDefault();
							return;
						}
						if (
							event.button === 0 &&
							!event.metaKey &&
							!event.ctrlKey &&
							!event.shiftKey &&
							!event.altKey
						) {
							event.preventDefault();
							onEdit();
						}
					}}
					style={{
						...webTypography,
						color: theme.primary,
						display: "grid",
						gridTemplateColumns: "minmax(0, 1fr) auto",
						alignItems: "center",
						gap: "1em",
						textDecoration: "none",
						borderRadius: 4,
						minWidth: 0,
						minHeight: 44,
						padding: "8px 0",
						overflowWrap: "anywhere",
					}}
				>
					<span style={{ display: "grid", gap: "0.5em", minWidth: 0 }}>
						<span style={{ fontWeight: 500 }}>Lens setup</span>
						<span
							style={{
								color: theme.secondary,
								display: "grid",
								gap: "0.375em",
							}}
						>
							{supportingLines(summary).map((line) => (
								<span key={line}>{line}</span>
							))}
						</span>
					</span>
					<svg
						aria-hidden="true"
						focusable="false"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					>
						<path d="m9 5 7 7-7 7" />
					</svg>
				</a>
			</View>
			<View style={section}>
				<PresentationText heading>Account</PresentationText>
				<View style={{ gap: 4 }}>
					<PresentationText tone="secondary">Email</PresentationText>
					<PresentationText>{m.email}</PresentationText>
				</View>
				<View style={{ gap: 4 }}>
					<PresentationText tone="secondary">
						Calendar time zone
					</PresentationText>
					<PresentationText>{m.timeZone}</PresentationText>
				</View>
			</View>
			<View style={section}>
				<Button
					title="Sign out"
					variant="text"
					disabled={m.accountDisabled}
					onPress={m.signOut}
				/>
				{!!m.accountError && (
					<PresentationText tone="danger">{m.accountError}</PresentationText>
				)}
			</View>
			{!!m.connectionError && (
				<View style={section}>
					<PresentationText tone="danger">{m.connectionError}</PresentationText>
					<Button
						title="Retry connection"
						disabled={m.loading || m.accountDisabled}
						onPress={m.reload}
					/>
				</View>
			)}
		</ScreenFrame>
	);
}
