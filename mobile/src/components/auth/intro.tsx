import { PresentationText } from "../presentation";

/** One task heading. No separate brand, introduction or navigation surface. */
export function AuthIntro({ title }: { title: string }) {
	return (
		// biome-ignore lint/a11y/useValidAriaRole: typography role.
		<PresentationText role="title" heading>
			{title}
		</PresentationText>
	);
}
