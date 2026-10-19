import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";
import { SessionRestoring } from "../../components/auth/session-state";
import { useColors } from "../../components/ui";
import { useStore } from "../../lib/store";

export default function TabLayout() {
	const store = useStore();
	const colors = useColors();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		// Keep native insets and system materials: Material You on Android,
		// Liquid Glass on supported iOS, the system tab bar on older releases.
		// ScreenFrame owns tab content titles/top insets, not another Stack.
		<NativeTabs
			key={store.account.id}
			backBehavior="initialRoute"
			labelVisibilityMode="labeled"
			tintColor={Platform.OS === "ios" ? colors.accent : undefined}
		>
			<NativeTabs.Trigger name="home" accessibilityLabel="Today">
				<NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="house.fill" md="home" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings" accessibilityLabel="Settings">
				<NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="gear" md="settings" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
