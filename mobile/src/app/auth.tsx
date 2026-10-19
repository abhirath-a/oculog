import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import type { AuthInputHandle } from "../components/auth/field";
import { FormField } from "../components/auth/form-field";
import { AuthIntro } from "../components/auth/intro";
import { PresentationText, ScreenFrame } from "../components/presentation";
import { usePresentationPaletteHold } from "../components/presentation/theme";
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
	const store = useStore();
	const action = useAction();
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
	// A synchronous guard also covers taps/IME events before React commits busy.
	const pending = useRef(false);
	const register = mode === "register";
	const disabled = !store.ready || action.busy;
	const submitLabel = register ? "Create account" : "Sign in";
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
	// Route changes are the trigger, not busy/mode/feedback changes. Keep the
	// current guard without reapplying the route mode while the user edits.
	const routeChangeMode = useRef(changeMode);
	routeChangeMode.current = changeMode;
	useEffect(() => {
		if (isMode(params.mode)) routeChangeMode.current(params.mode);
	}, [params.mode]);

	async function submit() {
		if (!store.ready) return false;
		const accepted = await authenticate(mode, {
			email: email.trim(),
			password,
			...(register ? { displayName: name, timeZone: deviceTimeZone() } : {}),
		});
		if (!accepted) return false;
		Keyboard.dismiss();
		store.syncAuth();
		router.replace(register ? "/onboarding" : "/");
	}
	function startSubmit() {
		if (!store.ready || action.busy || pending.current) return;
		// Match backend/main.py credentials: Unicode code-point length and Python's
		// whitespace set, not a stricter browser/RFC email validator. Validate the
		// trimmed value actually sent to authenticate; leave normalization to the API.
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

	return (
		<ScreenFrame title="" insetMode="standalone" scrollOwner="frame">
			<View
				style={{ width: "100%", maxWidth: 480, alignSelf: "center", gap: 20 }}
			>
				<AuthIntro title={submitLabel} />
				<View style={{ gap: 16 }}>
					{register && (
						<FormField
							label="Name"
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
						label="Email"
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
						hint={register ? "Use at least 8 characters." : undefined}
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
				<View style={{ gap: 12 }}>
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
							<PresentationText tone="danger">{store.error}</PresentationText>
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
								if (!pending.current) void store.reload();
							}}
						/>
					)}
					{!!store.account && (
						<Button
							title="Sign out"
							variant="text"
							disabled={disabled}
							onPress={() => {
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
							}}
						/>
					)}
				</View>
				<View style={{ alignItems: "center", gap: 0 }}>
					<PresentationText tone="secondary">
						{register ? "Already have an account?" : "No account?"}
					</PresentationText>
					<Button
						title={register ? "Sign in" : "Create account"}
						variant="text"
						disabled={disabled}
						fullWidth
						onPress={() => changeMode(register ? "login" : "register")}
					/>
				</View>
			</View>
		</ScreenFrame>
	);
}
