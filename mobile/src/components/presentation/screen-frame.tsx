import type React from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandWordmark } from "../brand/wordmark";
import { PresentationText } from "./text";
import { usePresentationTheme } from "./theme";

export type ScreenFrameProps = {
	title: string;
	subtitle?: string;
	insetMode: "tabs" | "stack" | "standalone";
	scrollOwner: "frame" | "content";
	brand?: boolean;
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
	brand = false,
	children,
}: ScreenFrameProps) {
	const theme = usePresentationTheme();
	const insets = useSafeAreaInsets();
	const standalone = insetMode === "standalone";
	const top =
		standalone || (insetMode === "tabs" && scrollOwner === "content")
			? insets.top
			: 0;
	const bottom = standalone ? insets.bottom : 0;
	const headingText = (
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
	const heading = brand ? (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				flexWrap: "wrap",
				gap: 12,
			}}
		>
			<View style={{ flexGrow: 1, flexShrink: 0, maxWidth: "100%" }}>
				{headingText}
			</View>
			<BrandWordmark color={theme.text} />
		</View>
	) : (
		headingText
	);
	return (
		<KeyboardAvoidingView
			style={{
				flex: 1,
				backgroundColor: theme.background,
			}}
			enabled={scrollOwner === "frame"}
			behavior="padding"
		>
			{scrollOwner === "frame" ? (
				<ScrollView
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="interactive"
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
