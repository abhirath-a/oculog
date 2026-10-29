import { type ColorValue, Image } from "react-native";

/** Alpha-mask rendition of assets/logo.svg. Native tint supplies currentColor for fill AND stroke. */
export function BrandWordmark({ color }: { color: ColorValue }) {
	return (
		<Image
			source={require("./wordmark-mask.png")}
			accessibilityLabel="Oculog"
			accessibilityRole="image"
			accessible
			resizeMode="contain"
			tintColor={color}
			style={{ width: 112, height: (112 * 94) / 359, flexShrink: 0 }}
		/>
	);
}
