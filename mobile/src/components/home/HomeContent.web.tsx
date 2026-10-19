// biome-ignore-all lint/a11y/useValidAriaRole: PresentationText role is a typography token.
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { PresentationText, usePresentationTheme } from "../presentation";
import { webTypography } from "../presentation/web-typography";
import { DailyChoice } from "./daily-choice";
import {
	dailyAcknowledgement,
	eyeSummary,
	type HomeContentProps,
} from "./model";

export default function HomeContent({
	state,
	disabled,
	onLog,
	onReplace,
	onSettings,
	onAdd,
}: HomeContentProps) {
	const theme = usePresentationTheme();
	const { width, fontScale } = useWindowDimensions();
	const stacked = width / Math.max(1, fontScale) < 480;
	function action(
		label: string,
		onPress: () => void,
		blocked: boolean,
		outlined = false,
	) {
		return (
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ disabled: blocked }}
				disabled={blocked}
				onPress={() => !blocked && onPress()}
				style={({ pressed }) => ({
					fontFamily: webTypography.fontFamily,
					minHeight: 48,
					paddingHorizontal: 12,
					paddingVertical: 12,
					justifyContent: "center",
					alignSelf: "flex-start",
					borderRadius: 8,
					borderWidth: outlined ? 1 : 0,
					borderColor: theme.divider,
					backgroundColor: pressed ? theme.surface : "transparent",
					opacity: blocked ? 0.5 : 1,
				})}
			>
				<PresentationText tone="primary">{label}</PresentationText>
			</Pressable>
		);
	}
	return (
		<ScrollView
			style={{ flex: 1 }}
			keyboardShouldPersistTaps="handled"
			contentContainerStyle={{
				paddingHorizontal: 20,
				paddingTop: 12,
				paddingBottom: 32,
				width: "100%",
				maxWidth: 800,
				alignSelf: "center",
				gap: 28,
			}}
		>
			<View style={{ gap: 12 }}>
				<PresentationText role="headline" heading>
					Did you wear lenses today?
				</PresentationText>
				<DailyChoice
					worn={state.daily.worn}
					disabled={disabled}
					onLog={onLog}
				/>
				<View accessibilityLiveRegion="polite">
					<PresentationText role="callout" tone="secondary">
						{dailyAcknowledgement(state.daily.worn)}
					</PresentationText>
				</View>
			</View>
			<View>
				<PresentationText role="headline" heading>
					Lenses
				</PresentationText>
				{state.eyes.map((eye) => {
					const summary = eyeSummary(eye);
					return (
						<View
							key={eye.eye}
							style={{
								flexDirection: stacked ? "column" : "row",
								alignItems: "flex-start",
								gap: 12,
								borderBottomWidth: 1,
								borderColor: theme.divider,
								paddingVertical: 16,
							}}
						>
							<View
								style={{ flex: stacked ? undefined : 1, minWidth: 0, gap: 4 }}
							>
								<PresentationText role="headline" heading>
									{summary.name}
								</PresentationText>
								<PresentationText
									tone={
										eye.daysRemaining !== null && eye.daysRemaining <= 0
											? "danger"
											: "primary"
									}
								>
									{summary.countdown}
								</PresentationText>
								{summary.due && (
									<PresentationText role="callout" tone="secondary">
										{summary.due}
									</PresentationText>
								)}
								{summary.configured && eye.spareCount < 1 && (
									<PresentationText
										role="caption"
										tone="secondary"
									>{`Add spares to ${eye.openedOn ? "replace" : "start"} this lens.`}</PresentationText>
								)}
							</View>
							<View style={{ gap: 4, minWidth: 0, maxWidth: "100%" }}>
								<PresentationText
									role="callout"
									tone="secondary"
								>{`Spares: ${eye.spareCount}`}</PresentationText>
								{summary.configured && eye.spareCount > 0
									? action(
											summary.actionLabel,
											() => onReplace(eye.eye),
											disabled,
											true,
										)
									: null}
							</View>
						</View>
					);
				})}
				{state.eyes.some(
					(eye) =>
						eye.replacementDays === null ||
						(!eye.openedOn && eye.spareCount < 1),
				) && action("Lens setup", onSettings, false)}
				<View style={{ paddingTop: 8 }}>
					{action("Add spares", onAdd, disabled)}
				</View>
				<PresentationText role="caption" tone="secondary">
					Calendar deadlines do not change when you record No.
				</PresentationText>
			</View>
		</ScrollView>
	);
}
