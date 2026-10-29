// biome-ignore-all lint/suspicious/noArrayIndexKey: Answer paragraphs and sources are immutable within each exchange.

import { BottomSheet, RNHostView } from "@expo/ui";
import {
	type ComponentRef,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	ActivityIndicator,
	KeyboardAvoidingView,
	Linking,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	useColorScheme,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isSafeAdviceURL } from "../../lib/advice-api";
import { chatAdviceAPI, chatAPI } from "../../lib/advice-chat-api";
import { createAdviceController } from "../../lib/advice-controller";
import { request, sessionStore } from "../../lib/api";
import { createEducationController } from "../../lib/education-controller";
import { NativeContent, NativeRow, NativeSection } from "../native-page";
import { AdviceAction, type AdviceActionProps } from "./advice-action";
import {
	composerBounds,
	createChatScrollPolicy,
	measuredComposerHeight,
} from "./chat-layout";
import { EducationSettings } from "./education-settings";

function SourceLink({
	title,
	url,
	onError,
}: {
	title: string;
	url: string;
	onError(): void;
}) {
	if (!isSafeAdviceURL(url)) return null;
	return (
		<AdviceAction
			label={`Source: ${title} ↗`}
			onPress={() => {
				if (isSafeAdviceURL(url)) void Linking.openURL(url).catch(onError);
			}}
		/>
	);
}

type Panel = "settings" | "safety" | "questions" | "about" | null;

function currentIdentity() {
	return sessionStore.account && sessionStore.token
		? JSON.stringify([sessionStore.account.id, sessionStore.token])
		: null;
}

