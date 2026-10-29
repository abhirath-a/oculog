// biome-ignore-all lint/a11y/useValidAriaRole: Native typography roles, not DOM ARIA.
import { Button, Column, Host, Icon, Row, ScrollView, Text } from "@expo/ui";
import {
	accessibilityAddTraits,
	buttonStyle,
	controlSize,
	fixedSize,
	font,
	frame,
	multilineTextAlignment,
	scrollDismissesKeyboard,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { useState } from "react";
import { View } from "react-native";
import { TodayText } from "../home/today-design";
import { ScreenFrame } from "../presentation/screen-frame";
import { usePresentationTheme } from "../presentation/theme";

export type OnboardingStage = "welcome" | "setup" | "ready";

/** One measured Host, one native scroll owner, and a wrapping native footer.
 * The footer is a sibling of the scroller, never a toolbar or another Host.
 */
export function OnboardingPage({
	children,
	footer,
	insetMode = "standalone",
}: {
	children: ReactNode;
	footer: ReactNode;
	/** Account editor keeps its native stack header; onboarding owns its insets. */
	insetMode?: "stack" | "standalone";
}) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	const theme = usePresentationTheme();
	return (
		<ScreenFrame title="" insetMode={insetMode} scrollOwner="content">
			<View
				style={{ flex: 1, minWidth: 0, minHeight: 0, width: "100%" }}
				onLayout={({ nativeEvent: { layout } }) => {
					if (
						Number.isFinite(layout.width) &&
						Number.isFinite(layout.height) &&
						layout.width > 0 &&
						layout.height > 0
					)
						setSize((previous) =>
							previous?.width === layout.width &&
							previous.height === layout.height
								? previous
								: { width: layout.width, height: layout.height },
						);
				}}
			>
				{size && (
					<Host
						seedColor={theme.primary}
						style={{ width: size.width, height: size.height }}
					>
						<Column
							spacing={0}
							style={{
								width: "100%",
								height: "100%",
								backgroundColor: theme.background,
							}}
						>
							<ScrollView
								modifiers={[
									frame({ maxHeight: Infinity }),
									scrollDismissesKeyboard("interactively"),
								]}
								style={{ width: "100%" }}
							>
								<Column
									spacing={28}
									style={{
										width: "100%",
										paddingHorizontal: 24,
										paddingTop: 24,
										paddingBottom: 28,
									}}
								>
									{children}
								</Column>
							</ScrollView>
							<Column
								spacing={8}
								style={{
									width: "100%",
									paddingHorizontal: 24,
									paddingTop: 12,
									paddingBottom: 12,
								}}
							>
								{footer}
							</Column>
						</Column>
					</Host>
				)}
			</View>
		</ScreenFrame>
	);
}

export function OnboardingAction({
	label,
	primary = false,
	disabled = false,
	onPress,
}: {
	label: string;
	primary?: boolean;
	disabled?: boolean;
	onPress(): void;
}) {
	const theme = usePresentationTheme();
	return (
		<Button
			variant={primary ? "filled" : "text"}
			disabled={disabled}
			onPress={() => {
				if (!disabled) onPress();
			}}
			modifiers={[
				buttonStyle(primary ? "glassProminent" : "plain"),
				controlSize("large"),
				tint(theme.primary),
			]}
		>
			<Text
				modifiers={[
					font({ textStyle: primary ? "headline" : "body" }),
					fixedSize({ horizontal: false, vertical: true }),
					multilineTextAlignment("center"),
					frame({ maxWidth: Infinity, minHeight: 44 }),
				]}
			>
				{label}
			</Text>
		</Button>
	);
}

export function OnboardingHeading({
	step,
	title,
	detail,
	compact = false,
}: {
	step?: string;
	title: string;
	detail: string;
	compact?: boolean;
}) {
	return (
		<Column spacing={12} style={{ width: "100%" }}>
			<TodayText role="caption" tone="secondary">
				{step ? `Oculog · ${step}` : "Oculog"}
			</TodayText>
			<Text
				modifiers={[
					font({
						textStyle: compact ? "title2" : "largeTitle",
						weight: "bold",
					}),
					fixedSize({ horizontal: false, vertical: true }),
					frame({ maxWidth: Infinity, alignment: "leading" }),
					accessibilityAddTraits(["isHeader"]),
				]}
			>
				{title}
			</Text>
			<TodayText tone="secondary">{detail}</TodayText>
		</Column>
	);
}

export function OnboardingSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	const theme = usePresentationTheme();
	return (
		<Column spacing={12} style={{ width: "100%" }}>
			<TodayText role="section">{title}</TodayText>
			<Column
				spacing={16}
				style={{
					width: "100%",
					padding: 16,
					borderRadius: 20,
					backgroundColor: theme.surface,
				}}
			>
				{children}
			</Column>
		</Column>
	);
}

export function WelcomeContent() {
	const theme = usePresentationTheme();
	return (
		<>
			<OnboardingHeading
				step="Step 1 of 2"
				title="Know when your lenses are due."
				detail="See your replacement dates and keep a simple daily wear log."
			/>
			<Column spacing={24} style={{ width: "100%" }}>
				<Row spacing={16} style={{ width: "100%" }}>
					<Icon name="calendar" size={26} color={theme.primary} />
					<Column
						spacing={6}
						modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
					>
						<TodayText role="headline">
							Track each eye’s replacement date
						</TodayText>
						<TodayText tone="secondary">
							Use the replacement interval prescribed by your eye care
							professional—not an app recommendation.
						</TodayText>
					</Column>
				</Row>
				<Row spacing={16} style={{ width: "100%" }}>
					<Icon name="checkmark.circle" size={26} color={theme.primary} />
					<Column
						spacing={6}
						modifiers={[frame({ maxWidth: Infinity, alignment: "leading" })]}
					>
						<TodayText role="headline">Log a day in one tap</TodayText>
						<TodayText tone="secondary">
							Record whether you wore your lenses today. It’s a daily yes/no
							log, not a tracker of hours worn.
						</TodayText>
					</Column>
				</Row>
			</Column>
			<TodayText tone="secondary">
				Keep prescription details and choose reminders later in Account.
				Prescription details stay on this iPhone.
			</TodayText>
		</>
	);
}

export function ReadyContent() {
	return (
		<>
			<OnboardingHeading
				title="Ready for your daily check-in."
				detail="Your lens schedule is saved. Here’s where to go next."
			/>
			<Column spacing={20} style={{ width: "100%" }}>
				<Column spacing={6}>
					<TodayText role="headline">Today</TodayText>
					<TodayText>
						Log whether you wore your lenses and see their replacement dates.
						Add an opened date when you start a lens to see when it’s due.
					</TodayText>
				</Column>
				<Column spacing={6}>
					<TodayText role="headline">Account</TodayText>
					<TodayText>
						Change your lens setup, keep a local prescription, and choose
						notification preferences. Reminders are optional—you choose whether
						to enable them.
					</TodayText>
				</Column>
				<Column spacing={6}>
					<TodayText role="headline">Learn and Advice · optional</TodayText>
					<TodayText tone="secondary">
						Explore these tools whenever you want. They aren’t part of your
						daily check-in.
					</TodayText>
				</Column>
			</Column>
		</>
	);
}
