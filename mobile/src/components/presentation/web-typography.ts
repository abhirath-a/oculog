import type { CSSProperties } from "react";

/** Shared only by browser adapters. Relative leading follows text-only zoom. */
export const webTypography = {
	fontFamily:
		'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"',
	fontSize: "1rem",
	lineHeight: 1.5,
} satisfies CSSProperties;
