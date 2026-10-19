import type { CSSProperties } from "react";
import type { SemanticTextProps } from "./text";
import { usePresentationTheme } from "./theme";
import { webTypography } from "./web-typography";

export type { SemanticTextProps } from "./text";

export const presentationTextStyles = {
	largeTitle: { fontSize: 32, lineHeight: 1.25, fontWeight: "400" },
	title: { fontSize: 24, lineHeight: 4 / 3, fontWeight: "400" },
	headline: { fontSize: 16, lineHeight: 1.5, fontWeight: "500" },
	body: { fontSize: 16, lineHeight: 1.5, fontWeight: "400" },
	callout: { fontSize: 14, lineHeight: 1.5, fontWeight: "400" },
	caption: { fontSize: 12, lineHeight: 1.5, fontWeight: "400" },
} satisfies Record<string, CSSProperties>;

/** Web text never evaluates either native modifier package. */
export function PresentationText({
	children,
	role = "body",
	tone,
	heading,
	accessibilityLabel,
}: SemanticTextProps) {
	const colors = usePresentationTheme();
	const color =
		tone === "danger"
			? colors.error
			: tone === "secondary"
				? colors.secondary
				: tone === "primary"
					? colors.primary
					: colors.text;
	const Element = heading ? "h1" : "div";
	return (
		<Element
			role={heading ? "heading" : undefined}
			aria-label={accessibilityLabel}
			style={{
				...webTypography,
				...presentationTextStyles[role],
				color,
				margin: 0,
				minWidth: 0,
				flexShrink: 1,
				overflowWrap: "anywhere",
				whiteSpace: "pre-wrap",
			}}
		>
			{children}
		</Element>
	);
}

export { PresentationText as SemanticText };
