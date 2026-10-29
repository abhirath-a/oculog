import { createElement, Fragment, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export function PresentationThemeProvider({
	children,
}: {
	children: ReactNode;
}) {
	return createElement(Fragment, null, children);
}
export function usePresentationEpoch(): number {
	return 0;
}
export function usePresentationPaletteHold(_busy: boolean): void {}

export type PresentationTheme = {
	background: string;
	surface: string;
	text: string;
	secondary: string;
	divider: string;
	primary: string;
	onPrimary: string;
	error: string;
};

/** RN and native hosts share the same iOS appearance. */
export function usePresentationTheme(): PresentationTheme {
	const dark = useColorScheme() === "dark";
	return dark
		? {
				background: "#000000",
				surface: "#1C1C1E",
				text: "#FFFFFF",
				secondary: "#AEAEB2",
				divider: "#8E8E93",
				primary: "#A4E2CE",
				onPrimary: "#102E2B",
				error: "#FFB3A5",
			}
		: {
				background: "#F2F2F7",
				surface: "#FFFFFF",
				text: "#000000",
				secondary: "#636366",
				divider: "#8E8E93",
				primary: "#1D655C",
				onPrimary: "#FFFFFF",
				error: "#A32C22",
			};
}
