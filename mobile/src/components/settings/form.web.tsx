import { type CSSProperties, useEffect, useId, useRef } from "react";
import { ScreenFrame, usePresentationTheme } from "../presentation";
import { webTypography } from "../presentation/web-typography";
import Days from "./days";
import type { SettingsFormProps } from "./form";

export type { SettingsFormProps } from "./form";

/** Semantic HTML counterpart: one responsive scroller, labelled sections and
 * native browser controls. Keeps exactly the same controller as native. */
export default function SettingsForm({
	model: m,
	onboarding = false,
}: SettingsFormProps) {
	const theme = usePresentationTheme();
	const id = useId();
	const formRef = useRef<HTMLFormElement>(null);
	const d = m.draft;
	useEffect(() => {
		const field = Object.keys(m.fieldErrors)[0];
		if (field && !m.disabled)
			formRef.current
				?.querySelector<HTMLInputElement>(`[name="${field}"]`)
				?.focus();
	}, [m.fieldErrors, m.disabled]);
	const inputStyle: CSSProperties = {
		width: "100%",
		boxSizing: "border-box",
		minHeight: 44,
		padding: 10,
		border: `1px solid ${theme.divider}`,
		borderRadius: 6,
		background: theme.surface,
		color: theme.text,
		font: "inherit",
		colorScheme: "light dark",
	};
	const buttonStyle: CSSProperties = {
		minWidth: 0,
		whiteSpace: "normal",
		overflowWrap: "anywhere",
		minHeight: 44,
		padding: "8px 16px",
		borderRadius: 6,
		border: `1px solid ${theme.divider}`,
		background: theme.surface,
		color: theme.primary,
		font: "inherit",
		cursor: "pointer",
	};
	const sectionStyle: CSSProperties = {
		border: 0,
		borderTop: `1px solid ${theme.divider}`,
		padding: "16px 0",
		margin: 0,
		minWidth: 0,
		display: "grid",
		gap: "0.75em",
	};
	const helperStyle: CSSProperties = {
		color: theme.secondary,
		fontSize: "0.875rem",
		margin: 0,
		lineHeight: 1.5,
	};
	const choice = (
		label: string,
		key: "differentDates" | "differentIntervals",
	) => (
		<label
			style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}
		>
			<input
				style={{ font: "inherit" }}
				type="checkbox"
				checked={d[key]}
				disabled={m.disabled}
				onChange={(event) => m.change(key, event.target.checked)}
			/>
			{label}
		</label>
	);
	const days = (right = false) => (
		<Days
			validationEvent={m.validationEvent}
			label={
				right
					? "Right eye · days"
					: d.differentIntervals
						? "Left eye · days"
						: "Interval · days"
			}
			value={right ? d.rightDays : d.leftDays}
			disabled={m.disabled}
			error={m.fieldErrors[right ? "rightDays" : "leftDays"] || ""}
			onChange={(value) => m.change(right ? "rightDays" : "leftDays", value)}
		/>
	);
	const date = (key: "leftOpened" | "rightOpened", label: string) => (
		<label style={{ display: "grid", gap: 6 }}>
			{label}
			<input
				type="date"
				name={key}
				value={d[key]}
				max={m.today}
				disabled={m.disabled}
				aria-invalid={!!m.fieldErrors[key]}
				aria-describedby={m.fieldErrors[key] ? `${id}-${key}` : undefined}
				onChange={(event) => m.change(key, event.target.value)}
				style={inputStyle}
			/>
			{!!m.fieldErrors[key] && (
				<span id={`${id}-${key}`} role="alert" style={{ color: theme.error }}>
					{m.fieldErrors[key]}
				</span>
			)}
			{!!d[key] && (
				<button
					type="button"
					disabled={m.disabled}
					style={buttonStyle}
					onClick={() => m.change(key, "")}
				>
					Clear {label.toLowerCase()}
				</button>
			)}
		</label>
	);
	const editor = (
		<div
			style={{
				flex: 1,
				minWidth: 0,
				minHeight: 0,
				overflow: "auto",
				overflowWrap: "anywhere",
				color: theme.text,
				background: theme.background,
			}}
		>
			<form
				ref={formRef}
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					m.save();
				}}
				style={{
					...webTypography,
					width: "100%",
					maxWidth: 760,
					padding: "8px 20px 24px",
					margin: "0 auto",
					boxSizing: "border-box",
					lineHeight: 1.5,
				}}
			>
				{(m.connectionError || m.loading) && (
					<section aria-label="Connection" style={sectionStyle}>
						{!!m.connectionError && (
							<p role="alert" style={{ color: theme.error, margin: 0 }}>
								{m.connectionError}
							</p>
						)}
						{m.loading && <p role="status">Loading settings…</p>}
						<button
							type="button"
							style={buttonStyle}
							disabled={m.loading || m.accountDisabled}
							onClick={m.reload}
						>
							Retry connection
						</button>
					</section>
				)}
				<fieldset style={sectionStyle}>
					<legend>Replacement interval</legend>
					{choice("Different intervals for each eye", "differentIntervals")}
					<div
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
							gap: 16,
						}}
					>
						{days()}
						{d.differentIntervals && days(true)}
					</div>
					<p style={helperStyle}>
						Use your prescribed replacement interval: 1–365 days. Days without
						wear do not extend it.
					</p>
				</fieldset>
				<fieldset style={sectionStyle}>
					<legend>Current lenses</legend>
					{choice("Different opened dates for each eye", "differentDates")}
					<div
						style={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
							gap: 16,
						}}
					>
						{date(
							"leftOpened",
							d.differentDates
								? "Opened on · left lens"
								: "Opened on · both eyes",
						)}
						{d.differentDates && date("rightOpened", "Opened on · right lens")}
					</div>
					<p style={helperStyle}>
						Leave the date blank if you have no open lens. Registering an opened
						date does not use spares.
					</p>
				</fieldset>
				<section aria-label="Save changes" style={sectionStyle}>
					<button
						type="submit"
						disabled={m.disabled}
						style={{
							...buttonStyle,
							background: theme.primary,
							color: theme.onPrimary,
						}}
					>
						{m.busy ? "Saving…" : "Save changes"}
					</button>
					<div style={{ minHeight: "1.5em" }}>
						{!!m.error && (
							<p role="alert" style={{ color: theme.error, margin: 0 }}>
								{m.error}
							</p>
						)}
						<div role="status" aria-live="polite">
							{m.busy ? "Saving settings…" : m.message}
						</div>
					</div>
					<p style={helperStyle}>Calendar time zone · {m.timeZone}</p>
				</section>
			</form>
		</div>
	);
	if (onboarding) return editor;
	return (
		<ScreenFrame title="Lens setup" insetMode="stack" scrollOwner="content">
			{editor}
		</ScreenFrame>
	);
}
