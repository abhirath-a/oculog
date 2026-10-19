import { Button, FieldGroup, Host } from "@expo/ui";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";
import {
	DateField,
	notifySuccess,
	PresentationText,
	ScreenFrame,
	SemanticText,
	usePresentationEpoch,
} from "../presentation";
import Days from "./days";
import NativeFields from "./native-fields";
import Section from "./section";
import Switch from "./switch";
import type { SettingsModel } from "./use-schedule-settings";

export type SettingsFormProps = {
	model: SettingsModel;
	/** Return only the editor, without a screen frame. Owns one scroller. */
	onboarding?: boolean;
};

/** Platform-native form scrolling with SwiftUI / Material sections.
 * The schedule editor is also reusable without Settings/account chrome. */
export default function SettingsForm({
	model: m,
	onboarding = false,
}: SettingsFormProps) {
	const paletteEpoch = usePresentationEpoch();
	const d = m.draft;
	const leftDateRef = useRef<{ focus(): void }>(null);
	const rightDateRef = useRef<{ focus(): void }>(null);
	// Each invalid Save must refocus the field, even if its error is unchanged.
	// biome-ignore lint/correctness/useExhaustiveDependencies: validationEvent requests native focus again.
	useEffect(() => {
		if (m.disabled) return;
		if (m.fieldErrors.leftOpened) leftDateRef.current?.focus();
		else if (m.fieldErrors.rightOpened) rightDateRef.current?.focus();
	}, [
		m.fieldErrors.leftOpened,
		m.fieldErrors.rightOpened,
		m.disabled,
		m.validationEvent,
	]);
	useEffect(() => {
		const error =
			m.fieldErrors.leftDays ||
			m.fieldErrors.rightDays ||
			m.fieldErrors.leftOpened ||
			m.fieldErrors.rightOpened;
		if (error) AccessibilityInfo.announceForAccessibility(error);
	}, [
		m.fieldErrors.leftDays,
		m.fieldErrors.rightDays,
		m.fieldErrors.leftOpened,
		m.fieldErrors.rightOpened,
	]);
	const previousEvent = useRef(m.savedEvent);
	useEffect(() => {
		if (m.savedEvent !== previousEvent.current) {
			previousEvent.current = m.savedEvent;
			void notifySuccess().catch(() => {});
		}
	}, [m.savedEvent]);
	const days = (right = false) => {
		return (
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
	};
	const editor = (
		<View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
			<Host key={paletteEpoch} style={{ flex: 1, minWidth: 0, width: "100%" }}>
				<NativeFields>
					{(m.connectionError || m.loading) && (
						<Section title="Connection">
							{!!m.connectionError && (
								<SemanticText tone="danger">{m.connectionError}</SemanticText>
							)}
							{m.loading && (
								<SemanticText tone="secondary">Loading settings…</SemanticText>
							)}
							<Button
								label="Retry connection"
								style={{ paddingVertical: 12 }}
								variant="text"
								disabled={m.loading || m.accountDisabled}
								onPress={m.reload}
							/>
						</Section>
					)}
					<Section title="Replacement interval">
						<Switch
							label="Different intervals for each eye"
							value={d.differentIntervals}
							disabled={m.disabled}
							onValueChange={(value) => m.change("differentIntervals", value)}
						/>
						{days()}
						{d.differentIntervals && days(true)}
						<FieldGroup.SectionFooter>
							<SemanticText tone="secondary">
								Use your prescribed replacement interval: 1–365 days. Days
								without wear do not extend it.
							</SemanticText>
						</FieldGroup.SectionFooter>
					</Section>
					<Section title="Current lenses">
						<Switch
							label="Different opened dates for each eye"
							value={d.differentDates}
							disabled={m.disabled}
							onValueChange={(value) => m.change("differentDates", value)}
						/>
						<DateField
							label={
								d.differentDates
									? "Opened on · left lens"
									: "Opened on · both eyes"
							}
							value={d.leftOpened}
							inputRef={leftDateRef}
							error={m.fieldErrors.leftOpened || ""}
							maximum={m.today}
							disabled={m.disabled}
							onChange={(value) => m.change("leftOpened", value)}
						/>
						{d.differentDates && (
							<DateField
								label="Opened on · right lens"
								value={d.rightOpened}
								inputRef={rightDateRef}
								error={m.fieldErrors.rightOpened || ""}
								maximum={m.today}
								disabled={m.disabled}
								onChange={(value) => m.change("rightOpened", value)}
							/>
						)}
						<FieldGroup.SectionFooter>
							<SemanticText tone="secondary">
								Leave the date blank if you have no open lens. Registering an
								opened date does not use spares.
							</SemanticText>
						</FieldGroup.SectionFooter>
					</Section>
					<Section>
						<Button
							label={m.busy ? "Saving…" : "Save changes"}
							style={{ paddingVertical: 12 }}
							disabled={m.disabled}
							onPress={m.save}
						/>
						<FieldGroup.SectionFooter>
							<SemanticText tone="secondary">{`Calendar time zone · ${m.timeZone}`}</SemanticText>
						</FieldGroup.SectionFooter>
					</Section>
				</NativeFields>
			</Host>
			{/* RN owns a bounded, wrapping status area, never intrinsic native-row sizing. */}
			<View
				style={{
					minHeight: 32,
					paddingHorizontal: 16,
					paddingVertical: 6,
					gap: 4,
					alignSelf: "stretch",
					minWidth: 0,
				}}
				accessibilityLiveRegion={m.error ? "assertive" : "polite"}
				accessibilityRole={m.error ? "alert" : undefined}
			>
				{m.busy && <ActivityIndicator accessibilityLabel="Saving settings" />}
				{!!m.error && (
					<PresentationText tone="danger">{m.error}</PresentationText>
				)}
				{!!m.message && <PresentationText>{m.message}</PresentationText>}
			</View>
		</View>
	);
	if (onboarding) return editor;
	return (
		<ScreenFrame title="Lens setup" insetMode="stack" scrollOwner="content">
			{editor}
		</ScreenFrame>
	);
}
