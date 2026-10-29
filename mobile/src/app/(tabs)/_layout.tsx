import { Redirect } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { SessionRestoring } from "../../components/auth/session-state";
import { useColors } from "../../components/ui";
import { useStore } from "../../lib/store";

export default function TabLayout() {
	const store = useStore();
	const colors = useColors();
	if (!store.ready) return <SessionRestoring />;
	if (!store.account) return <Redirect href="/auth" />;
	return (
		// Keep native insets and system materials: Liquid Glass on supported
		// iOS, the system tab bar on older releases.
		// ScreenFrame owns tab content titles/top insets, not another Stack.
		<NativeTabs
			key={store.account.id}
			backBehavior="initialRoute"
			labelVisibilityMode="labeled"
			tintColor={colors.accent}
		>
			<NativeTabs.Trigger name="home" accessibilityLabel="Today">
				<NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="house.fill" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="logs" accessibilityLabel="Logs">
				<NativeTabs.Trigger.Label>Logs</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="calendar" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="advice" accessibilityLabel="Advice">
				<NativeTabs.Trigger.Label>Advice</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="bubble.left.and.bubble.right" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="learn" accessibilityLabel="Learn">
				<NativeTabs.Trigger.Label>Learn</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="book" />
			</NativeTabs.Trigger>
			<NativeTabs.Trigger name="settings" accessibilityLabel="Account">
				<NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
				<NativeTabs.Trigger.Icon sf="gear" />
			</NativeTabs.Trigger>
		</NativeTabs>
	);
}
