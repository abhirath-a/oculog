import { Button, Host } from "@expo/ui/swift-ui";
import {
	buttonBorderShape,
	buttonStyle,
	controlSize,
	disabled as nativeDisabled,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	ActivityIndicator,
	Linking,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	useColorScheme,
	View,
} from "react-native";
import { request, sessionStore } from "../../lib/api";
import {
	type LearningQuestion,
	type LearningReference,
	learningAPI,
	safeLearningURL,
} from "../../lib/learning-api";
import { createLearningController } from "../../lib/learning-controller";
import { ScreenFrame } from "../presentation/screen-frame";
import { PresentationText } from "../presentation/text";
import { createHubController } from "./hub-controller";
import {
	hubSelection,
	initialPracticeSelection,
	lifetimeSummary,
	recommendationReasons,
	topicRows,
} from "./hub-model";
import { TopicMap } from "./topic-map";

// This screen's cards and controls are React Native, not SwiftUI/Compose children.
function PageText({
	children,
	heading,
	tone,
}: {
	children: string;
	heading?: boolean;
	tone?: "danger" | "secondary" | "primary";
}) {
	return (
		<PresentationText
			heading={heading}
			role={heading ? "headline" : "body"}
			tone={tone}
		>
			{children}
		</PresentationText>
	);
}

function identity() {
	return sessionStore.isValid && sessionStore.account
		? `${sessionStore.account.id}:${sessionStore.token}`
		: null;
}

type NativeButtonProps = {
	label: string;
	icon?: string;
	onPress: () => void;
	disabled?: boolean;
	primary?: boolean;
};

// React Native controls stay in the RN tree. TopicMap owns the single native
// boundary needed by the existing Liquid Glass / Compose topic buttons.
function NativeButton({
	label,
	icon,
	onPress,
	disabled,
	primary,
}: NativeButtonProps) {
	const dark = useColorScheme() === "dark";
	return (
		// <Pressable
		//   accessibilityRole="button"
		//   accessibilityLabel={label}
		//   accessibilityState={{ disabled: !!disabled }}
		//   disabled={disabled}
		//   onPress={onPress}
		//   style={[
		//     styles.rnButton,
		//     {
		//       backgroundColor: primary
		//         ? dark
		//           ? "#A4E2CE"
		//           : "#1D655C"
		//         : dark
		//           ? "#1C1C1E"
		//           : "#F1F6F3",
		//       opacity: disabled ? 0.5 : 1,
		//     },
		//   ]}
		// >
		//   <Text
		//     style={{
		//       color: primary
		//         ? dark
		//           ? "#102E2B"
		//           : "#FFFFFF"
		//         : dark
		//           ? "#EDF3F0"
		//           : "#1D655C",
		//       fontWeight: "600",
		//       fontSize: 16,
		//     }}
		//   >
		//     {label}
		//   </Text>
		// </Pressable>
		<Host matchContents>
			<Button
				label={label}
				/* systemImage={icon || undefined} */
				onPress={onPress}
				modifiers={[
					buttonStyle(primary ? "glassProminent" : "glass"),
					// buttonBorderShape("capsule"),
					// controlSize(""),
					tint("#1D655C"),
					nativeDisabled(!!disabled),
				]}
			/>
		</Host>
	);
}

function NativeLink({
	label,
	icon,
	onPress,
}: {
	label: string;
	icon: string;
	onPress: () => void;
}) {
	const dark = useColorScheme() === "dark";
	return (
		<Pressable
			accessibilityRole="button"
			onPress={onPress}
			style={styles.rnLink}
		>
			<Text
				style={{ color: dark ? "#FFFFFF" : "#000000", flex: 1, fontSize: 16 }}
			>
				{label}
			</Text>
			<Text style={{ color: "#8E8E93", fontSize: 22 }}>›</Text>
		</Pressable>
	);
}

