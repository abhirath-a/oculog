import { BottomSheet as WebDrawer } from "@expo/ui";
import { createElement, useRef } from "react";
import { Keyboard, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeSheetProps } from "./native-sheet";
import { PresentationText } from "./text";
import {
	usePresentationEpoch,
	usePresentationPaletteHold,
	usePresentationTheme,
} from "./theme";

export type { NativeSheetProps } from "./native-sheet";

/** Keep the SDK's web drawer (focus trap, Escape, focus restoration), not native modifiers. */
export function NativeSheet({
	presented,
	busy,
	title,
	onRequestClose,
	onDismiss,
	children,
}: NativeSheetProps) {
	const theme = usePresentationTheme();
	usePresentationPaletteHold(busy);
	const paletteEpoch = usePresentationEpoch();
	const currentEpoch = useRef(paletteEpoch);
	currentEpoch.current = paletteEpoch;
	const insets = useSafeAreaInsets();
	const { height } = useWindowDimensions();
	return (
		<WebDrawer
			key={paletteEpoch}
			isPresented={presented}
			onDismiss={() => {
				if (currentEpoch.current === paletteEpoch) {
					Keyboard.dismiss();
					onDismiss();
				}
			}}
			contentPadding={0}
			containerColor={theme.surface}
		>
			<View
				style={{
					maxHeight: Math.max(0, height - insets.top - 32),
					backgroundColor: theme.surface,
				}}
			>
				<View
					style={{
						paddingLeft: 16 + insets.left,
						paddingRight: 16 + insets.right,
						paddingVertical: 8,
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
					}}
				>
					<View style={{ flex: 1 }}>
						{/* biome-ignore lint/a11y/useValidAriaRole: App typography role, not an ARIA role. */}
						<PresentationText role="headline" heading>
							{title}
						</PresentationText>
					</View>
					{createElement(
						"button",
						{
							type: "button",
							"aria-label": `Close ${title.toLowerCase()}`,
							disabled: busy,
							style: { minHeight: 44 },
							onClick: () => {
								if (!busy) {
									Keyboard.dismiss();
									onRequestClose();
								}
							},
						},
						"Close",
					)}
				</View>
				<ScrollView
					style={{ flexGrow: 0, flexShrink: 1 }}
					keyboardShouldPersistTaps="handled"
					keyboardDismissMode="on-drag"
					contentContainerStyle={{
						paddingLeft: 16 + insets.left,
						paddingRight: 16 + insets.right,
						paddingBottom: 16 + insets.bottom,
						gap: 12,
					}}
				>
					{children}
				</ScrollView>
			</View>
		</WebDrawer>
	);
}
