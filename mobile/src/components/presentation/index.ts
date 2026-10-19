/** Frozen app-facing tree contracts:
 * Native-tree: SemanticText, DateField, NativeField. Compose under Host/Form/FieldGroup/Column.
 * RN-tree: PresentationText, ChoiceControl (owns Host), ScreenFrame.
 * NativeSheet is RN-tree and accepts RN children; owns root BottomSheet (which owns Host)
 * and its RNHostView bridge. Never pass native-tree children directly to NativeSheet.
 * Root @expo/ui FieldGroup is the real SwiftUI Form / Compose LazyColumn. Use it inside
 * Host with ScreenFrame scrollOwner="content"; don't wrap it in an RN ScrollView.
 * Inside FieldGroup root Picker is native-tree; ChoiceControl is not.
 */
export { ChoiceControl, type ChoiceControlProps } from "./choice-control";
export { DateField, type DateFieldProps } from "./date-field";
export { notifySuccess } from "./haptics";
export {
	NativeField,
	type NativeFieldHandle,
	type NativeFieldProps,
} from "./native-field";
export { NativeSheet, type NativeSheetProps } from "./native-sheet";
export { ScreenFrame, type ScreenFrameProps } from "./screen-frame";
export { SemanticText } from "./semantic-text";
export { PresentationText, type SemanticTextProps } from "./text";
export {
	type PresentationTheme,
	PresentationThemeProvider,
	usePresentationEpoch,
	usePresentationTheme,
} from "./theme";
