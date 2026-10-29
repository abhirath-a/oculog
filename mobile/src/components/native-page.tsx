// biome-ignore-all lint/a11y/useValidAriaRole: Native typography roles, not DOM ARIA.
import { Column, Picker, Switch } from "@expo/ui";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import {
	TodayAction,
	TodayDisclosure,
	TodayRow,
	TodaySection,
	TodayStack,
	TodaySurface,
	TodayText,
} from "./home/today-design";
import { ScreenFrame } from "./presentation/screen-frame";

// Reuse the established native-tree design contract without duplicating platform
// Form/Section/button implementations or changing Today and its validated adapters.
export {
	TodayAction as NativeAction,
	TodayDisclosure as NativeDisclosure,
	TodayRow as NativeRow,
	TodaySection as NativeSection,
	TodayStack as NativeStack,
	TodayText as NativeText,
};

export function NativeContent({ children }: { children: ReactNode }) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	return (
		<View
			style={{ flex: 1, minWidth: 0, minHeight: 0, width: "100%" }}
			onLayout={({ nativeEvent: { layout } }) => {
				if (
					Number.isFinite(layout.width) &&
					Number.isFinite(layout.height) &&
					layout.width > 0 &&
					layout.height > 0
				)
					setSize((previous) =>
						previous?.width === layout.width &&
						previous.height === layout.height
							? previous
							: { width: layout.width, height: layout.height },
					);
			}}
		>
			{size && (
				<TodaySurface width={size.width} height={size.height}>
					{children}
				</TodaySurface>
			)}
		</View>
	);
}
export function NativePage({
	title,
	subtitle,
	insetMode = "tabs",
	children,
	overlay,
}: {
	title: string;
	subtitle?: string;
	insetMode?: "tabs" | "stack";
	children: ReactNode;
	overlay?: ReactNode;
}) {
	return (
		<ScreenFrame
			title={title}
			subtitle={subtitle}
			insetMode={insetMode}
			scrollOwner="content"
		>
			<NativeContent>{children}</NativeContent>
			{overlay}
		</ScreenFrame>
	);
}
export function PageText({
	children,
	heading,
	tone,
}: {
	children: string;
	heading?: boolean;
	tone?: "danger" | "secondary" | "primary";
}) {
	return (
		<TodayText
			role={heading ? "headline" : tone === "secondary" ? "secondary" : "body"}
			tone={
				tone === "danger"
					? "error"
					: tone === "secondary"
						? "secondary"
						: "text"
			}
		>
			{children}
		</TodayText>
	);
}
export function PageToggle({
	label,
	value,
	disabled = false,
	onChange,
}: {
	label: string;
	value: boolean;
	disabled?: boolean;
	onChange(value: boolean): void;
}) {
	return (
		<Switch
			label={label}
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				if (!disabled) onChange(next);
			}}
		/>
	);
}
export function PagePicker({
	label,
	value,
	disabled = false,
	options,
	onChange,
}: {
	label: string;
	value: string;
	disabled?: boolean;
	options: { value: string; label: string }[];
	onChange(value: string): void;
}) {
	return (
		<Column spacing={8} style={{ width: "100%" }}>
			<TodayText>{label}</TodayText>
			<Picker
				selectedValue={value}
				enabled={!disabled}
				onValueChange={(next) => {
					if (!disabled) onChange(next);
				}}
			>
				{options.map((option) => (
					<Picker.Item
						key={option.value}
						value={option.value}
						label={option.label}
					/>
				))}
			</Picker>
		</Column>
	);
}
