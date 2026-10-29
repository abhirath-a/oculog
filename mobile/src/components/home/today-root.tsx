import { useState } from "react";
import { View } from "react-native";
import type { HomeContentProps } from "./model";
import TodayContent from "./today-content";
import { TodaySurface } from "./today-design";

/** Only RN boundary: actual ScreenFrame content measurement, never window dimensions. */
export default function TodayRoot(props: HomeContentProps) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	return (
		<View
			style={{ flex: 1, width: "100%", minWidth: 0 }}
			onLayout={({ nativeEvent: { layout } }) => {
				if (
					layout.width > 0 &&
					layout.height > 0 &&
					Number.isFinite(layout.width) &&
					Number.isFinite(layout.height)
				) {
					setSize((previous) =>
						previous?.width === layout.width &&
						previous.height === layout.height
							? previous
							: { width: layout.width, height: layout.height },
					);
				}
			}}
		>
			{size && (
				<TodaySurface width={size.width} height={size.height}>
					<TodayContent {...props} />
				</TodaySurface>
			)}
		</View>
	);
}
