import { Redirect, Tabs } from "expo-router";
import { Image, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SessionRestoring } from "../../components/auth/session-state";
import { useColors } from "../../components/ui";
import { useStore } from "../../lib/store";

function TabIcon({
	color,
	settings = false,
}: {
	color: string;
	settings?: boolean;
}) {
	const paths = settings
		? '<path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2-1 3 2 3-2v-3l3-2-1-3-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/>'
		: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3Z"/>';
	const uri = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round">${paths}</svg>`)}`;
	return (
		<Image
			accessible={false}
			aria-hidden
			accessibilityElementsHidden
			source={{ uri }}
			style={{ width: 23, height: 23 }}
		/>
	);
}

export default function WebTabLayout() {
	const store = useStore();
	const colors = useColors();
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();
	const desktop = width >= 1000;
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			<View
				style={{
					flex: 1,
					width: "100%",
					maxWidth: 1200,
					alignSelf: "center",
					borderLeftWidth: desktop ? 1 : 0,
					borderRightWidth: desktop ? 1 : 0,
					borderColor: colors.line,
				}}
			>
				<Tabs
					key={store.account.id}
					initialRouteName="home"
					screenOptions={{
						headerShown: false,
						animation: "none",
						tabBarPosition: desktop ? "top" : "bottom",
						tabBarLabelPosition: desktop ? "beside-icon" : "below-icon",
						tabBarActiveTintColor: colors.accent,
						tabBarInactiveTintColor: colors.muted,
						tabBarLabelStyle: {
							fontSize: 13,
							fontWeight: "600",
							flexShrink: 0,
						},
						tabBarAllowFontScaling: true,
						tabBarItemStyle: { maxWidth: 220, minHeight: 48 },
						tabBarStyle: {
							// Size the bar from its contents, including enlarged labels.
							height: "auto",
							backgroundColor: colors.card,
							borderTopWidth: desktop ? 0 : 1,
							borderBottomWidth: desktop ? 1 : 0,
							borderColor: colors.line,
							minHeight: desktop ? 64 + insets.top : 66 + insets.bottom,
							paddingTop: 8 + (desktop ? insets.top : 0),
							paddingBottom: 8 + (desktop ? 0 : insets.bottom),
							// Stretch the inner tab row so labels share the available width.
							alignItems: "stretch",
						},
						sceneStyle: { backgroundColor: colors.bg },
					}}
				>
					<Tabs.Screen
						name="home"
						options={{
							title: "Today",
							tabBarAccessibilityLabel: "Today",
							tabBarIcon: ({ color }) => <TabIcon color={String(color)} />,
						}}
					/>
					<Tabs.Screen
						name="settings"
						options={{
							title: "Settings",
							tabBarAccessibilityLabel: "Settings",
							tabBarIcon: ({ color }) => (
								<TabIcon color={String(color)} settings />
							),
						}}
					/>
				</Tabs>
			</View>
		</View>
	);
}
