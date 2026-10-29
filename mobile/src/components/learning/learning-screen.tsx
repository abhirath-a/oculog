import { Button, Host, HStack, Text as SwiftText } from "@expo/ui/swift-ui";
import {
	buttonStyle,
	controlSize,
	disabled,
	font,
	foregroundStyle,
	padding,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { randomUUID } from "expo-crypto";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	Linking,
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
import { initialPracticeSelection, recommendationReasons } from "./hub-model";

// iOS-first screen. All actions and answer choices are native SwiftUI buttons.
// React Native handles scrolling and flexible text layout around native controls.
function NativeButton({
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
	return (
		<Host style={{ height: 51, width: "100%" }}>
			<Button
				label={label}
				systemImage={symbol as any}
				role={destructive ? "destructive" : "default"}
				onPress={onPress}
				modifiers={[
					buttonStyle(secondary ? "bordered" : "borderedProminent"),
					controlSize("large"),
					...(destructive ? [tint("#DC3545")] : []),
					...(blocked ? [disabled()] : []),
				]}
			/>
		</Host>
	);
}

function SmallNativeButton({
	label,
	onPress,
	symbol,
}: {
	label: string;
	onPress: () => void;
	symbol?: string;
}) {
	return (
		<Host matchContents>
			<Button
				label={label}
				systemImage={symbol as any}
				onPress={onPress}
				modifiers={[buttonStyle("borderless")]}
			/>
		</Host>
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
		<View style={[s.source, { backgroundColor: dark ? "#20242C" : "#F3F5F9" }]}>
			<SmallNativeButton
				label={expanded ? "Hide source evidence" : "View source evidence"}
				symbol="doc.text.magnifyingglass"
				onPress={() => setExpanded(!expanded)}
			/>
			{expanded && (
				<View style={{ gap: 10, paddingTop: 8 }}>
					<Text
						style={[s.body, { color: dark ? "#E5E7EB" : "#273449" }]}
					>{`“${reference.quote}”`}</Text>
					<Text style={s.subdued}>{reference.url}</Text>
					<NativeButton
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
		<View
			style={[
				s.option,
				{
					borderColor: checked ? "#3478F6" : dark ? "#343B48" : "#E1E6EF",
					backgroundColor: checked
						? dark
							? "#18345B"
							: "#EDF4FF"
						: dark
							? "#1D222B"
							: "#FFFFFF",
				},
			]}
		>
			<Host style={{ minHeight: 86, width: "100%" }}>
				<Button
					onPress={onPress}
					modifiers={[
						buttonStyle("plain"),
						padding({ horizontal: 14, vertical: 9 }),
						...(blocked ? [disabled()] : []),
					]}
				>
					<HStack spacing={12} alignment="center">
						<SwiftText
							modifiers={[
								font({ size: 20, weight: checked ? "semibold" : "regular" }),
								foregroundStyle(
									checked ? "#3478F6" : dark ? "#ACB4C0" : "#7A8493",
								),
							]}
						>
							{checked ? "◉" : "◯"}
						</SwiftText>
						<SwiftText
							modifiers={[
								font({ size: 15 }),
								foregroundStyle(dark ? "#F3F5F7" : "#172237"),
							]}
						>
							{text}
						</SwiftText>
					</HStack>
				</Button>
			</Host>
		</View>
	);
}

export default function LearningScreen({
	initialLessonID,
	initialQuestionID,
}: {
	initialLessonID?: string;
	initialQuestionID?: string;
} = {}) {
	const dark = useColorScheme() === "dark";
	const bg = dark ? "#101318" : "#F8FAFD";
	const fg = dark ? "#F2F5FA" : "#172237";
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
		<View style={[s.screen, { backgroundColor: bg }]}>
			<View
				style={[s.nav, { borderBottomColor: dark ? "#303742" : "#EBEFF4" }]}
			>
				<View>
					<Text style={[s.brand, { color: fg }]}>Learn</Text>
					<Text style={s.navCaption}>Contact lens care</Text>
				</View>
				<SmallNativeButton
					label="Progress"
					symbol="chart.bar"
					onPress={() => setShowSettings((v) => !v)}
				/>
			</View>
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
					<NativeButton
						label="Retry saving answer"
						secondary
						onPress={() => void controller.retry()}
					/>
				)}
				{(!status || state.resetUncertain) && !state.busy && (
					<NativeButton
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
										{ backgroundColor: dark ? "#1C222B" : "#FFFFFF" },
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
											<NativeButton
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
									<SmallNativeButton
										label={question ? "Back to lesson" : "Learning hub"}
										symbol="chevron.left"
										onPress={() =>
											question ? returnToLesson() : setLessonID(null)
										}
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
											{ backgroundColor: dark ? "#303744" : "#E5EAF3" },
										]}
									>
										<View
											style={[
												s.trackFill,
												{
													width: `${Math.max(0, Math.min(100, ((currentIndex + 1) / Math.max(questions.length, 1)) * 100))}%`,
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
												{ backgroundColor: dark ? "#1C222B" : "#FFFFFF" },
											]}
										>
											<Text style={[s.body, { color: fg }]}>{lesson.text}</Text>
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
												{questions.length} questions to check what you learned.
											</Text>
										</View>
										{questions.length ? (
											<NativeButton
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
											<NativeButton
												label={state.busy ? "Saving answer…" : "Check answer"}
												symbol="checkmark"
												blocked={locked || selectedOption === null}
												onPress={() => {
													if (selectedOption !== null)
														void controller.answer(question.id, selectedOption);
												}}
											/>
										) : (
											<>
												<View
													style={[
														s.feedback,
														{ backgroundColor: dark ? "#1C222B" : "#FFFFFF" },
													]}
												>
													<Text style={[s.heading, { color: fg }]}>
														{state.feedback.correct ? "✓ Correct" : "Not quite"}
													</Text>
													<Text style={[s.body, { color: fg }]}>
														{state.feedback.explanation}
													</Text>
													<SourceEvidence
														reference={state.feedback.reference}
														dark={dark}
													/>
												</View>
												<NativeButton
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
							<SmallNativeButton
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
										{ backgroundColor: dark ? "#1C222B" : "#FFFFFF" },
									]}
								>
									<Text style={[s.heading, { color: fg }]}>
										Practice progress
									</Text>
									<Text style={[s.body, { color: fg }]}>
										{progress.length} questions tried
									</Text>
									<Text style={s.subdued}>
										{correct} correct answers across {attempts} saved attempts.
									</Text>
									<Text style={s.subdued}>
										Correct answers become eligible for review after seven days.
										Practice does not change your lens-care schedule, reminders,
										or stock.
									</Text>
									{!confirmReset ? (
										<NativeButton
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
											<NativeButton
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
											<NativeButton
												label="Keep progress"
												secondary
												onPress={() => setConfirmReset(false)}
											/>
										</>
									)}
								</View>
							)}
							<SmallNativeButton
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
										{ backgroundColor: dark ? "#1C222B" : "#FFFFFF" },
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
	);
}

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
	navCaption: { color: "#7D8999", fontSize: 12, marginTop: 1 },
	content: { padding: 22, paddingBottom: 62, gap: 16 },
	hero: { gap: 11, marginTop: 14, marginBottom: 12 },
	eyebrow: {
		color: "#4481E8",
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
	subdued: { fontSize: 14, color: "#8894A6", lineHeight: 21 },
	card: { padding: 20, borderRadius: 21, gap: 15 },
	source: { padding: 12, borderRadius: 13, gap: 3, marginTop: 4 },
	error: { color: "#D94B54", fontSize: 14 },
	errorCard: { backgroundColor: "#FEEDF0", padding: 14, borderRadius: 12 },
	topline: { alignSelf: "flex-start", marginBottom: 5 },
	track: { height: 5, borderRadius: 5, overflow: "hidden", marginVertical: 5 },
	trackFill: { backgroundColor: "#3478F6", height: "100%", borderRadius: 5 },
	practiceHeader: { marginTop: 15, gap: 7 },
	options: { gap: 11, marginVertical: 10 },
	option: { borderWidth: 1.2, borderRadius: 15, overflow: "hidden" },
	feedback: { borderRadius: 19, padding: 18, gap: 14 },
	footer: {
		marginTop: 35,
		paddingTop: 15,
		borderTopWidth: StyleSheet.hairlineWidth,
		borderTopColor: "#9AA4B250",
		gap: 9,
	},
});
