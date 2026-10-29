import { BottomSheet, Button, Host, RNHostView } from "@expo/ui";
import {
	accessibilityLabel,
	frame,
	interactiveDismissDisabled,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useRef } from "react";
import {
	Keyboard,
	KeyboardAvoidingView,
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

/** RN-tree entry point. BottomSheet owns its Host; RNHostView bridges RN children.
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
	const { width, height } = useWindowDimensions();

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
			modifiers={[interactiveDismissDisabled(busy)]}
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
						width,
						maxHeight: Math.max(0, height - insets.top - 32),
						backgroundColor: theme.surface,
					}}
					behavior="padding"
				>
					<View
						style={{
							paddingHorizontal: 16,
							paddingTop: 8,
							paddingBottom: 8,
							flexDirection: "row",
							alignItems: "center",
							gap: 8,
							width: "100%",
						}}
					>
						<View style={{ flex: 1, minWidth: 0 }}>
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
								modifiers={[
									frame({ minHeight: 44 }),
									accessibilityLabel(`Close ${title.toLowerCase()}`),
								]}
							/>
						</Host>
					</View>
					<ScrollView
						style={{ flexGrow: 0, flexShrink: 1, width: "100%" }}
						keyboardShouldPersistTaps="handled"
						keyboardDismissMode="interactive"
						contentContainerStyle={{
							paddingHorizontal: 16,
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
