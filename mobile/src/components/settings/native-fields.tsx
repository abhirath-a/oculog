import { FieldGroup } from "@expo/ui";
import type { PropsWithChildren } from "react";

/** SwiftUI Form retains platform-native scrolling and focus. */
export default function NativeFields({ children }: PropsWithChildren) {
	return <FieldGroup>{children}</FieldGroup>;
}
