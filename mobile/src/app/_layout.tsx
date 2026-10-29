import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LocalReminderLifecycle } from "../components/local-reminder-lifecycle";
import { PresentationThemeProvider } from "../components/presentation";
import { useColors } from "../components/ui";
import { Provider } from "../lib/store";

SplashScreen.setOptions({
	duration: 1000,
	fade: true,
});

function Routes() {
	const colors = useColors();
	const scheme = useColorScheme();
	const baseTheme = scheme === "dark" ? DarkTheme : DefaultTheme;
	return (
		<ThemeProvider
			value={{
				...baseTheme,
				colors: {
					...baseTheme.colors,
					background: colors.bg,
					card: colors.card,
					text: colors.text,
					border: colors.line,
					primary: colors.accent,
					notification: colors.danger,
				},
			}}
		>
			<Stack
				screenOptions={{
					contentStyle: { backgroundColor: colors.bg },
					headerStyle: { backgroundColor: colors.card },
					headerTintColor: colors.accent,
					headerTitleStyle: { color: colors.text },
					headerShadowVisible: false,
					headerLargeTitle: false,
					headerBackTitle: "Back",
					headerBackButtonDisplayMode: "minimal",
				}}
			>
				<Stack.Screen name="index" options={{ headerShown: false }} />
				<Stack.Screen
					name="(tabs)"
					options={{ title: "Oculog", headerShown: false }}
				/>
				<Stack.Screen name="auth" options={{ headerShown: false }} />
				<Stack.Screen
					name="practice"
					options={{
						title: "Hygiene practice",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="products"
					options={{
						title: "Products",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="prescriptions"
					options={{
						title: "Prescription",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="notifications"
					options={{
						title: "Notifications",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="wear-history"
					options={{
						title: "Wear history",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="wear-logs"
					options={{
						title: "Wear logs",
						headerShown: false,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="wear-automation"
					options={{
						title: "Automatic logging",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				{/* Router owns stack titles/back navigation; stack-mode ScreenFrame
				 * omits its heading/top inset. Routes own readiness/auth guards. */}
				<Stack.Screen
					name="lens-editor"
					options={{
						title: "Lens setup",
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
				<Stack.Screen
					name="onboarding"
					options={{
						title: "Lens setup",
						headerShown: false,
						headerBackButtonMenuEnabled: false,
					}}
				/>
			</Stack>
			<LocalReminderLifecycle />
		</ThemeProvider>
	);
}
export default function Layout() {
	return (
		<SafeAreaProvider>
			<PresentationThemeProvider>
				<Provider>
					<StatusBar style="auto" />
					<Routes />
				</Provider>
			</PresentationThemeProvider>
		</SafeAreaProvider>
	);
}
