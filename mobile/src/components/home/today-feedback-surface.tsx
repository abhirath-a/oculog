import { Button, Column, Icon, Row, Text } from "@expo/ui";
import { ProgressView } from "@expo/ui/swift-ui";
import {
	background,
	buttonStyle,
	controlSize,
	fixedSize,
	font,
	frame,
	shadow,
	shapes,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { usePresentationTheme } from "../presentation/theme";
import type { Notice } from "./today-feedback";

export type TodayFeedbackSurfaceProps = { notice: Notice; onDismiss(): void };

/** Native SwiftUI material and SF Symbols, not an outlined form/card surface. */
export default function TodayFeedbackSurface({
	notice,
	onDismiss,
}: TodayFeedbackSurfaceProps) {
	const theme = usePresentationTheme();
	return (
		<Column
			style={{ width: "100%", paddingHorizontal: 16, paddingVertical: 12 }}
			modifiers={[
				background(
					{ type: "material", material: "regular" },
					shapes.roundedRectangle({ cornerRadius: 24 }),
				),
				shadow({ color: "#00000022", radius: 12, y: 4 }),
			]}
		>
			<Row alignment="center" spacing={12} style={{ width: "100%" }}>
				{notice.kind === "pending" ? (
					<ProgressView
						modifiers={[frame({ width: 22, height: 22 }), tint(theme.primary)]}
					/>
				) : (
					<Icon
						name={
							notice.kind === "success"
								? "checkmark.circle.fill"
								: "exclamationmark.circle.fill"
						}
						size={22}
						color={notice.kind === "error" ? theme.error : theme.primary}
					/>
				)}
				<Text
					textStyle={{ color: theme.text }}
					modifiers={[
						font({ textStyle: "subheadline", weight: "semibold" }),
						fixedSize({ horizontal: false, vertical: true }),
						frame({ maxWidth: Infinity, alignment: "leading" }),
					]}
				>
					{notice.text}
				</Text>
				{notice.kind === "error" && (
					<Button
						variant="outlined"
						onPress={onDismiss}
						modifiers={[
							buttonStyle("bordered"),
							controlSize("regular"),
							tint(theme.primary),
						]}
					>
						<Text
							textStyle={{ color: theme.text }}
							modifiers={[
								font({ textStyle: "subheadline" }),
								frame({ minWidth: 44, minHeight: 44 }),
							]}
						>
							Dismiss
						</Text>
					</Button>
				)}
			</Row>
		</Column>
	);
}
