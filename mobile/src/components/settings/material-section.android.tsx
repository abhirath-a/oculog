import { Column } from "@expo/ui/jetpack-compose";
import {
	background,
	clip,
	fillMaxWidth,
	padding,
	Shapes,
} from "@expo/ui/jetpack-compose/modifiers";
import type { ReactNode } from "react";
import { SemanticText, usePresentationTheme } from "../presentation";

/** One Material group, never an implicit ListItem around another control. */
export function MaterialSection({
	title,
	children,
	footer,
}: {
	title?: string;
	children: ReactNode;
	footer?: ReactNode;
}) {
	const theme = usePresentationTheme();
	return (
		<Column verticalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth()]}>
			{title && (
				// biome-ignore lint/a11y/useValidAriaRole: SemanticTextProps.role maps to Compose typography, not a DOM role.
				<SemanticText role="headline" tone="secondary">
					{title}
				</SemanticText>
			)}
			<Column
				verticalArrangement={{ spacedBy: 12 }}
				modifiers={[
					fillMaxWidth(),
					clip(Shapes.RoundedCorner(20)),
					background(theme.surface),
					padding(16, 12, 16, 12),
				]}
			>
				{children}
			</Column>
			{footer}
		</Column>
	);
}
