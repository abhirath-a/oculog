import { ActivityIndicator, View } from "react-native";
import { PresentationText, ScreenFrame } from "../presentation";

export function SessionRestoring() {
	return (
		<ScreenFrame
			title="Opening your journal"
			subtitle="Restoring your securely saved session."
			insetMode="standalone"
			scrollOwner="frame"
		>
			<View
				style={{ gap: 20, paddingVertical: 24 }}
				accessibilityLiveRegion="polite"
			>
				<ActivityIndicator accessibilityLabel="Restoring your session" />
				<PresentationText tone="secondary">
					Your account and saved entries will appear when this finishes.
				</PresentationText>
			</View>
		</ScreenFrame>
	);
}
