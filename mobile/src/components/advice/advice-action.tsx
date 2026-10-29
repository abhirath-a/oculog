import { Button, Host, Icon } from "@expo/ui";
import {
	accessibilityLabel,
	buttonStyle,
	frame,
} from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
export type AdviceActionProps = {
	label: string;
	onPress(): void;
	disabled?: boolean;
	prominent?: boolean;
	iconOnly?: boolean;
	systemImage?: string;
	height?: number;
};

const symbols: Partial<Record<string, ComponentProps<typeof Icon>["name"]>> = {
	"slider.horizontal.3": "slider.horizontal.3",
	ellipsis: "ellipsis",
	"cross.case": "cross.case",
	"square.grid.2x2": "square.grid.2x2",
	"arrow.up": "arrow.up",
};

/** SwiftUI action styling inside an RN-tree Host. */
export function AdviceAction({
	label,
	onPress,
	disabled,
	prominent,
	iconOnly,
	systemImage,
	height = 44,
}: AdviceActionProps) {
	const icon = systemImage ? symbols[systemImage] : undefined;
	return (
		<Host matchContents style={{ minHeight: height, minWidth: 44 }}>
			<Button
				label={label}
				variant={prominent ? "filled" : "outlined"}
				disabled={disabled}
				onPress={() => {
					if (!disabled) onPress();
				}}
				modifiers={[
					buttonStyle(prominent ? "glassProminent" : "glass"),
					frame({ minWidth: 44, minHeight: height }),
					accessibilityLabel(label),
				]}
			>
				{iconOnly && icon ? <Icon name={icon} size={18} /> : undefined}
			</Button>
		</Host>
	);
}
