// biome-ignore-all lint/a11y/useValidAriaRole: SemanticText role is a native typography token.
import { Button, Column, FieldGroup, Host, Row } from "@expo/ui";
import { fillMaxWidth, weight } from "@expo/ui/jetpack-compose/modifiers";
import { frame } from "@expo/ui/swift-ui/modifiers";
import { Platform, useColorScheme, useWindowDimensions } from "react-native";
import type {
	SimpleEyeState,
	SimpleState,
} from "../../../shared/simple-domain";
import type { Eye } from "../../lib/simple-controller";
import {
	SemanticText,
	usePresentationEpoch,
	usePresentationTheme,
} from "../presentation";
import { DailyChoice } from "./daily-choice";
import {
	dailyAcknowledgement,
	eyeSummary,
	type HomeContentProps,
} from "./model";

const touchTarget =
	Platform.OS === "ios" ? [frame({ minHeight: 44 })] : undefined;
// Native layout modifiers, not percentage dimensions (Compose expects numbers).
const fullWidth =
	Platform.OS === "ios"
		? [frame({ maxWidth: Infinity, alignment: "leading" })]
		: [fillMaxWidth()];
const rowContent =
	Platform.OS === "ios"
		? [frame({ maxWidth: Infinity, alignment: "leading" })]
		: [weight(1)];

/** A compact list row, not a separate dashboard card. Large text stacks naturally. */
export function EyeCard({
	settings,
	disabled,
	onReplace,
	stacked = false,
}: {
	settings: SimpleEyeState;
	disabled: boolean;
	onReplace: (eye: Eye) => void;
	stacked?: boolean;
}) {
	const summary = eyeSummary(settings);
	const Layout = stacked ? Column : Row;
	const canReplace = summary.configured && settings.spareCount > 0;
	return (
		<Layout spacing={12} modifiers={fullWidth} style={{ paddingVertical: 4 }}>
			<Column spacing={4} modifiers={stacked ? fullWidth : rowContent}>
				<SemanticText role="headline" heading>
					{summary.name}
				</SemanticText>
				<SemanticText
					tone={
						settings.daysRemaining !== null && settings.daysRemaining <= 0
							? "danger"
							: "primary"
					}
				>
					{summary.countdown}
				</SemanticText>
				{summary.due && (
					<SemanticText role="callout" tone="secondary">
						{summary.due}
					</SemanticText>
				)}
				{summary.configured && settings.spareCount < 1 && (
					<SemanticText
						role="caption"
						tone="secondary"
					>{`Add spares to ${settings.openedOn ? "replace" : "start"} this lens.`}</SemanticText>
				)}
			</Column>
			<Column spacing={4}>
				<SemanticText
					role="callout"
					tone="secondary"
				>{`Spares: ${settings.spareCount}`}</SemanticText>
				{canReplace ? (
					<Button
						label={summary.actionLabel}
						variant="outlined"
						disabled={disabled}
						modifiers={touchTarget}
						onPress={() => !disabled && onReplace(settings.eye)}
					/>
				) : null}
			</Column>
		</Layout>
	);
}

export function DailyLogSection({
	state,
	disabled,
	onLog,
	stacked = false,
}: {
	state: SimpleState;
	disabled: boolean;
	onLog: (worn: boolean) => void;
	stacked?: boolean;
}) {
	return (
		<Column spacing={8} modifiers={fullWidth} style={{ paddingVertical: 4 }}>
			<SemanticText role="headline" heading>
				Did you wear lenses today?
			</SemanticText>
			<DailyChoice
				worn={state.daily.worn}
				disabled={disabled}
				onLog={onLog}
				stacked={stacked}
			/>
			<SemanticText role="callout" tone="secondary">
				{dailyAcknowledgement(state.daily.worn)}
			</SemanticText>
		</Column>
	);
}

/** FieldGroup is the only scroller. NativeTabs owns the bottom safe area. */
export default function HomeContent({
	state,
	disabled,
	onLog,
	onReplace,
	onSettings,
	onAdd,
}: HomeContentProps) {
	const theme = usePresentationTheme();
	const paletteEpoch = usePresentationEpoch();
	const scheme = useColorScheme();
	const { width, fontScale } = useWindowDimensions();
	const stacked = width / Math.max(1, fontScale) < 360;
	return (
		<Host
			key={paletteEpoch}
			style={{ flex: 1, width: "100%" }}
			colorScheme={scheme}
			seedColor={Platform.OS === "android" ? undefined : theme.primary}
		>
			<FieldGroup style={{ backgroundColor: theme.background }}>
				<FieldGroup.Section>
					<DailyLogSection
						state={state}
						disabled={disabled}
						onLog={onLog}
						stacked={stacked}
					/>
				</FieldGroup.Section>
				<FieldGroup.Section title="Lenses">
					{state.eyes.map((settings) => (
						<EyeCard
							key={settings.eye}
							settings={settings}
							disabled={disabled}
							onReplace={onReplace}
							stacked={stacked}
						/>
					))}
					{state.eyes.some(
						(eye) =>
							eye.replacementDays === null ||
							(!eye.openedOn && eye.spareCount < 1),
					) && (
						<Button
							label="Lens setup"
							variant="text"
							modifiers={touchTarget}
							onPress={onSettings}
						/>
					)}
					<FieldGroup.SectionFooter>
						<SemanticText role="caption" tone="secondary">
							Calendar deadlines do not change when you record No.
						</SemanticText>
					</FieldGroup.SectionFooter>
				</FieldGroup.Section>
				<FieldGroup.Section>
					<Button
						label="Add spares"
						variant="text"
						disabled={disabled}
						modifiers={touchTarget}
						onPress={() => !disabled && onAdd()}
					/>
				</FieldGroup.Section>
			</FieldGroup>
		</Host>
	);
}
