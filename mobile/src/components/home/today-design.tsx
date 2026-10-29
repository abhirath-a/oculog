import { Column, FieldGroup, Host } from "@expo/ui";
import { DisclosureGroup } from "@expo/ui/swift-ui";
import { disabled, fixedSize, font, frame } from "@expo/ui/swift-ui/modifiers";
import { usePresentationTheme } from "../presentation/theme";
import {
	assertTodaySize,
	createTodayText,
	type TodayChildrenProps,
	type TodayDisclosureProps,
	type TodaySectionProps,
	type TodaySurfaceProps,
} from "./today-design-base";
import { todayType } from "./today-tokens";

export { TodayAction } from "./today-action";
export type {
	TodayDisclosureProps,
	TodaySectionProps,
	TodaySurfaceProps,
	TodayTextProps,
} from "./today-design-base";
export { TodayStack } from "./today-design-base";
export type { TodayActionProps } from "./today-tokens";
export { todaySpace, todayType } from "./today-tokens";

export const TodayText = createTodayText((role) => [
	font({
		textStyle: role === "caption" ? "caption" : todayType[role].ramp,
		weight: role === "headline" || role === "section" ? "semibold" : "regular",
	}),
	fixedSize({ horizontal: false, vertical: true }),
]);

/** One SwiftUI Form owns scrolling and grouped-list separators. */
export function TodaySurface({ width, height, children }: TodaySurfaceProps) {
	assertTodaySize(width, height);
	return (
		<Host style={{ width, height }}>
			<TodayForm>{children}</TodayForm>
		</Host>
	);
}
/** Native-tree entry for an already bounded sheet Host. Do not wrap in ScrollView. */
export function TodayForm({ children }: TodayChildrenProps) {
	const theme = usePresentationTheme();
	return (
		<FieldGroup
			style={{
				width: "100%",
				height: "100%",
				backgroundColor: theme.background,
			}}
		>
			{children}
		</FieldGroup>
	);
}
export function TodaySection({ title, children }: TodaySectionProps) {
	return <FieldGroup.Section title={title}>{children}</FieldGroup.Section>;
}
/** Form owns row inset and separator; never add nested RN/card decoration. */
export function TodayRow({
	children,
}: TodayChildrenProps & { separated?: boolean }) {
	return (
		<Column style={{ width: "100%" }} spacing={8}>
			{children}
		</Column>
	);
}
export function TodayDisclosure({
	label,
	expanded,
	onExpandedChange,
	children,
	disabled: locked = false,
}: TodayDisclosureProps) {
	return (
		<DisclosureGroup
			isExpanded={expanded}
			onIsExpandedChange={(next) => {
				if (!locked) onExpandedChange(next);
			}}
			modifiers={[disabled(locked), frame({ minHeight: 44 })]}
		>
			<DisclosureGroup.Label>
				{/* biome-ignore lint/a11y/useValidAriaRole: Typography role, not DOM ARIA. */}
				<TodayText role="headline">{label}</TodayText>
			</DisclosureGroup.Label>
			{children}
		</DisclosureGroup>
	);
}
