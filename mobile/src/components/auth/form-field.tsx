import { Host } from "@expo/ui";
import { View } from "react-native";
import { PresentationText, usePresentationEpoch } from "../presentation";
import { AuthField, type AuthFieldProps } from "./field";

/** RN-tree adapter; the field itself is SwiftUI on iOS and Material Compose on Android. */
export function FormField({
	hint,
	...props
}: AuthFieldProps & { hint?: string }) {
	const epoch = usePresentationEpoch();
	return (
		<View style={{ gap: 4 }}>
			<Host
				key={epoch}
				matchContents={{ vertical: true }}
				ignoreSafeArea="all"
				style={{ width: "100%" }}
			>
				<AuthField {...props} />
			</Host>
			{!!hint && !props.error && (
				<PresentationText role="caption" tone="secondary">
					{hint}
				</PresentationText>
			)}
		</View>
	);
}
