import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
	Keyboard,
	PlatformColor,
	StyleSheet,
	Text,
	useWindowDimensions,
	View,
} from "react-native";
import { AuthCard, AuthModePicker } from "../components/auth/auth-surface";
import type { AuthInputHandle } from "../components/auth/field";
import { FormField } from "../components/auth/form-field";
import { PresentationText, ScreenFrame } from "../components/presentation";
import {
	usePresentationPaletteHold,
	usePresentationTheme,
} from "../components/presentation/theme";
import { Button, Feedback, useAction } from "../components/ui";
import { authenticate } from "../lib/api";
import { deviceTimeZone } from "../lib/simple-controller";
import { useStore } from "../lib/store";

type Mode = "login" | "register";

function isMode(value: unknown): value is Mode {
	return value === "login" || value === "register";
}

export default function Auth() {
	const params = useLocalSearchParams<{ mode?: string }>();
	const { width: screenWidth } = useWindowDimensions();

	const store = useStore();
	const action = useAction();
	const theme = usePresentationTheme();

	usePresentationPaletteHold(action.busy);

	const [mode, setMode] = useState<Mode>(
		isMode(params.mode) ? params.mode : "login",
	);
	const [email, setEmail] = useState(store.account?.email || "");
	const [password, setPassword] = useState("");
	const [repeat, setRepeat] = useState("");
	const [name, setName] = useState("");
	const [emailError, setEmailError] = useState("");
	const [passwordError, setPasswordError] = useState("");
	const [repeatError, setRepeatError] = useState("");

	const emailRef = useRef<AuthInputHandle>(null);
	const passwordRef = useRef<AuthInputHandle>(null);
	const repeatRef = useRef<AuthInputHandle>(null);
	const pending = useRef(false);

	const register = mode === "register";
	const disabled = !store.ready || action.busy;
	const submitLabel = register ? "Create account" : "Sign in";

	const contentWidth = Math.min(440, Math.max(280, screenWidth - 40));

	function clearFieldErrors() {
		setEmailError("");
		setPasswordError("");
		setRepeatError("");
	}

	function changeMode(next: Mode) {
		if (pending.current || action.busy || next === mode) return;

		Keyboard.dismiss();
		action.clearFeedback();
		setMode(next);
		clearFieldErrors();
		setPassword("");
		setRepeat("");
	}

	const routeChangeMode = useRef(changeMode);
	routeChangeMode.current = changeMode;

	useEffect(() => {
		if (isMode(params.mode)) {
			routeChangeMode.current(params.mode);
		}
	}, [params.mode]);

	async function submit() {
		if (!store.ready) return false;

		const accepted = await authenticate(mode, {
			email: email.trim(),
			password,
			...(register
				? {
						displayName: name,
						timeZone: deviceTimeZone(),
					}
				: {}),
		});

		if (!accepted) return false;

		Keyboard.dismiss();
		store.syncAuth();
		router.replace(register ? "/onboarding" : "/");
	}

	function startSubmit() {
		if (!store.ready || action.busy || pending.current) return;

		const address = email.trim();
		const whitespace =
			"\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

		const normalized = address.replace(
			new RegExp(`^[${whitespace}]+|[${whitespace}]+$`, "gu"),
			"",
		);

		const part = `[^${whitespace}@]+`;

		if (
			Array.from(address).length > 254 ||
			!new RegExp(`^${part}@${part}\\.${part}$`, "u").test(normalized)
		) {
			setEmailError("Enter a valid email address.");
			emailRef.current?.focus();
			return;
		}

		if (password.length < 8) {
			setPasswordError("Password must be at least 8 characters.");
			passwordRef.current?.focus();
			return;
		}

		if (register && password !== repeat) {
			setRepeatError("Passwords do not match.");
			repeatRef.current?.focus();
			return;
		}

		pending.current = true;

		void action
			.run(submit, register ? "Account created." : "Signed in.")
			.finally(() => {
				pending.current = false;
			});
	}

	function signOut() {
		if (pending.current || action.busy) return;

		pending.current = true;

		void action
			.run(async () => {
				await store.logout();
				setMode("login");
				setPassword("");
				setRepeat("");
				clearFieldErrors();
			}, "Signed out.")
			.finally(() => {
				pending.current = false;
			});
	}

	return (
		<ScreenFrame title="" insetMode="standalone" scrollOwner="frame">
			<View style={styles.page}>
				<View style={[styles.content, { width: contentWidth }]}>
					{/* Page heading */}
					<View style={styles.header}>
						<Text style={styles.brand}>OCULOG</Text>

						<Text style={styles.title}>
							{register
								? "Track your\ncontact lenses."
								: "Your daily\nlens routine."}
						</Text>

						<PresentationText tone="secondary">
							{register
								? "Know when each lens is due for replacement. Log daily wear with a quick yes or no."
								: "Log today’s wear and check your replacement dates. Sign in to pick up where you left off."}
						</PresentationText>
					</View>

					{/* Native SwiftUI card */}
					<AuthCard width={contentWidth}>
						<AuthModePicker
							mode={mode}
							disabled={disabled}
							onChange={changeMode}
						/>

						<View style={styles.fields}>
							{register && (
								<FormField
									label="Your name"
									value={name}
									onChange={setName}
									autoComplete="name"
									autoCapitalize="words"
									disabled={disabled}
									returnKeyType="next"
									onSubmitEditing={() => emailRef.current?.focus()}
								/>
							)}

							<FormField
								label="Email address"
								value={email}
								onChange={(value) => {
									setEmail(value);
									setEmailError("");
								}}
								inputRef={emailRef}
								error={emailError}
								keyboardType="email-address"
								autoComplete="email"
								disabled={disabled}
								returnKeyType="next"
								onSubmitEditing={() => passwordRef.current?.focus()}
							/>

							<FormField
								key={mode}
								label="Password"
								secure
								value={password}
								onChange={(value) => {
									setPassword(value);
									setPasswordError("");
								}}
								inputRef={passwordRef}
								autoComplete={register ? "new-password" : "current-password"}
								disabled={disabled}
								returnKeyType={register ? "next" : "done"}
								error={passwordError}
								hint={register ? "At least 8 characters" : undefined}
								onSubmitEditing={
									register ? () => repeatRef.current?.focus() : startSubmit
								}
							/>

							{register && (
								<FormField
									label="Confirm password"
									secure
									value={repeat}
									onChange={(value) => {
										setRepeat(value);
										setRepeatError("");
									}}
									inputRef={repeatRef}
									autoComplete="new-password"
									disabled={disabled}
									error={repeatError}
									returnKeyType="done"
									onSubmitEditing={startSubmit}
								/>
							)}
						</View>

						<View style={styles.actions}>
							{!store.ready && (
								<PresentationText tone="secondary">
									Restoring your session…
								</PresentationText>
							)}

							<Feedback
								action={action}
								busyLabel={register ? "Creating account…" : "Signing in…"}
							/>

							{!!store.error && (
								<View accessibilityLiveRegion="assertive">
									<PresentationText tone="danger">
										{store.error}
									</PresentationText>

									{!store.account && (
										<PresentationText tone="secondary">
											Your session could not be restored. You can sign in again.
										</PresentationText>
									)}
								</View>
							)}

							<Button
								title={
									action.busy
										? register
											? "Creating account…"
											: "Signing in…"
										: submitLabel
								}
								disabled={disabled}
								onPress={startSubmit}
								fullWidth
							/>

							{!!store.error && (
								<Button
									title="Retry connection"
									variant="text"
									disabled={disabled}
									onPress={() => {
										if (!pending.current) {
											void store.reload();
										}
									}}
								/>
							)}
						</View>
					</AuthCard>

					{!!store.account && (
						<View style={styles.footer}>
							<Button
								title="Sign out"
								variant="text"
								disabled={disabled}
								onPress={signOut}
							/>
						</View>
					)}
				</View>
			</View>
		</ScreenFrame>
	);
}

const styles = StyleSheet.create({
	page: {
		width: "100%",
		alignItems: "center",
		paddingTop: 44,
		paddingBottom: 36,
	},
	content: {
		gap: 26,
	},
	header: {
		gap: 9,
		paddingHorizontal: 4,
	},
	brand: {
		fontSize: 11,
		fontWeight: "700",
		letterSpacing: 2.2,
		color: PlatformColor("secondaryLabel"),
		marginBottom: 5,
	},
	title: {
		fontSize: 34,
		lineHeight: 41,
		fontWeight: "700",
		letterSpacing: -1.2,
		color: PlatformColor("label"),
	},
	fields: {
		gap: 17,
	},
	actions: {
		gap: 12,
	},
	footer: {
		alignItems: "center",
		paddingTop: 2,
	},
});
