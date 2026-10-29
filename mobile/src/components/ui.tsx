import { Host } from "@expo/ui";
import type React from "react";
import { useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	KeyboardAvoidingView,
	ScrollView,
	StyleSheet,
	Text,
	type TextStyle,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reportActionFailure } from "../lib/action-guard";
import { errorMessage, sessionStore } from "../lib/api";
import { useStore } from "../lib/store";
import {
	ChoiceControl,
	NativeField,
	type NativeFieldProps,
	usePresentationEpoch,
	usePresentationTheme,
} from "./presentation";
import { ButtonControl, SwitchControl } from "./ui-controls";

export function useColors() {
	const theme = usePresentationTheme();
	return {
		bg: theme.background,
		card: theme.surface,
		text: theme.text,
		muted: theme.secondary,
		line: theme.divider,
		accent: theme.primary,
		onAccent: theme.onPrimary,
		danger: theme.error,
	};
}
export const styles = StyleSheet.create({
	page: { flex: 1 },
	content: {
		padding: 16,
		gap: 16,
		paddingBottom: 20,
		width: "100%",
		maxWidth: 960,
		alignSelf: "center",
	},
	title: { fontSize: 28, fontWeight: "600", letterSpacing: -0.5 },
	heading: { fontSize: 19, fontWeight: "600" },
	text: { fontSize: 16, lineHeight: 24 },
	small: { fontSize: 13, lineHeight: 20 },
	// Plain section, not an oversized decorative card. Native forms own grouping.
	card: { paddingVertical: 12, gap: 8 },
	row: {
		flexDirection: "row",
		gap: 10,
		flexWrap: "wrap",
		alignItems: "center",
	},
	button: {
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 6,
		minHeight: 48,
		alignItems: "center",
		justifyContent: "center",
	},
	input: {
		borderWidth: 1,
		borderRadius: 4,
		padding: 10,
		fontSize: 16,
		minHeight: 44,
	},
	label: { fontSize: 14, fontWeight: "500", marginBottom: 4 },
});
export function Txt({
	children,
	muted = false,
	small = false,
	heading = false,
}: {
	children: React.ReactNode;
	muted?: boolean;
	small?: boolean;
	heading?: boolean;
}) {
	const colors = useColors();
	let textStyle: TextStyle = styles.text;
	if (small) textStyle = styles.small;
	if (heading) textStyle = styles.heading;
	return (
		<Text
			selectable
			allowFontScaling
			dynamicTypeRamp={heading ? "headline" : small ? "caption1" : "body"}
			accessibilityRole={heading ? "header" : undefined}
			style={[textStyle, { color: muted ? colors.muted : colors.text }]}
		>
			{children}
		</Text>
	);
}
export function Button({
	title,
	onPress,
	secondary = false,
	danger = false,
	disabled = false,
	variant,
	fullWidth = false,
	glass = false,
}: {
	title: string;
	onPress: () => void;
	secondary?: boolean;
	danger?: boolean;
	disabled?: boolean;
	variant?: "filled" | "outlined" | "text";
	fullWidth?: boolean;
	/** Interactive chrome only; never applied to fields or content surfaces. */
	glass?: boolean;
}) {
	const colors = useColors();
	const paletteEpoch = usePresentationEpoch();
	const appearance = variant ?? (secondary ? "outlined" : "filled");
	return (
		<Host
			key={paletteEpoch}
			matchContents={fullWidth ? { vertical: true } : true}
			style={fullWidth ? { width: "100%" } : undefined}
			ignoreSafeArea="all"
			seedColor={danger ? colors.danger : colors.accent}
		>
			<ButtonControl
				title={title}
				onPress={onPress}
				disabled={disabled}
				appearance={appearance}
				fullWidth={fullWidth}
				glass={glass}
				colors={colors}
				danger={danger}
			/>
		</Host>
	);
}
export function Card({ children }: { children: React.ReactNode }) {
	const colors = useColors();
	return (
		<View
			style={[
				styles.card,
				{
					borderBottomWidth: StyleSheet.hairlineWidth,
					borderColor: colors.line,
				},
			]}
		>
			{children}
		</View>
	);
}
/** RN-tree compatibility wrapper. Native forms use NativeField directly. */
export function Field(props: NativeFieldProps) {
	const paletteEpoch = usePresentationEpoch();
	return (
		<Host
			key={paletteEpoch}
			matchContents={{ vertical: true }}
			ignoreSafeArea="all"
			style={{ width: "100%" }}
		>
			<NativeField {...props} />
		</Host>
	);
}
export function Choices({
	label,
	value,
	options,
	onChange,
	multi = false,
	disabled = false,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (v: string) => void;
	multi?: boolean;
	disabled?: boolean;
}) {
	const selectedValues = value.split(",").filter(Boolean);
	function toggleOption(optionValue: string) {
		const nextValues = selectedValues.includes(optionValue)
			? selectedValues.filter((selected) => selected !== optionValue)
			: [...selectedValues, optionValue];
		onChange(nextValues.join(","));
	}
	return (
		<View style={{ gap: 8 }}>
			{multi && <Txt small>{label}</Txt>}
			{multi ? (
				<View style={styles.row}>
					{options.map((option) => {
						const selected = selectedValues.includes(option.value);
						return (
							<Button
								key={option.value}
								title={selected ? `✓ ${option.label}` : option.label}
								secondary={!selected}
								disabled={disabled}
								onPress={() => toggleOption(option.value)}
							/>
						);
					})}
				</View>
			) : (
				<ChoiceControl
					label={label}
					value={value}
					options={options}
					disabled={disabled}
					onChange={onChange}
				/>
			)}
		</View>
	);
}

