import { useColorScheme } from "react-native";

/** Button-local semantics, not a replacement for the screen palette. */
export function buttonActionColors(dark: boolean) {
	return dark
		? {
				accent: "#A4E2CE",
				onAccent: "#102E2B",
				secondaryFill: "#163C36",
				danger: "#FFB3A5",
				onDanger: "#48130E",
				dangerFill: "#482923",
				muted: "#AEAEB2",
				disabledFill: "#303033",
			}
		: {
				accent: "#1D655C",
				onAccent: "#FFFFFF",
				secondaryFill: "#E4F3EE",
				danger: "#A32C22",
				onDanger: "#FFFFFF",
				dangerFill: "#FCE9E6",
				muted: "#636366",
				disabledFill: "#E5E5EA",
			};
}

export function useButtonActionColors() {
	return buttonActionColors(useColorScheme() === "dark");
}
