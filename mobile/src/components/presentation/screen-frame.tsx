import type React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PresentationText } from "./text";
import { usePresentationTheme } from "./theme";

export type ScreenFrameProps = {
	title: string;
	subtitle?: string;
	insetMode: "tabs" | "stack" | "standalone";
	scrollOwner: "frame" | "content";
	children: React.ReactNode;
};

/** RN-tree frame. `content` supplies exactly one scroller (e.g. Host > FieldGroup).
 * Stack title belongs to the native navigation header; tabs/standalone have one content heading.
 * NativeTabs owns its bottom inset; iOS frame scrollers own automatic inset adjustment.
 * A content-owned scroller has an RN heading outside it, so the frame owns the top safe area.
 * Both owners share a content width; native content keeps its own scrolling and section padding.
 */
export function ScreenFrame({
	title,
	subtitle,
	insetMode,
	scrollOwner,
	children,
}: ScreenFrameProps) {
	const theme = usePresentationTheme();
	const insets = useSafeAreaInsets();
	const standalone = insetMode === "standalone";
	const top =
		standalone ||
		(insetMode === "tabs" &&
			(Platform.OS === "android" || scrollOwner === "content"))
			? insets.top
			: 0;
	const bottom =
		standalone || (insetMode === "stack" && Platform.OS === "android")
			? insets.bottom
			: 0;
	const heading = (
		<View style={{ gap: 4 }}>
			{!!title && insetMode !== "stack" && (
				// biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role.
				<PresentationText role="title" heading>
					{title}
				</PresentationText>
			)}
			{subtitle && (
				// biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role.
				<PresentationText role="callout" tone="secondary">
					{subtitle}
				</PresentationText>
			)}
		</View>
	);
	return (
		<KeyboardAvoidingView
			style={{ flex: 1, backgroundColor: theme.background }}
			enabled={scrollOwner === "frame"}
			behavior={Platform.OS === "ios" ? "padding" : undefined}
		>
			{scrollOwner === "frame" ? (
				<ScrollView
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode={
						Platform.OS === "ios" ? "interactive" : "on-drag"
					}
					contentInsetAdjustmentBehavior={standalone ? "never" : "automatic"}
					contentContainerStyle={{
						paddingLeft: 16 + insets.left,
						paddingRight: 16 + insets.right,
						paddingTop: 12 + top,
						paddingBottom: 20 + bottom,
						gap: 24,
						width: "100%",
						maxWidth: 960,
						alignSelf: "center",
					}}
				>
					{((!!title && insetMode !== "stack") || !!subtitle) && heading}
					{children}
				</ScrollView>
			) : (
				<View
					style={{
						flex: 1,
						minHeight: 0,
						width: "100%",
						maxWidth: 960,
						alignSelf: "center",
						paddingTop: top,
						paddingBottom: bottom,
						paddingLeft: insets.left,
						paddingRight: insets.right,
					}}
				>
					{((!!title && insetMode !== "stack") || !!subtitle) && (
						<View
							style={{
								paddingHorizontal: 16,
								paddingTop: 12,
								paddingBottom: 8,
							}}
						>
							{heading}
						</View>
					)}
					{children}
				</View>
			)}
		</KeyboardAvoidingView>
	);
}
