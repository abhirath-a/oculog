import { Column, Host, ScrollView, Text } from "@expo/ui";
import type { ComponentProps, ReactNode } from "react";

type Modifiers = NonNullable<ComponentProps<typeof Text>["modifiers"]>;

import { usePresentationTheme } from "../presentation/theme";
import { todaySpace, todayType } from "./today-tokens";

export type TodayTextProps = {
	children: string;
	role?: keyof typeof todayType;
	tone?: "text" | "secondary" | "error";
};
export type TodayChildrenProps = { children: ReactNode };
export type TodaySectionProps = TodayChildrenProps & { title: string };
export type TodayDisclosureProps = TodayChildrenProps & {
	label: string;
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
	disabled?: boolean;
};
/** Dimensions must come from the actual RN parent onLayout, not the window. */
export type TodaySurfaceProps = TodayChildrenProps & {
	width: number;
	height: number;
};
export const todayColumn = { width: "100%" } as const;

export function assertTodaySize(width: number, height: number) {
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	)
		throw new Error(
			"TodaySurface requires positive finite measured parent width and height",
		);
}

/** Shared implementation is entirely Expo UI; no RN row, text, pressable, or bridge. */
export function createTodayText(
	modifiers: (role: keyof typeof todayType) => Modifiers = () => [],
) {
	return function TodayText({
		children,
		role = "body",
		tone = "text",
	}: TodayTextProps) {
		const theme = usePresentationTheme();
		const type = todayType[role];
		return (
			<Text
				style={todayColumn}
				textStyle={{
					fontSize: type.size,
					fontWeight: type.weight,
					lineHeight: type.leading,
					color: theme[tone],
				}}
				modifiers={modifiers(role)}
			>
				{children}
			</Text>
		);
	};
}
export const TodayText = createTodayText();

/** For an existing native sheet Host/scroller: no Host or scroll owner here. */
export function TodayStack({ children }: TodayChildrenProps) {
	return (
		<Column style={todayColumn} spacing={todaySpace.small}>
			{children}
		</Column>
	);
}
export function TodayRow({
	children,
	separated = false,
}: TodayChildrenProps & { separated?: boolean }) {
	const theme = usePresentationTheme();
	return (
		<Column style={todayColumn}>
			{separated && (
				<Column
					style={{ width: "100%", height: 0.5, backgroundColor: theme.divider }}
				/>
			)}
			<Column
				style={{ width: "100%", paddingHorizontal: 16, paddingVertical: 12 }}
				spacing={8}
			>
				{children}
			</Column>
		</Column>
	);
}
export function TodaySection({ title, children }: TodaySectionProps) {
	const theme = usePresentationTheme();
	return (
		<Column spacing={8} style={todayColumn}>
			{/* biome-ignore lint/a11y/useValidAriaRole: Typography role, not DOM ARIA. */}
			<TodayText role="section">{title}</TodayText>
			<Column style={{ width: "100%", backgroundColor: theme.surface }}>
				{children}
			</Column>
		</Column>
	);
}
/** Single measured Host + universal native ScrollView. Never nest in another scroller. */
export function TodaySurface({ width, height, children }: TodaySurfaceProps) {
	assertTodaySize(width, height);
	return (
		<Host style={{ width, height }}>
			<TodayForm>{children}</TodayForm>
		</Host>
	);
}
/** Native-tree scroll owner for an existing bounded Host. */
export function TodayForm({ children }: TodayChildrenProps) {
	const theme = usePresentationTheme();
	return (
		<ScrollView
			style={{
				width: "100%",
				height: "100%",
				backgroundColor: theme.background,
			}}
		>
			<Column style={{ width: "100%", padding: 16 }} spacing={24}>
				{children}
			</Column>
		</ScrollView>
	);
}