export function Toggle({
	label,
	value,
	disabled,
	onChange,
}: {
	label: string;
	value: boolean;
	disabled: boolean;
	onChange: (value: boolean) => void;
}) {
	const colors = useColors();
	const paletteEpoch = usePresentationEpoch();
	return (
		<Host
			key={paletteEpoch}
			matchContents
			ignoreSafeArea="all"
			seedColor={colors.accent}
		>
			<SwitchControl
				label={label}
				value={value}
				disabled={disabled}
				onChange={onChange}
			/>
		</Host>
	);
}
export function Page({
	title,
	subtitle,
	children,
	managedInsets = false,
	contentPaddingTop = 20,
	contentPaddingBottom = 28,
	showHeading = true,
}: {
	title: string;
	subtitle?: string;
	children: React.ReactNode;
	/** NativeTabs already adjusts the ScrollView for system bars. */
	managedInsets?: boolean;
	/** Content spacing, independent of system safe-area insets. */
	contentPaddingTop?: number;
	contentPaddingBottom?: number;
	/** Custom welcome screens supply their own single heading. */
	showHeading?: boolean;
}) {
	const colors = useColors();
	const store = useStore();
	const insets = useSafeAreaInsets();
	return (
		<KeyboardAvoidingView
			style={[styles.page, { backgroundColor: colors.bg }]}
			behavior="padding"
		>
			<ScrollView
				keyboardShouldPersistTaps="handled"
				contentContainerStyle={[
					styles.content,
					{
						paddingTop: contentPaddingTop + (managedInsets ? 0 : insets.top),
						paddingBottom:
							contentPaddingBottom + (managedInsets ? 0 : insets.bottom),
					},
				]}
			>
				{showHeading && (
					<View style={{ gap: 4 }}>
						<Text
							accessibilityRole="header"
							style={[styles.title, { color: colors.text }]}
						>
							{title}
						</Text>
						{subtitle && (
							<Txt small muted>
								{subtitle}
							</Txt>
						)}
					</View>
				)}
				{store.account && store.error && (
					<Card>
						<Txt>{store.error}</Txt>
						<Txt small muted>
							Displayed records may be stale. Refresh before saving.
						</Txt>
						<Button
							title="Retry connection"
							onPress={() => void store.reload()}
						/>
					</Card>
				)}
				{!store.account && store.error && (
					<View style={{ gap: 8 }} accessibilityLiveRegion="assertive">
						<Text
							accessibilityRole="alert"
							style={[styles.text, { color: colors.danger }]}
						>
							{store.error}
						</Text>
						<Txt small muted>
							Your session could not be restored. You can sign in again below.
						</Txt>
					</View>
				)}
				{store.loading && (
					<View style={styles.row} accessibilityLiveRegion="polite">
						<ActivityIndicator accessibilityLabel="Loading records" />
						<Txt small muted>
							Updating your journal… Your saved entries stay visible.
						</Txt>
					</View>
				)}
				{children}
			</ScrollView>
		</KeyboardAvoidingView>
	);
}
export async function confirm(title: string, message: string) {
	return new Promise<boolean>((resolve) =>
		Alert.alert(
			title,
			message,
			[
				{ text: "Cancel", style: "cancel", onPress: () => resolve(false) },
				{ text: "Confirm", onPress: () => resolve(true) },
			],
			{ cancelable: true, onDismiss: () => resolve(false) },
		),
	);
}
export function useAction() {
	const store = useStore();
	const locked = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	return {
		busy,
		error,
		message,
		clearFeedback: () => {
			if (locked.current) return;
			setError("");
			setMessage("");
		},
		run: async (fn: () => Promise<unknown>, success = "Saved") => {
			if (locked.current) return;
			locked.current = true;
			const session = {
				owner: sessionStore.account?.id,
				token: sessionStore.token,
			};
			setBusy(true);
			setError("");
			setMessage("");
			try {
				const result = await fn();
				if (result !== false) setMessage(success);
			} catch (e) {
				reportActionFailure(
					e,
					session,
					{ owner: sessionStore.account?.id, token: sessionStore.token },
					store.connectionFailed,
					() => setError(errorMessage(e)),
				);
			} finally {
				locked.current = false;
				setBusy(false);
			}
		},
	};
}
export function Feedback({
	action,
	busyLabel = "Saving changes…",
}: {
	action: ReturnType<typeof useAction>;
	busyLabel?: string;
}) {
	const colors = useColors();
	return (
		<>
			{action.busy && (
				<View style={styles.row} accessibilityLiveRegion="polite">
					<ActivityIndicator accessibilityLabel={busyLabel} />
					<Txt small muted>
						{busyLabel}
					</Txt>
				</View>
			)}
			{!!action.error && (
				<Text
					accessibilityRole="alert"
					accessibilityLiveRegion="assertive"
					style={[styles.text, { color: colors.danger }]}
				>
					{action.error}
				</Text>
			)}
			{!!action.message && (
				<Text
					accessibilityLiveRegion="polite"
					style={[styles.text, { color: colors.text }]}
				>
					{action.message}
				</Text>
			)}
		</>
	);
}
