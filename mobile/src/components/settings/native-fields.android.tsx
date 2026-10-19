import { Column } from "@expo/ui/jetpack-compose";
import {
	background,
	fillMaxSize,
	padding,
	verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import type { PropsWithChildren } from "react";
import { usePresentationTheme } from "../presentation/theme";

/** SDK 57 LazyColumn has no scroll state/ref. Keep this short form composed so
 * native focus can bring any field into view, including after IME resizing.
 * This is the form's only scroller; Section styling remains platform-owned. */
export default function NativeFields({ children }: PropsWithChildren) {
	const theme = usePresentationTheme();
	return (
		<Column
			verticalArrangement={{ spacedBy: 24 }}
			modifiers={[
				fillMaxSize(),
				background(theme.background),
				verticalScroll(),
				padding(16, 16, 16, 16),
			]}
		>
			{children}
		</Column>
	);
}
