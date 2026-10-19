import type { ReactNode } from "react";

export type DateFieldPickerProps = {
	anchor: ReactNode;
	label: string;
	visible: boolean;
	value: string;
	maximum: string;
	onSelect(value: string): void;
	onDone(value?: string): void;
	onCancel(): void;
	onDismiss(): void;
};

/** TypeScript/unsupported-platform fallback. Expo resolves the native implementations. */
export function DateFieldPicker({ anchor }: DateFieldPickerProps) {
	return anchor;
}
