import { BottomSheet, Button, Host, RNHostView } from "@expo/ui";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import {
	accessibilityLabel,
	frame,
	interactiveDismissDisabled,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useRef } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	ScrollView,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PresentationText } from "./text";
import {
	usePresentationEpoch,
	usePresentationPaletteHold,
	usePresentationTheme,
} from "./theme";

export type NativeSheetProps = {
	presented: boolean;
	busy: boolean;
	title: string;
	onRequestClose(): void;
	onDismiss(): void;
	children: ReactNode;
};

/** RN-tree entry point. Root BottomSheet owns its presentation Host; RNHostView explicitly bridges the RN children.
 * Android cannot block drag dismissal: always report onDismiss, including while busy. The caller must retain its draft.
 * onRequestClose is only the explicit close action. onDismiss reports a native dismissal, not a request to reset data.
 */
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
		<BottomSheet
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
			shouldDismissOnBackPress={!busy}
			shouldDismissOnClickOutside={!busy}
			modifiers={
				Platform.OS === "ios" ? [interactiveDismissDisabled(busy)] : undefined
			}
		>
			<RNHostView matchContents>
				<KeyboardAvoidingView
					accessibilityViewIsModal
					onAccessibilityEscape={() => {
						if (!busy) {
							Keyboard.dismiss();
							onRequestClose();
						}
					}}
					style={{
						maxHeight: Math.max(0, height - insets.top - 32),
						backgroundColor: theme.surface,
					}}
					behavior={Platform.OS === "ios" ? "padding" : undefined}
				>
					<View
						style={{
							paddingLeft: 16 + insets.left,
							paddingRight: 16 + insets.right,
							paddingTop: 8,
							paddingBottom: 8,
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
						<Host key={paletteEpoch} matchContents ignoreSafeArea="all">
							<Button
								label="Close"
								variant="text"
								disabled={busy}
								onPress={() => {
									if (!busy) {
										Keyboard.dismiss();
										onRequestClose();
									}
								}}
								modifiers={
									Platform.OS === "ios"
										? [
												frame({ minHeight: 44 }),
												accessibilityLabel(`Close ${title.toLowerCase()}`),
											]
										: Platform.OS === "android"
											? [
													semantics({
														contentDescription: `Close ${title.toLowerCase()}`,
													}),
												]
											: undefined
								}
							>
								{Platform.OS === "web" ? (
									<PresentationText>Close</PresentationText>
								) : undefined}
							</Button>
						</Host>
					</View>
					<ScrollView
						style={{ flexGrow: 0, flexShrink: 1 }}
						keyboardShouldPersistTaps="handled"
						keyboardDismissMode={
							Platform.OS === "ios" ? "interactive" : "on-drag"
						}
						contentContainerStyle={{
							paddingLeft: 16 + insets.left,
							paddingRight: 16 + insets.right,
							paddingBottom: 16 + insets.bottom,
							gap: 12,
						}}
					>
						{children}
					</ScrollView>
				</KeyboardAvoidingView>
			</RNHostView>
		</BottomSheet>
	);
}
