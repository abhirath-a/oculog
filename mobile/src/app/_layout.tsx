import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PresentationThemeProvider } from "../components/presentation";
import { useColors } from "../components/ui";
import { Provider } from "../lib/store";

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
				}}
			>
				<Stack.Screen name="index" options={{ headerShown: false }} />
				<Stack.Screen name="(tabs)" options={{ headerShown: false }} />
				<Stack.Screen name="auth" options={{ headerShown: false }} />
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
						headerShown: true,
						headerBackButtonMenuEnabled: false,
					}}
				/>
			</Stack>
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