function PracticeButton({
	label,
	onPress,
	blocked = false,
	secondary = false,
	destructive = false,
	symbol,
}: {
	label: string;
	onPress: () => void;
	blocked?: boolean;
	secondary?: boolean;
	destructive?: boolean;
	symbol?: string;
}) {
	const dark = useColorScheme() === "dark";
	const background = destructive
		? secondary
			? dark
				? "#3F2429"
				: "#FBECE9"
			: "#A32C22"
		: secondary
			? dark
				? "#1C1C1E"
				: "#F1F6F3"
			: dark
				? "#A4E2CE"
				: "#1D655C";
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: blocked }}
			disabled={blocked}
			onPress={onPress}
			style={[
				styles.rnButton,
				{ backgroundColor: background, opacity: blocked ? 0.5 : 1 },
			]}
		>
			<Text
				style={{
					fontSize: 16,
					fontWeight: "600",
					color: !secondary
						? destructive
							? "#FFFFFF"
							: dark
								? "#102E2B"
								: "#FFFFFF"
						: destructive
							? dark
								? "#FFB3A5"
								: "#A32C22"
							: dark
								? "#EDF3F0"
								: "#1D655C",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

function SmallPracticeButton({
	label,
	onPress,
	symbol,
}: {
	label: string;
	onPress: () => void;
	symbol?: string;
}) {
	const dark = useColorScheme() === "dark";
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={styles.rnSmallButton}
		>
			<Text
				style={{
					color: dark ? "#A4E2CE" : "#1D655C",
					fontWeight: "600",
					fontSize: 15,
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

function SourceEvidence({
	reference,
	dark,
}: {
	reference: LearningReference;
	dark: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<View style={[s.source, { backgroundColor: dark ? "#1B2422" : "#F1F6F3" }]}>
			<SmallPracticeButton
				label={expanded ? "Hide source evidence" : "View source evidence"}
				symbol="doc.text.magnifyingglass"
				onPress={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<View style={{ gap: 10, paddingTop: 8 }}>
					<Text
						style={[s.body, { color: dark ? "#EDF3F0" : "#192720" }]}
					>{`“${reference.quote}”`}</Text>
					<Text style={s.subdued}>{reference.url}</Text>
					<PracticeButton
						label="Open official source"
						secondary
						symbol="arrow.up.right"
						onPress={() => {
							if (!safeLearningURL(reference.url)) {
								setError("Unsupported source URL.");
								return;
							}
							void Linking.openURL(reference.url).catch(() =>
								setError("Could not open the source."),
							);
						}}
					/>
					{!!error && <Text style={s.error}>{error}</Text>}
				</View>
			)}
		</View>
	);
}

function Option({
	text,
	checked,
	blocked,
	onPress,
	dark,
}: {
	text: string;
	checked: boolean;
	blocked: boolean;
	onPress: () => void;
	dark: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityState={{ checked, disabled: blocked }}
			disabled={blocked}
			onPress={onPress}
			style={[
				s.option,
				{
					opacity: blocked ? 0.65 : 1,
					borderColor: checked
						? dark
							? "#A4E2CE"
							: "#1D655C"
						: dark
							? "#3B4944"
							: "#DCE4DF",
					backgroundColor: checked
						? dark
							? "#1B2422"
							: "#F1F6F3"
						: dark
							? "#1C1C1E"
							: "#FFFFFF",
					minHeight: 64,
					padding: 16,
					flexDirection: "row",
					alignItems: "center",
					gap: 12,
				},
			]}
		>
			<Text
				style={{
					fontSize: 23,
					color: checked
						? dark
							? "#A4E2CE"
							: "#1D655C"
						: dark
							? "#AFBDB7"
							: "#58675F",
				}}
			>
				{checked ? "◉" : "◯"}
			</Text>
			<Text
				style={{
					flex: 1,
					fontSize: 15,
					lineHeight: 22,
					color: dark ? "#EDF3F0" : "#192720",
				}}
			>
				{text}
			</Text>
		</Pressable>
	);
}

export default function HubScreen({
	onBrowse,
	onProducts,
}: {
	onPractice?: (lesson: string, question?: string) => void;
	onBrowse(): void;
	onProducts(): void;
}) {
	const dark = useColorScheme() === "dark";
	const theme = dark
		? {
				surface: "#1C1C1E",
				background: "#000000",
				border: "#3B4944",
				faint: "#AEAEB2",
				text: "#FFFFFF",
				accentWash: "#1B2422",
			}
		: {
				surface: "#FFFFFF",
				background: "#F2F2F7",
				border: "#DCE4DF",
				faint: "#636366",
				text: "#000000",
				accentWash: "#F1F6F3",
			};

	const controller = useMemo(
		() => createHubController(learningAPI(request).status, identity),
		[],
	);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	const [aboutExpanded, setAboutExpanded] = useState(false);
	const [practiceTarget, setPracticeTarget] = useState<{
		lesson: string;
		question?: string;
	} | null>(null);
	const [selection, setSelection] = useState<{
		owner: string | null;
		lessonID: string;
	} | null>(null);

	useEffect(() => {
		controller.activate();
		const unsubscribe = sessionStore.onChange(() => {
			if (controller.syncIdentity()) {
				setSelection(null);
				setPracticeTarget(null);
				void controller.load();
			}
		});
		return () => {
			unsubscribe();
			controller.dispose();
		};
	}, [controller]);

	useFocusEffect(
		useCallback(() => {
			controller.activate();
			void controller.load();
		}, [controller]),
	);

	const status = state.status;
	const selected = status
		? hubSelection(
				status,
				selection?.owner === identity() ? selection.lessonID : null,
			)
		: undefined;
	const recommended = status?.recommended_question;
	const matchedRecommendation =
		selected && recommended?.lesson_id === selected.id ? recommended : null;
	const rows = topicRows(status?.lessons ?? []);

	if (practiceTarget) {
		return (
			<LearningPane
				key={`${practiceTarget.lesson}:${practiceTarget.question ?? "lesson"}`}
				initialLessonID={practiceTarget.lesson}
				initialQuestionID={practiceTarget.question}
				onBack={() => {
					setPracticeTarget(null);
					void controller.load();
				}}
			/>
		);
	}

	return (
		<ScreenFrame title="Learn" insetMode="tabs" scrollOwner="frame">
			<View style={styles.page}>
				<View style={styles.intro}>
					<PageText tone="secondary">LENS CARE EDUCATION</PageText>
					<PageText heading>Build better habits.</PageText>
					<PageText tone="secondary">
						Explore essential topics, then test what you've learned with short
						practice questions.
					</PageText>
				</View>

				{state.busy && (
					<View style={styles.inlineStatus}>
						<ActivityIndicator
							size="small"
							color={dark ? "#A4E2CE" : "#1D655C"}
						/>
						<PageText tone="secondary">
							{status ? "Refreshing your progress…" : "Loading your lessons…"}
						</PageText>
					</View>
				)}

				{!!state.error && (
					<View
						style={[
							styles.card,
							{ backgroundColor: theme.surface, borderColor: theme.border },
						]}
					>
						<PageText tone="danger">
							{status
								? `Saved practice may be outdated. ${state.error}`
								: state.error}
						</PageText>
						<NativeButton
							label="Try again"
							icon="arrow.clockwise"
							disabled={state.busy}
							onPress={() => void controller.load()}
						/>
					</View>
				)}

				{status && (
					<>
						<View
							style={[
								styles.card,
								styles.mapCard,
								{ backgroundColor: theme.surface, borderColor: theme.border },
							]}
						>
							<View style={styles.cardHeading}>
								<View style={styles.headingCopy}>
									<PageText heading>Your learning path</PageText>
									<PageText tone="secondary">Select a topic to begin</PageText>
								</View>
								<View
									style={[
										styles.countPill,
										{ backgroundColor: theme.accentWash },
									]}
								>
									<PageText>{`${status.lessons.length} topics`}</PageText>
								</View>
							</View>

							{/* Preserve the custom TopicNode graphics and original zigzag ordering.
                  A horizontal scroll view prevents large rows being clipped on iPhones. */}
							<ScrollView
								horizontal
								showsHorizontalScrollIndicator={false}
								contentContainerStyle={styles.mapScroll}
							>
								<TopicMap
									rows={rows}
									selectedID={selected?.id}
									onSelect={(lessonID) =>
										setSelection({ owner: identity(), lessonID })
									}
								/>
							</ScrollView>

							{selected && (
								<View
									style={[
										styles.selected,
										{ backgroundColor: theme.accentWash },
									]}
								>
									<PageText tone="secondary">SELECTED LESSON</PageText>
									<PageText heading>{selected.title}</PageText>
									{!!matchedRecommendation && (
										<PageText tone="secondary">
											{recommendationReasons[matchedRecommendation.reason]}
										</PageText>
									)}
									<NativeButton
										label="Start practice"
										icon="arrow.right"
										primary
										onPress={() =>
											setPracticeTarget({
												lesson: selected.id,
												question: matchedRecommendation?.id,
											})
										}
									/>
								</View>
							)}
						</View>

						{recommended && !matchedRecommendation && (
							<View
								style={[
									styles.card,
									{ backgroundColor: theme.surface, borderColor: theme.border },
								]}
							>
								<PageText heading>Recommended for you</PageText>
								<PageText tone="secondary">
									{recommendationReasons[recommended.reason]}
								</PageText>
								<NativeButton
									label="Continue practice"
									icon="play.fill"
									primary
									onPress={() =>
										setPracticeTarget({
											lesson: recommended.lesson_id,
											question: recommended.id,
										})
									}
								/>
							</View>
						)}

						<View
							style={[
								styles.card,
								{ backgroundColor: theme.surface, borderColor: theme.border },
							]}
						>
							<PageText heading>Your progress</PageText>
							<PageText>{lifetimeSummary(status)}</PageText>
						</View>
					</>
				)}

				<View
					style={[
						styles.card,
						{ backgroundColor: theme.surface, borderColor: theme.border },
					]}
				>
					<PageText heading>Explore</PageText>
					<NativeLink
						label="All lessons"
						icon="books.vertical"
						onPress={onBrowse}
					/>
					<View style={[styles.separator, { backgroundColor: theme.border }]} />
					<NativeLink
						label="Product catalogue"
						icon="shippingbox"
						onPress={onProducts}
					/>
					<PageText tone="secondary">
						The catalogue contains mock examples, not recommendations.
					</PageText>
				</View>

				<View style={styles.footnote}>
					<PageText tone="secondary">
						General education only—not medical advice.
					</PageText>
					<NativeButton
						label={
							aboutExpanded
								? "Hide education & privacy details"
								: "Education & privacy details"
						}
						icon={aboutExpanded ? "chevron.up" : "info.circle"}
						onPress={() => setAboutExpanded(!aboutExpanded)}
					/>
					{aboutExpanded && (
						<View
							style={[
								styles.card,
								{ backgroundColor: theme.surface, borderColor: theme.border },
							]}
						>
							<PageText tone="secondary">
								Source-grounded, not clinician-validated; no proven learning or
								health outcome. No external AI processing. Only quiz choices and
								lifetime progress are saved to your account, not notes or
								photos. Practice does not change your lens-care schedule.
							</PageText>
						</View>
					)}
				</View>
			</View>
		</ScreenFrame>
	);
}

export function LearningPane({
	initialLessonID,
	initialQuestionID,
	onBack,
}: {
	initialLessonID?: string;
	initialQuestionID?: string;
	onBack: () => void;
}) {
	const dark = useColorScheme() === "dark";
	const bg = dark ? "#000000" : "#F2F2F7";
	const fg = dark ? "#FFFFFF" : "#000000";
	const controller = useMemo(
		() =>
			createLearningController(
				learningAPI(request),
				() =>
					sessionStore.isValid && sessionStore.account
						? `${sessionStore.account.id}:${sessionStore.token}`
						: null,
				randomUUID,
			),
		[],
	);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	const [lessonID, setLessonID] = useState<string | null>(null);
	const [question, setQuestion] = useState<LearningQuestion | null>(null);
	const [selectedOption, setSelectedOption] = useState<string | null>(null);
	const [showSettings, setShowSettings] = useState(false);
	const [showAbout, setShowAbout] = useState(false);
	const [confirmReset, setConfirmReset] = useState(false);
	const initialApplied = useRef(false);

	useEffect(() => {
		controller.activate();
		const unsubscribe = sessionStore.onChange(() => {
			controller.syncIdentity();
			setLessonID(null);
			setQuestion(null);
			setSelectedOption(null);
			setConfirmReset(false);
			initialApplied.current = false;
			void controller.load();
		});
		void controller.load();
		return () => {
			unsubscribe();
			controller.dispose();
		};
	}, [controller]);

	const status = state.status;
	useEffect(() => {
		if (!status || initialApplied.current) return;
		initialApplied.current = true;
		const selection = initialPracticeSelection(
			status,
			initialLessonID,
			initialQuestionID,
		);
		setLessonID(selection.lesson?.id ?? null);
		setQuestion(selection.question);
		setSelectedOption(null);
	}, [status, initialLessonID, initialQuestionID]);

	const lesson = status?.lessons.find((item) => item.id === lessonID);
	const questions = lesson?.questions ?? [];
	const currentIndex = question
		? questions.findIndex((item) => item.id === question.id)
		: -1;
	const nextQuestion =
		currentIndex >= 0 ? questions[currentIndex + 1] : undefined;
	const progress = Object.values(status?.progress ?? {});
	const attempts = progress.reduce((sum, p) => sum + p.attempts, 0);
	const correct = progress.reduce((sum, p) => sum + p.correct, 0);
	const locked = state.busy || !!state.pending || state.resetUncertain;
	const readQuestion = (item: LearningQuestion) => {
		controller.clearFeedback();
		setLessonID(item.lesson_id);
		setQuestion(item);
		setSelectedOption(null);
	};
	const returnToLesson = () => {
		controller.clearFeedback();
		setQuestion(null);
		setSelectedOption(null);
	};
	return (
		<ScreenFrame title="Learn" insetMode="tabs" scrollOwner="content">
			<View style={[s.screen, { backgroundColor: bg }]}>
				<ScrollView
					style={{ flex: 1 }}
					contentContainerStyle={s.content}
					showsVerticalScrollIndicator={false}
				>
					{state.busy && (
						<Text style={s.subdued}>Updating learning progress…</Text>
					)}
					{!!state.error && (
						<View style={s.errorCard}>
							<Text style={s.error}>{state.error}</Text>
						</View>
					)}
					{!!state.pending && !state.busy && (
						<PracticeButton
							label="Retry saving answer"
							secondary
							onPress={() => void controller.retry()}
						/>
					)}
					{(!status || state.resetUncertain) && !state.busy && (
						<PracticeButton
							label="Reload learning progress"
							secondary
							onPress={() => void controller.load()}
						/>
					)}
					{status && !state.resetUncertain && (
						<>
							{!lesson ? (
								<>
									<View style={s.hero}>
										<Text style={s.eyebrow}>YOUR LEARNING</Text>
										<Text style={[s.large, { color: fg }]}>
											A little practice goes a long way.
										</Text>
										<Text style={s.subdued}>
											Build confidence in safe contact lens habits, one question
											at a time.
										</Text>
									</View>
									<View
										style={[
											s.card,
											{ backgroundColor: dark ? "#1C1C1E" : "#FFFFFF" },
										]}
									>
										<Text style={s.eyebrow}>UP NEXT</Text>
										<Text style={[s.heading, { color: fg }]}>
											Continue learning
										</Text>
										{status.recommended_question ? (
											<>
												<Text style={[s.body, { color: fg }]}>
													{
														recommendationReasons[
															status.recommended_question.reason
														]
													}
												</Text>
												<PracticeButton
													label="Continue recommended practice"
													symbol="arrow.right"
													blocked={locked}
													onPress={() =>
														readQuestion(status.recommended_question!)
													}
												/>
											</>
										) : (
											<Text style={s.subdued}>No practice review is due.</Text>
										)}
									</View>
									<Text style={s.subdued}>
										Open a lesson from the learning hub to explore more topics.
									</Text>
								</>
							) : (
								<>
									<View style={s.topline}>
										<SmallPracticeButton
											label={question ? "Back to lesson" : "Learning hub"}
											symbol="chevron.left"
											onPress={() => (question ? returnToLesson() : onBack())}
										/>
									</View>
									<Text style={s.eyebrow}>
										{question
											? `QUESTION ${Math.max(currentIndex + 1, 1)} OF ${questions.length}`
											: "LESSON"}
									</Text>
									<Text style={[s.large, { color: fg }]}>{lesson.title}</Text>
									{question && (
										<View
											style={[
												s.track,
												{ backgroundColor: dark ? "#3B4944" : "#DCE4DF" },
											]}
										>
											<View
												style={[
													s.trackFill,
													{
														width: `${Math.max(0, Math.min(100, ((currentIndex + 1) / Math.max(questions.length, 1)) * 100))}%`,
														backgroundColor: dark ? "#A4E2CE" : "#1D655C",
													},
												]}
											/>
										</View>
									)}
									{!question ? (
										<>
											<View
												style={[
													s.card,
													{ backgroundColor: dark ? "#1C1C1E" : "#FFFFFF" },
												]}
											>
												<Text style={[s.body, { color: fg }]}>
													{lesson.text}
												</Text>
												<SourceEvidence
													key={lesson.id}
													reference={lesson.reference}
													dark={dark}
												/>
											</View>
											<View style={s.practiceHeader}>
												<Text style={[s.heading, { color: fg }]}>
													Ready to practice?
												</Text>
												<Text style={s.subdued}>
													{questions.length} questions to check what you
													learned.
												</Text>
											</View>
											{questions.length ? (
												<PracticeButton
													label="Start practice"
													symbol="arrow.right"
													blocked={locked}
													onPress={() => {
														const first = questions[0];
														if (first) readQuestion(first);
													}}
												/>
											) : (
												<Text style={s.subdued}>
													No practice questions in this lesson.
												</Text>
											)}
										</>
									) : (
										<>
											<Text style={[s.question, { color: fg }]}>
												{question.prompt}
											</Text>
											<Text style={s.subdued}>
												Choose the statement supported by the lesson. Other
												options are not care instructions.
											</Text>
											<View style={s.options}>
												{question.options.map((option) => (
													<Option
														key={option.id}
														text={option.text}
														checked={selectedOption === option.id}
														blocked={locked || !!state.feedback}
														dark={dark}
														onPress={() => setSelectedOption(option.id)}
													/>
												))}
											</View>
											{!state.feedback ? (
												<PracticeButton
													label={state.busy ? "Saving answer…" : "Check answer"}
													symbol="checkmark"
													blocked={locked || selectedOption === null}
													onPress={() => {
														if (selectedOption !== null)
															void controller.answer(
																question.id,
																selectedOption,
															);
													}}
												/>
											) : (
												<>
													<View
														style={[
															s.feedback,
															{ backgroundColor: dark ? "#1C1C1E" : "#FFFFFF" },
														]}
													>
														<Text style={[s.heading, { color: fg }]}>
															{state.feedback.correct
																? "✓ Correct"
																: "Not quite"}
														</Text>
														<Text style={[s.body, { color: fg }]}>
															{state.feedback.explanation}
														</Text>
														<SourceEvidence
															reference={state.feedback.reference}
															dark={dark}
														/>
													</View>
													<PracticeButton
														label={
															nextQuestion ? "Next question" : "Finish practice"
														}
														symbol="arrow.right"
														blocked={locked}
														onPress={() =>
															nextQuestion
																? readQuestion(nextQuestion)
																: returnToLesson()
														}
													/>
												</>
											)}
										</>
									)}
								</>
							)}
							<View style={s.footer}>
								<SmallPracticeButton
									label={
										showSettings
											? "Hide progress & settings"
											: "Progress & settings"
									}
									symbol="chart.bar.xaxis"
									onPress={() => setShowSettings((v) => !v)}
								/>
								{showSettings && (
									<View
										style={[
											s.card,
											{ backgroundColor: dark ? "#1C1C1E" : "#FFFFFF" },
										]}
									>
										<Text style={[s.heading, { color: fg }]}>
											Practice progress
										</Text>
										<Text style={[s.body, { color: fg }]}>
											{progress.length} questions tried
										</Text>
										<Text style={s.subdued}>
											{correct} correct answers across {attempts} saved
											attempts.
										</Text>
										<Text style={s.subdued}>
											Correct answers become eligible for review after seven
											days. Practice does not change your lens-care schedule,
											reminders, or stock.
										</Text>
										{!confirmReset ? (
											<PracticeButton
												label="Reset progress…"
												secondary
												destructive
												blocked={locked}
												onPress={() => setConfirmReset(true)}
											/>
										) : (
											<>
												<Text style={[s.body, { color: fg }]}>
													Delete saved attempts and progress? An unconfirmed
													answer will be abandoned. Old pending answers cannot
													restore progress after a confirmed reset.
												</Text>
												<PracticeButton
													label="Confirm reset"
													destructive
													blocked={locked}
													onPress={() => {
														setConfirmReset(false);
														setLessonID(null);
														setQuestion(null);
														setSelectedOption(null);
														void controller.reset();
													}}
												/>
												<PracticeButton
													label="Keep progress"
													secondary
													onPress={() => setConfirmReset(false)}
												/>
											</>
										)}
									</View>
								)}
								<SmallPracticeButton
									label={
										showAbout
											? "Hide content information"
											: "About this learning content"
									}
									symbol="info.circle"
									onPress={() => setShowAbout((v) => !v)}
								/>
								{showAbout && (
									<View
										style={[
											s.card,
											{ backgroundColor: dark ? "#1C1C1E" : "#FFFFFF" },
										]}
									>
										<Text style={s.subdued}>
											General education only, not medical advice. Content is
											source-grounded but not clinician-validated. No health or
											learning outcome is guaranteed.
										</Text>
										<Text style={s.subdued}>
											Recommendations use unanswered questions and previous
											mistakes, not AI or a health assessment. No external AI
											processing occurs.
										</Text>
										<Text style={s.subdued}>
											Only quiz choices and learning progress are saved to your
											account. No notes or photos are saved by this feature.
										</Text>
									</View>
								)}
							</View>
						</>
					)}
				</ScrollView>
			</View>
		</ScreenFrame>
	);
}

const styles = StyleSheet.create({
	page: { gap: 16, paddingBottom: 32 },
	intro: { gap: 8, paddingTop: 8, paddingBottom: 4 },
	card: {
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: 22,
		padding: 18,
		gap: 14,
	},
	mapCard: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 14 },
	cardHeading: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		paddingHorizontal: 6,
	},
	headingCopy: { flex: 1, gap: 4 },
	countPill: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
	mapScroll: {
		flexGrow: 1,
		justifyContent: "center",
		paddingHorizontal: 6,
		paddingVertical: 16,
	},
	path: { alignItems: "center", gap: 14, minWidth: 250 },
	pathRow: {
		flexDirection: "row",
		justifyContent: "center",
		alignItems: "center",
	},
	selected: { borderRadius: 17, gap: 10, padding: 16, marginTop: 6 },
	inlineStatus: { flexDirection: "row", alignItems: "center", gap: 10 },
	rnButton: {
		width: "100%",
		minHeight: 48,
		borderRadius: 12,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 14,
		paddingVertical: 12,
	},
	rnLink: {
		minHeight: 48,
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 10,
		gap: 12,
	},
	rnSmallButton: {
		minHeight: 44,
		alignSelf: "flex-start",
		justifyContent: "center",
		paddingHorizontal: 4,
	},

	separator: { height: StyleSheet.hairlineWidth },
	footnote: { gap: 10, paddingTop: 4 },
});

const s = StyleSheet.create({
	screen: { flex: 1 },
	nav: {
		minHeight: 69,
		paddingHorizontal: 22,
		paddingVertical: 11,
		borderBottomWidth: StyleSheet.hairlineWidth,
		flexDirection: "row",
		justifyContent: "space-between",
		alignItems: "center",
	},
	brand: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
	navCaption: { color: "#AEAEB2", fontSize: 12, marginTop: 1 },
	content: { padding: 22, paddingBottom: 62, gap: 16 },
	hero: { gap: 11, marginTop: 14, marginBottom: 12 },
	eyebrow: {
		color: "#1D655C",
		fontSize: 11,
		fontWeight: "800",
		letterSpacing: 1.25,
	},
	large: {
		fontSize: 29,
		fontWeight: "700",
		letterSpacing: -0.8,
		lineHeight: 35,
	},
	heading: { fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
	question: { fontSize: 23, fontWeight: "700", lineHeight: 31, marginTop: 7 },
	body: { fontSize: 16, lineHeight: 25 },
	subdued: { fontSize: 14, color: "#58675F", lineHeight: 21 },
	card: { padding: 20, borderRadius: 21, gap: 15 },
	source: { padding: 12, borderRadius: 13, gap: 3, marginTop: 4 },
	error: { color: "#A32C22", fontSize: 14 },
	errorCard: { backgroundColor: "#FBECE9", padding: 14, borderRadius: 12 },
	topline: { alignSelf: "flex-start", marginBottom: 5 },
	track: { height: 5, borderRadius: 5, overflow: "hidden", marginVertical: 5 },
	trackFill: { backgroundColor: "#1D655C", height: "100%", borderRadius: 5 },
	practiceHeader: { marginTop: 15, gap: 7 },
	options: { gap: 11, marginVertical: 10 },
	option: { borderWidth: 1.2, borderRadius: 15, overflow: "hidden" },
	feedback: { borderRadius: 19, padding: 18, gap: 14 },
	footer: {
		marginTop: 35,
		paddingTop: 15,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: "#3B494450",
		gap: 9,
	},
});