export default function AdviceScreen() {
	const [{ controller, education }] = useState(() => {
		const education = createEducationController(
			chatAPI(request),
			currentIdentity,
			(notice) => controller.clear(notice),
		);
		const controller = createAdviceController(
			chatAdviceAPI(request, education.options),
			currentIdentity,
		);
		return { controller, education };
	});
	const educationState = useSyncExternalStore(
		education.subscribe,
		education.getState,
		education.getState,
	);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getState,
		controller.getState,
	);
	const [panel, setPanel] = useState<Panel>(null);
	const [linkError, setLinkError] = useState(false);
	const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
	const insets = useSafeAreaInsets();
	const { fontScale } = useWindowDimensions();
	const bounds = composerBounds(fontScale);
	const [inputHeight, setInputHeight] = useState(bounds.min);
	const inputMeasurement = useRef(bounds.min);
	const follow = useRef(createChatScrollPolicy());
	useEffect(() => {
		setInputHeight(
			state.draft.length
				? measuredComposerHeight(inputMeasurement.current, {
						min: bounds.min,
						max: bounds.max,
					})
				: bounds.min,
		);
	}, [state.draft, bounds.min, bounds.max]);
	const dark = useColorScheme() === "dark";
	const c = dark
		? {
				bg: "#0A101B",
				surface: "#121C2B",
				bubble: "#1D2C42",
				border: "#293950",
				text: "#F5F8FE",
				muted: "#98A9C0",
				tint: "#71C4FF",
				user: "#245D9A",
				danger: "#FFB6A8",
			}
		: {
				bg: "#F7F9FC",
				surface: "#FFFFFF",
				bubble: "#EDF2F8",
				border: "#E0E7F0",
				text: "#17263B",
				muted: "#66768B",
				tint: "#1269B0",
				user: "#226DB0",
				danger: "#B63D2D",
			};
	const topics = educationState.status?.topics ?? [];
	const catalogue = state.catalogue;
	const presentation = catalogue?.presentation;

	useEffect(() => {
		controller.mount();
		education.mount();
		void controller.loadCatalogue();
		void education.load();
		const unsubscribe = sessionStore.onChange(() => {
			if (education.syncIdentity()) void education.load();
			if (controller.syncIdentity()) {
				follow.current.requestFollow();
				setLinkError(false);
				void controller.loadCatalogue();
			}
		});
		return () => {
			unsubscribe();
			controller.dispose();
			education.dispose();
		};
	}, [controller, education]);

	const send = () => {
		if (!state.pending && state.draft.trim()) {
			follow.current.requestFollow();
			void controller.sendMessage();
		}
	};
	const suggestedTopics = topics.length
		? topics.map((t) => ({ id: t.id, label: t.title, education: true }))
		: (presentation?.topics ?? []).map((t) => ({
				id: t.id,
				label: t.label,
				education: false,
			}));
	const runTopic = (topic: (typeof suggestedTopics)[number]) => {
		if (state.pending) return;
		follow.current.requestFollow();
		if (topic.education) void controller.sendTopic(topic.id, topic.label);
		else void controller.sendQuestion(topic.id);
		setPanel(null);
	};

	const nativeButton = (
		label: string,
		onPress: () => void,
		opts: Omit<AdviceActionProps, "label" | "onPress"> = {},
	) => <AdviceAction label={label} onPress={onPress} {...opts} />;

	const action = (label: string, onPress: () => void, danger = false) => (
		<View style={{ minHeight: 48, justifyContent: "center" }}>
			{nativeButton(label, onPress, {
				disabled: state.pending && !danger,
				height: 48,
			})}
		</View>
	);

	return (
		<View style={[styles.root, { backgroundColor: c.bg }]}>
			<View
				style={[
					styles.header,
					{
						paddingTop: insets.top + 8,
						borderColor: c.border,
						backgroundColor: c.surface,
					},
				]}
			>
				<View style={styles.brandMark}>
					<Text style={styles.brandGlyph}>✳</Text>
				</View>
				<View style={{ flex: 1 }}>
					<Text style={[styles.headerTitle, { color: c.text }]}>
						Oculog Assistant
					</Text>
					<Text style={[styles.headerSubtitle, { color: c.muted }]}>
						{educationState.enabled
							? "Gemini on · Current question only"
							: "Contact lens education · Local sources"}
					</Text>
				</View>
				{nativeButton("Education settings", () => setPanel("settings"), {
					systemImage: "slider.horizontal.3",
					iconOnly: true,
				})}
				{nativeButton("More options", () => setPanel("about"), {
					systemImage: "ellipsis",
					iconOnly: true,
				})}
			</View>

			<KeyboardAvoidingView
				style={{ flex: 1, minHeight: 0 }}
				behavior="padding"
				keyboardVerticalOffset={0}
			>
				<ScrollView
					ref={scrollRef}
					style={{ flex: 1, minHeight: 0 }}
					contentContainerStyle={[styles.messages, { paddingBottom: 20 }]}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="interactive"
					scrollEventThrottle={16}
					onScroll={({ nativeEvent }) => {
						follow.current.onScroll(
							nativeEvent.contentOffset.y,
							nativeEvent.layoutMeasurement.height,
							nativeEvent.contentSize.height,
						);
					}}
					onLayout={() => {
						if (follow.current.shouldFollow())
							scrollRef.current?.scrollToEnd({ animated: false });
					}}
					onContentSizeChange={() => {
						if (follow.current.shouldFollow())
							scrollRef.current?.scrollToEnd({ animated: false });
					}}
				>
					<View
						style={[
							styles.safety,
							{ backgroundColor: c.surface, borderColor: c.border },
						]}
					>
						<View style={{ flex: 1 }}>
							<Text style={[styles.safetyText, { color: c.muted }]}>
								Educational guidance, not a diagnosis. For urgent eye symptoms,
								seek professional care.
							</Text>
						</View>
						{nativeButton("Safety", () => setPanel("safety"), {
							systemImage: "cross.case",
							height: 42,
						})}
					</View>

					{!state.exchanges.length && (
						<View style={styles.empty}>
							<View style={[styles.emptyIcon, { backgroundColor: c.bubble }]}>
								<Text style={[styles.emptyIconText, { color: c.tint }]}>✳</Text>
							</View>
							<Text style={[styles.emptyTitle, { color: c.text }]}>
								How can I help?
							</Text>
							<Text style={[styles.emptyDescription, { color: c.muted }]}>
								Ask about contact lens care, comfort, hygiene, and everyday
								questions.
							</Text>
							<Text style={[styles.suggestionsLabel, { color: c.muted }]}>
								SUGGESTED QUESTIONS
							</Text>
							<View style={styles.chips}>
								{suggestedTopics.slice(0, 4).map((topic) => (
									<View
										key={`${topic.education}-${topic.id}`}
										style={{ maxWidth: "100%" }}
									>
										{nativeButton(topic.label, () => runTopic(topic), {
											disabled: state.pending,
											height: 48,
										})}
									</View>
								))}
							</View>
							{!!suggestedTopics.length && (
								<View style={{ marginTop: 16 }}>
									{nativeButton(
										"Explore all topics",
										() => setPanel("questions"),
										{ systemImage: "square.grid.2x2" },
									)}
								</View>
							)}
						</View>
					)}

					{!!state.notice && (
						<View style={[styles.notice, { backgroundColor: c.bubble }]}>
							<Text style={{ color: c.muted }}>{state.notice}</Text>
						</View>
					)}

					{state.exchanges.map((exchange) => (
						<View key={exchange.key} style={styles.exchange}>
							<View style={styles.userRow}>
								<View style={[styles.userBubble, { backgroundColor: c.user }]}>
									<Text style={styles.userText}>{exchange.label}</Text>
								</View>
							</View>
							<View style={styles.assistantRow}>
								<View
									style={[
										styles.assistantAvatar,
										{ backgroundColor: c.bubble },
									]}
								>
									<Text style={{ color: c.tint, fontSize: 16 }}>✳</Text>
								</View>
								<View
									style={[
										styles.answer,
										{ borderColor: c.border, backgroundColor: c.surface },
									]}
								>
									{exchange.answer ? (
										<View style={{ gap: 11 }}>
											<Text
												style={[
													styles.answerTitle,
													{
														color:
															exchange.answer.urgency === "urgent" ||
															exchange.answer.urgency === "emergency"
																? c.danger
																: c.text,
													},
												]}
											>
												{exchange.answer.title}
											</Text>
											{exchange.answer.paragraphs.map((paragraph, index) => (
												<Text
													key={`${exchange.key}-p-${index}`}
													style={[styles.answerBody, { color: c.text }]}
												>
													{paragraph}
												</Text>
											))}
											{!!exchange.answer.sources.length && (
												<View
													style={[styles.sources, { borderTopColor: c.border }]}
												>
													<Text
														style={[styles.sourcesTitle, { color: c.muted }]}
													>
														SOURCES
													</Text>
													{exchange.answer.sources.map((source, index) => (
														<SourceLink
															key={`${exchange.key}-s-${index}`}
															{...source}
															onError={() => setLinkError(true)}
														/>
													))}
												</View>
											)}
											{catalogue?.questions
												.filter((q) =>
													exchange.answer?.related_question_ids.includes(q.id),
												)
												.map((q) => (
													<AdviceAction
														key={q.id}
														label={`Related: ${q.question}`}
														disabled={state.pending}
														onPress={() => {
															follow.current.requestFollow();
															void controller.sendQuestion(q.id);
														}}
													/>
												))}
										</View>
									) : exchange.error ? (
										<View style={{ gap: 12 }}>
											<Text style={[styles.answerBody, { color: c.danger }]}>
												{exchange.error}
											</Text>
											<AdviceAction
												label="Retry question"
												disabled={state.pending}
												onPress={() => void controller.retry(exchange.key)}
											/>
										</View>
									) : (
										<View style={styles.loading}>
											<ActivityIndicator size="small" color={c.tint} />
											<Text style={{ color: c.muted }}>
												Preparing your reply…
											</Text>
										</View>
									)}
								</View>
							</View>
						</View>
					))}
					{linkError && (
						<Text style={{ color: c.danger, textAlign: "center" }}>
							Could not open a source. Please try again.
						</Text>
					)}
				</ScrollView>

				<View
					style={[
						styles.composerArea,
						{
							backgroundColor: c.surface,
							borderTopColor: c.border,
							paddingBottom: Math.max(insets.bottom, 12),
						},
					]}
				>
					<View
						style={[
							styles.composer,
							{ borderColor: c.border, backgroundColor: c.bg },
						]}
					>
						<TextInput
							accessibilityLabel="Ask a contact lens question"
							value={state.draft}
							onChangeText={controller.setDraft}
							placeholder="Ask anything about lens care…"
							placeholderTextColor={c.muted}
							autoCapitalize="sentences"
							autoCorrect
							multiline
							maxLength={1000}
							onContentSizeChange={({ nativeEvent }) => {
								inputMeasurement.current = nativeEvent.contentSize.height;
								setInputHeight(
									controller.getState().draft.length
										? measuredComposerHeight(inputMeasurement.current, bounds)
										: bounds.min,
								);
							}}
							scrollEnabled={inputHeight >= bounds.max}
							style={[styles.input, { color: c.text, height: inputHeight }]}
						/>
						<View style={{ width: 46, height: 44, justifyContent: "center" }}>
							{nativeButton("Send question", send, {
								systemImage: "arrow.up",
								iconOnly: true,
								prominent: true,
								disabled: state.pending || !state.draft.trim(),
								height: 44,
							})}
						</View>
					</View>
					<Text style={[styles.footer, { color: c.muted }]}>
						Oculog can make mistakes. Confirm medical concerns with an eye care
						professional.
					</Text>
				</View>
			</KeyboardAvoidingView>

			<BottomSheet
				isPresented={panel !== null}
				onDismiss={() => setPanel(null)}
				snapPoints={["half", "full"]}
				containerColor={c.bg}
				contentPadding={0}
			>
				<RNHostView>
					<View
						style={[
							styles.modalRoot,
							{ backgroundColor: c.bg, height: "100%" },
						]}
					>
						<View style={[styles.modalHeader, { borderBottomColor: c.border }]}>
							<Text style={[styles.modalTitle, { color: c.text }]}>
								{panel === "settings"
									? "Education preferences"
									: panel === "safety"
										? "Safety guidance"
										: panel === "questions"
											? "Explore topics"
											: "Conversation options"}
							</Text>
							{nativeButton("Done", () => setPanel(null))}
						</View>
						{panel === "settings" ? (
							<NativeContent>
								<NativeSection title="AI and language">
									<NativeRow>
										<EducationSettings
											control={education}
											state={educationState}
											onLinkError={() => setLinkError(true)}
										/>
									</NativeRow>
								</NativeSection>
							</NativeContent>
						) : (
							<ScrollView
								contentContainerStyle={styles.modalContent}
								keyboardShouldPersistTaps="handled"
							>
								{panel === "safety" && (
									<View style={{ gap: 14 }}>
										{presentation ? (
											<>
												{presentation.triage
													.filter(
														(item) =>
															item.level === "emergency" ||
															item.level === "urgent",
													)
													.map((item) => (
														<View
															key={item.level}
															style={[
																styles.modalCard,
																{
																	backgroundColor: c.surface,
																	borderColor: c.border,
																},
															]}
														>
															<Text
																style={[
																	styles.answerTitle,
																	{ color: c.danger },
																]}
															>
																{item.title}
															</Text>
															<Text
																style={[styles.answerBody, { color: c.text }]}
															>
																{item.text}
															</Text>
														</View>
													))}
												<Text style={[styles.answerBody, { color: c.text }]}>
													{presentation.lens_action}
												</Text>
												<Text style={[styles.answerBody, { color: c.text }]}>
													{presentation.caution}
												</Text>
											</>
										) : (
											<Text style={[styles.answerBody, { color: c.text }]}>
												{catalogue?.safety_notice ??
													"Safety guidance is unavailable. For urgent eye problems, seek professional care rather than waiting for the app."}
											</Text>
										)}
										{!!catalogue?.disclaimer && (
											<Text style={[styles.answerBody, { color: c.text }]}>
												{catalogue.disclaimer}
											</Text>
										)}
										{!!catalogue?.safety_notice && (
											<Text style={[styles.answerBody, { color: c.text }]}>
												{catalogue.safety_notice}
											</Text>
										)}
										{!!state.catalogueError && (
											<Text style={{ color: c.danger }}>
												{state.catalogueError}
											</Text>
										)}
										<AdviceAction
											label={
												state.catalogueLoading
													? "Loading…"
													: "Refresh safety information"
											}
											disabled={state.catalogueLoading}
											onPress={() => void controller.loadCatalogue()}
										/>
									</View>
								)}
								{panel === "questions" && (
									<View style={{ gap: 10 }}>
										{suggestedTopics.map((topic) => (
											<View key={`${topic.education}-${topic.id}`}>
												{action(topic.label, () => runTopic(topic))}
											</View>
										))}
										{!!catalogue?.questions.length && (
											<Text style={[styles.groupLabel, { color: c.muted }]}>
												MORE QUESTIONS
											</Text>
										)}
										{catalogue?.questions.map((q) => (
											<View key={q.id}>
												{action(q.question, () => {
													if (!state.pending) {
														void controller.sendQuestion(q.id);
														setPanel(null);
													}
												})}
											</View>
										))}
										{!suggestedTopics.length &&
											!catalogue?.questions.length && (
												<Text style={{ color: c.muted }}>
													No suggested topics available right now. You can still
													type a question.
												</Text>
											)}
									</View>
								)}
								{panel === "about" && (
									<View style={{ gap: 14 }}>
										<Text style={[styles.answerBody, { color: c.muted }]}>
											This conversation is temporary, not a saved chat log. Up
											to 20 exchanges stay on this screen. After fresh consent,
											Gemini receives only the current question and public
											source passages—not earlier messages, account details,
											lens records or photos. Include relevant context in each
											question. Language and AI preference changes apply to
											future questions.
										</Text>
										{action("Education preferences", () =>
											setPanel("settings"),
										)}
										{action("Explore all questions", () =>
											setPanel("questions"),
										)}
										{action("Safety and limitations", () => setPanel("safety"))}
										{action(
											"Clear conversation",
											() => {
												controller.clear();
												follow.current.requestFollow();
												setLinkError(false);
												setPanel(null);
											},
											true,
										)}
									</View>
								)}
							</ScrollView>
						)}
					</View>
				</RNHostView>
			</BottomSheet>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	header: {
		flexDirection: "row",
		alignItems: "center",
		gap: 11,
		paddingHorizontal: 18,
		paddingBottom: 13,
		borderBottomWidth: StyleSheet.hairlineWidth,
	},
	brandMark: {
		width: 39,
		height: 39,
		borderRadius: 14,
		backgroundColor: "#216CAA",
		alignItems: "center",
		justifyContent: "center",
	},
	brandGlyph: { fontSize: 24, color: "white" },
	headerTitle: { fontSize: 17, fontWeight: "700" },
	headerSubtitle: { fontSize: 11, marginTop: 3 },
	headerIcon: {
		width: 35,
		height: 40,
		alignItems: "center",
		justifyContent: "center",
	},
	headerIconText: { fontSize: 25 },
	messages: { flexGrow: 1, paddingHorizontal: 17, paddingTop: 14, gap: 18 },
	safety: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		borderRadius: 13,
		padding: 12,
		borderWidth: 1,
	},
	safetyText: { flex: 1, fontSize: 12, lineHeight: 18 },
	empty: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingVertical: 46,
		paddingHorizontal: 8,
	},
	emptyIcon: {
		width: 64,
		height: 64,
		borderRadius: 23,
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 23,
	},
	emptyIconText: { fontSize: 36 },
	emptyTitle: { fontSize: 27, fontWeight: "700", textAlign: "center" },
	emptyDescription: {
		fontSize: 14,
		lineHeight: 22,
		textAlign: "center",
		marginTop: 9,
		maxWidth: 300,
	},
	suggestionsLabel: {
		alignSelf: "flex-start",
		fontSize: 10,
		fontWeight: "700",
		letterSpacing: 1.3,
		marginTop: 35,
		marginBottom: 12,
	},
	chips: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 9,
		alignSelf: "stretch",
	},
	chip: {
		borderRadius: 14,
		borderWidth: 1,
		paddingHorizontal: 13,
		paddingVertical: 11,
		maxWidth: "100%",
	},
	chipText: { fontSize: 13, fontWeight: "500" },
	notice: { borderRadius: 12, padding: 12 },
	exchange: { gap: 15 },
	userRow: {
		flexDirection: "row",
		justifyContent: "flex-end",
		paddingLeft: 50,
	},
	userBubble: {
		borderRadius: 19,
		borderBottomRightRadius: 5,
		paddingHorizontal: 15,
		paddingVertical: 12,
	},
	userText: { color: "#FFFFFF", fontSize: 15, lineHeight: 22 },
	assistantRow: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 9,
		paddingRight: 15,
	},
	assistantAvatar: {
		width: 29,
		height: 29,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
		marginTop: 2,
	},
	answer: {
		flex: 1,
		borderWidth: 1,
		borderRadius: 17,
		borderTopLeftRadius: 5,
		padding: 15,
		minWidth: 0,
	},
	answerTitle: { fontSize: 16, fontWeight: "700", lineHeight: 23 },
	answerBody: { fontSize: 14, lineHeight: 22 },
	sources: { marginTop: 4, borderTopWidth: 1, paddingTop: 12, gap: 8 },
	sourcesTitle: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
	loading: { flexDirection: "row", alignItems: "center", gap: 10 },
	composerArea: {
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingTop: 12,
		paddingHorizontal: 14,
	},
	composer: {
		borderRadius: 23,
		borderWidth: 1,
		flexDirection: "row",
		alignItems: "flex-end",
		padding: 6,
		paddingLeft: 15,
		minHeight: 50,
	},
	input: {
		flex: 1,
		minWidth: 0,
		paddingTop: 10,
		paddingBottom: 10,
		fontSize: 16,
		lineHeight: 22,
		textAlignVertical: "top",
	},
	send: {
		width: 36,
		height: 36,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
		marginLeft: 6,
	},
	sendGlyph: { color: "white", fontSize: 23, fontWeight: "700", marginTop: -2 },
	footer: { textAlign: "center", fontSize: 10, lineHeight: 15, marginTop: 9 },
	modalRoot: { flex: 1 },
	modalHeader: {
		flexDirection: "row",
		alignItems: "center",
		paddingHorizontal: 18,
		paddingVertical: 15,
		borderBottomWidth: StyleSheet.hairlineWidth,
		gap: 15,
	},
	modalTitle: { flex: 1, fontSize: 19, fontWeight: "700" },
	done: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
	modalContent: { padding: 18, paddingBottom: 50 },
	modalCard: { borderRadius: 13, borderWidth: 1, padding: 14, gap: 8 },
	groupLabel: {
		fontSize: 11,
		fontWeight: "700",
		marginTop: 18,
		letterSpacing: 1,
	},
	action: { borderWidth: 1, padding: 16, borderRadius: 13 },
});
