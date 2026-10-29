import { Button, Column, Icon, Row, Text, type TextInputRef } from "@expo/ui";
import {
	accessibilityAddTraits,
	buttonStyle,
	fixedSize,
	font,
	foregroundStyle,
	frame,
	glassEffect,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useCallback, useEffect, useRef } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import NativeInput from "../native-input";
import { PageToggle } from "../native-page";
import { usePresentationTheme } from "../presentation/theme";
import EditorDate from "./editor-date";
import type { SettingsModel } from "./use-schedule-settings";

type Props = {
	model: SettingsModel;
	change: SettingsModel["change"];
	current(): boolean;
};

/** Preview only: never normalize a malformed draft into a valid interval. */
function intervalPreview(raw: string): string {
	if (raw === "") return "Interval not set";
	if (!/^[0-9]{1,3}$/.test(raw)) return "Invalid interval";
	const days = Number(raw);
	if (days < 1 || days > 365) return "Invalid interval";
	return `Every ${days} ${days === 1 ? "day" : "days"}`;
}

/** Native children only. The caller owns the Host, scroll, session and Save. */
export function LensSetupFields({ model: m, change, current }: Props) {
	const theme = usePresentationTheme();
	const d = m.draft;
	const leftDays = useRef<TextInputRef>(null);
	const rightDays = useRef<TextInputRef>(null);
	const leftDate = useRef<{ focus(): void }>(null);
	const rightDate = useRef<{ focus(): void }>(null);
	const handledValidation = useRef(m.validationEvent);
	const announcedError = useRef("");
	const mounted = useRef(true);
	const latest = useRef({ model: m, change, current });
	latest.current = { model: m, change, current };
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const sessionCurrent = useCallback(
		() => mounted.current && latest.current.current(),
		[],
	);
	const canEdit = useCallback(
		() =>
			sessionCurrent() &&
			!latest.current.model.disabled &&
			latest.current.model.canLeave(),
		[sessionCurrent],
	);
	const edit: SettingsModel["change"] = (key, value) => {
		// Retained native callbacks belong to their originating render/session.
		if (current() && canEdit()) latest.current.change(key, value);
	};
	useEffect(() => {
		if (
			m.disabled ||
			!current() ||
			handledValidation.current === m.validationEvent
		)
			return;
		const error =
			m.fieldErrors.leftDays ||
			m.fieldErrors.rightDays ||
			m.fieldErrors.leftOpened ||
			m.fieldErrors.rightOpened;
		if (!error) return;
		handledValidation.current = m.validationEvent;
		AccessibilityInfo.announceForAccessibility(error);
		const frame = requestAnimationFrame(() => {
			if (
				!current() ||
				!canEdit() ||
				latest.current.model.validationEvent !== m.validationEvent
			)
				return;
			if (m.fieldErrors.leftDays) leftDays.current?.focus();
			else if (m.fieldErrors.rightDays) rightDays.current?.focus();
			else if (m.fieldErrors.leftOpened) leftDate.current?.focus();
			else if (m.fieldErrors.rightOpened) rightDate.current?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [m.disabled, m.fieldErrors, m.validationEvent, current, canEdit]);
	useEffect(() => {
		if (!current()) return;
		if (m.error && announcedError.current !== m.error)
			AccessibilityInfo.announceForAccessibility(m.error);
		announcedError.current = m.error;
	}, [m.error, current]);
	const textModifiers = [
		font({ textStyle: "subheadline" }),
		foregroundStyle(theme.secondary),
		fixedSize({ horizontal: false, vertical: true }),
		frame({ maxWidth: Infinity, alignment: "leading" }),
	];
	const headingModifiers = [
		font({ textStyle: "headline", weight: "semibold" }),
		foregroundStyle(theme.text),
		fixedSize({ horizontal: false, vertical: true }),
		frame({ maxWidth: Infinity, alignment: "leading" }),
		accessibilityAddTraits(["isHeader"]),
	];
	const preview = (label: string, value: string) => (
		<Column spacing={4} style={{ width: "100%" }}>
			<Text modifiers={textModifiers}>{label}</Text>
			<Text
				modifiers={[
					font({
						textStyle: intervalPreview(value).startsWith("Every ")
							? "largeTitle"
							: "title3",
						weight: "bold",
					}),
					foregroundStyle(theme.text),
					fixedSize({ horizontal: false, vertical: true }),
					frame({ maxWidth: Infinity, alignment: "leading" }),
				]}
			>
				{intervalPreview(value)}
			</Text>
		</Column>
	);
	return (
		<Column spacing={20} style={{ width: "100%" }}>
			<Column
				spacing={20}
				style={{
					width: "100%",
					padding: 20,
					borderRadius: 26,
					// Native glass is iOS 26+; older systems keep a readable grouped surface.
					...(Number.parseFloat(String(Platform.Version)) < 26
						? { backgroundColor: theme.surface }
						: {}),
				}}
				modifiers={[
					glassEffect({
						glass: { variant: "regular" },
						shape: "roundedRectangle",
						cornerRadius: 26,
					}),
				]}
			>
				<Row spacing={10} style={{ width: "100%" }}>
					<Icon name="1.circle.fill" size={24} color={theme.primary} />
					<Text modifiers={headingModifiers}>Replacement interval</Text>
				</Row>
				<Column spacing={12} style={{ width: "100%" }}>
					<Text modifiers={textModifiers}>Draft preview</Text>
					{preview(d.differentIntervals ? "Left eye" : "Both eyes", d.leftDays)}
					{d.differentIntervals && preview("Right eye", d.rightDays)}
				</Column>
				<Column spacing={12} style={{ width: "100%" }}>
					<NativeInput
						label={
							d.differentIntervals ? "Left eye cycle" : "Lens replacement cycle"
						}
						inputRef={leftDays}
						value={d.leftDays}
						disabled={m.disabled}
						error={m.fieldErrors.leftDays}
						keyboardType="number-pad"
						maxLength={3}
						onChange={(value) => edit("leftDays", value)}
					/>
					{d.differentIntervals && (
						<NativeInput
							label="Right eye cycle"
							inputRef={rightDays}
							value={d.rightDays}
							disabled={m.disabled}
							error={m.fieldErrors.rightDays}
							keyboardType="number-pad"
							maxLength={3}
							onChange={(value) => edit("rightDays", value)}
						/>
					)}
					<PageToggle
						label="Different intervals for each eye"
						value={d.differentIntervals}
						disabled={m.disabled}
						onChange={(value) => edit("differentIntervals", value)}
					/>
					<Text modifiers={textModifiers}>
						Use your prescribed interval: 1–365 days. Days without wear do not
						extend it.
					</Text>
				</Column>
			</Column>
			<Column
				spacing={16}
				style={{
					width: "100%",
					padding: 20,
					borderRadius: 22,
					backgroundColor: theme.surface,
				}}
			>
				<Column spacing={4} style={{ width: "100%" }}>
					<Row spacing={10} style={{ width: "100%" }}>
						<Icon name="2.circle" size={24} color={theme.secondary} />
						<Text modifiers={headingModifiers}>Current lenses</Text>
					</Row>
					<Text modifiers={textModifiers}>Optional</Text>
				</Column>
				<EditorDate
					label={d.differentDates ? "Left lens open date" : "Lenses open date"}
					value={d.leftOpened}
					inputRef={leftDate}
					error={m.fieldErrors.leftOpened}
					maximum={m.today}
					disabled={m.disabled}
					onChange={(value) => edit("leftOpened", value)}
				/>
				{d.differentDates && (
					<EditorDate
						label="Opened on · right lens"
						value={d.rightOpened}
						inputRef={rightDate}
						error={m.fieldErrors.rightOpened}
						maximum={m.today}
						disabled={m.disabled}
						onChange={(value) => edit("rightOpened", value)}
					/>
				)}
				<PageToggle
					label="Different opened dates for each eye"
					value={d.differentDates}
					disabled={m.disabled}
					onChange={(value) => edit("differentDates", value)}
				/>
				<Text modifiers={textModifiers}>
					Leave blank if no lens is open. Adding an opened date does not use
					spares.
				</Text>
			</Column>
			<Column spacing={10} style={{ width: "100%" }}>
				<Text
					modifiers={textModifiers}
				>{`Calendar time zone · ${m.timeZone}`}</Text>
				{!!m.connectionError && (
					<Text modifiers={[...textModifiers, foregroundStyle(theme.error)]}>
						{m.connectionError}
					</Text>
				)}
				{m.loading && (
					<Text modifiers={textModifiers}>Loading your schedule…</Text>
				)}
				{!!m.error && (
					<Text modifiers={[...textModifiers, foregroundStyle(theme.error)]}>
						{m.error}
					</Text>
				)}
				{(m.connectionError || m.error || m.loading) && (
					<Button
						variant="text"
						disabled={m.loading || m.accountDisabled}
						modifiers={[
							buttonStyle("plain"),
							tint(theme.primary),
							frame({ minHeight: 44 }),
						]}
						onPress={() => {
							const model = latest.current.model;
							if (
								current() &&
								sessionCurrent() &&
								!model.loading &&
								!model.accountDisabled &&
								model.canLeave()
							)
								model.reload();
						}}
					>
						<Text
							modifiers={[
								font({ textStyle: "body" }),
								fixedSize({ horizontal: false, vertical: true }),
							]}
						>
							Retry connection
						</Text>
					</Button>
				)}
			</Column>
		</Column>
	);
}

export default LensSetupFields;
