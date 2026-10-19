import { Button } from "@expo/ui";
import {
	Column,
	Text as ComposeText,
	Host,
	Row,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, weight } from "@expo/ui/jetpack-compose/modifiers";
import { useColorScheme, useWindowDimensions } from "react-native";
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
import { MaterialSection } from "../settings/material-section.android";
import NativeFields from "../settings/native-fields";
import { DailyChoice } from "./daily-choice";
import {
	dailyAcknowledgement,
	eyeSummary,
	type HomeContentProps,
} from "./model";

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
	const theme = usePresentationTheme();
	const summary = eyeSummary(settings);
	const canReplace = summary.configured && settings.spareCount > 0;
	const Layout = stacked ? Column : Row;
	return (
		<Column verticalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth()]}>
			{/* Native headline typography; measure in Compose, without the asynchronous RN heading bridge.
			    SDK 57 Text exposes accessible text but no heading semantic modifier. */}
			<ComposeText
				style={{ typography: "titleMedium" }}
				color={theme.text}
				modifiers={[fillMaxWidth()]}
			>
				{summary.name}
			</ComposeText>
			<Layout modifiers={[fillMaxWidth()]}>
				<Column
					modifiers={stacked ? [fillMaxWidth()] : [weight(1)]}
					verticalArrangement={{ spacedBy: 4 }}
				>
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
						/* biome-ignore lint/a11y/useValidAriaRole: SemanticTextProps.role maps to Compose typography, not a DOM role. */
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
				<Column verticalArrangement={{ spacedBy: 4 }}>
					{/* biome-ignore lint/a11y/useValidAriaRole: SemanticTextProps.role maps to Compose typography, not a DOM role. */}
					<SemanticText
						role="callout"
						tone="secondary"
					>{`Spares: ${settings.spareCount}`}</SemanticText>
					{canReplace ? (
						<Button
							label={summary.actionLabel}
							variant="outlined"
							disabled={disabled}
							onPress={() => !disabled && onReplace(settings.eye)}
						/>
					) : null}
				</Column>
			</Layout>
		</Column>
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
		<Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth()]}>
			{/* biome-ignore lint/a11y/useValidAriaRole: SemanticTextProps.role selects native typography; heading sets accessibility separately. */}
			<SemanticText role="headline" heading>
				Did you wear lenses today?
			</SemanticText>
			<DailyChoice
				worn={state.daily.worn}
				disabled={disabled}
				onLog={onLog}
				stacked={stacked}
			/>
			{/* biome-ignore lint/a11y/useValidAriaRole: SemanticTextProps.role maps to Compose typography, not a DOM role. */}
			<SemanticText role="callout" tone="secondary">
				{dailyAcknowledgement(state.daily.worn)}
			</SemanticText>
		</Column>
	);
}
export default function HomeContent({
	state,
	disabled,
	onLog,
	onReplace,
	onSettings,
	onAdd,
}: HomeContentProps) {
	const epoch = usePresentationEpoch();
	const scheme = useColorScheme();
	const { width, fontScale } = useWindowDimensions();
	const stacked = width / Math.max(1, fontScale) < 360;
	return (
		<Host key={epoch} style={{ flex: 1, width: "100%" }} colorScheme={scheme}>
			<NativeFields>
				<MaterialSection>
					<DailyLogSection
						state={state}
						disabled={disabled}
						onLog={onLog}
						stacked={stacked}
					/>
				</MaterialSection>
				<MaterialSection
					title="Lenses"
					footer={
						<SemanticText role="caption" tone="secondary">
							Calendar deadlines do not change when you record No.
						</SemanticText>
					}
				>
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
						<Button label="Lens setup" variant="text" onPress={onSettings} />
					)}
				</MaterialSection>
				<Button
					label="Add spares"
					variant="text"
					disabled={disabled}
					onPress={() => !disabled && onAdd()}
				/>
			</NativeFields>
		</Host>
	);
}
