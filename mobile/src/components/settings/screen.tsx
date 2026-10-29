import { RNHostView } from "@expo/ui";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import {
	ActivityIndicator,
	StyleSheet,
	Text,
	useColorScheme,
	View,
} from "react-native";
import type { SimpleState } from "../../../shared/simple-domain";
import { sessionStore } from "../../lib/api";
import { useStore } from "../../lib/store";
import {
	NativeAction,
	NativePage,
	NativeRow,
	NativeSection,
	NativeStack,
} from "../native-page";
import { useAction } from "../ui";
import SettingsOverview from "./overview";
import { lensSummary } from "./summary";
import { confirmedSignOut, useScheduleSettings } from "./use-schedule-settings";

export type { SettingsModel } from "./use-schedule-settings";
export { useScheduleSettings } from "./use-schedule-settings";

type Palette = {
	background: string;
	card: string;
	border: string;
	primary: string;
	secondary: string;
	accent: string;
	softAccent: string;
	danger: string;
};

function usePalette(): Palette {
	const dark = useColorScheme() === "dark";
	return dark
		? {
				background: "#101116",
				card: "#1C1E25",
				border: "#333640",
				primary: "#F5F6F9",
				secondary: "#A3A7B4",
				accent: "#9EC5FF",
				softAccent: "#273A54",
				danger: "#FF9C9C",
			}
		: {
				background: "#F5F6FA",
				card: "#FFFFFF",
				border: "#E5E7EF",
				primary: "#181B24",
				secondary: "#747987",
				accent: "#2666C8",
				softAccent: "#EBF2FF",
				danger: "#B42338",
			};
}

function AccountPlaceholder() {
	const store = useStore();
	const action = useAction();
	const palette = usePalette();
	const locked = useRef(false);
	const mounted = useRef(true);
	const latest = useRef(store);
	latest.current = store;

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const owner = store.account?.id;
	const token = sessionStore.token;
	const current = () =>
		mounted.current &&
		!!owner &&
		sessionStore.account?.id === owner &&
		sessionStore.token === token;

	return (
		<NativeStack>
			<RNHostView matchContents={{ vertical: true }}>
				<View
					style={[
						styles.surface,
						{ backgroundColor: palette.card, borderColor: palette.border },
					]}
				>
					<View style={styles.accountRow}>
						<View
							style={[styles.avatar, { backgroundColor: palette.softAccent }]}
						>
							<Text style={[styles.avatarText, { color: palette.accent }]}>
								{(store.account?.email?.trim().charAt(0) || "A").toUpperCase()}
							</Text>
						</View>
						<View style={styles.accountText}>
							<Text style={[styles.eyebrow, { color: palette.secondary }]}>
								SIGNED IN AS
							</Text>
							<Text
								style={[styles.accountEmail, { color: palette.primary }]}
								numberOfLines={2}
								selectable
							>
								{store.account?.email || "Account"}
							</Text>
						</View>
					</View>

					{action.error ? (
						<Text
							accessibilityRole="alert"
							style={[styles.errorText, { color: palette.danger }]}
						>
							{action.error}
						</Text>
					) : null}

					<View style={[styles.divider, { backgroundColor: palette.border }]} />
				</View>
			</RNHostView>
			<NativeAction
				label={action.busy ? "Signing out…" : "Sign out"}
				disabled={action.busy || store.pending}
				onPress={() => {
					if (
						locked.current ||
						action.busy ||
						latest.current.pending ||
						!current()
					)
						return;
					locked.current = true;
					void action
						.run(
							() =>
								confirmedSignOut(
									current,
									store.account?.email || "",
									store.logout,
								),
							"",
						)
						.finally(() => {
							locked.current = false;
						});
				}}
			/>
		</NativeStack>
	);
}

function LoadedSettings({ state }: { state: SimpleState }) {
	const model = useScheduleSettings(state);
	const router = useRouter();

	// SettingsOverview already owns the populated settings layout.
	// Do not wrap it in another NativePage or Expo UI Host.
	return (
		<SettingsOverview
			model={{ ...model, timeZone: state.timeZone.replaceAll("_", " ") }}
			summary={lensSummary(state)}
			onEdit={() => {
				if (model.canLeave()) router.push("/lens-editor");
			}}
			onPrescription={() => {
				if (model.canLeave()) router.push("/prescriptions");
			}}
			onNotifications={() => {
				if (model.canLeave()) router.push("/notifications");
			}}
			onWearHistory={() => {
				if (model.canLeave()) router.push("/wear-history");
			}}
		/>
	);
}

function UnavailableSettings() {
	const store = useStore();
	const palette = usePalette();
	const router = useRouter();
	const owner = store.account?.id;
	const token = sessionStore.token;

	return (
		<NativePage title="Settings">
			<NativeSection title="Lens care">
				<NativeRow>
					<RNHostView matchContents={{ vertical: true }}>
						<View
							style={[
								styles.surface,
								styles.statusCard,
								{ backgroundColor: palette.card, borderColor: palette.border },
							]}
						>
							<View
								style={[
									styles.statusIcon,
									{ backgroundColor: palette.softAccent },
								]}
							>
								{store.loading ? (
									<ActivityIndicator size="small" color={palette.accent} />
								) : (
									<Text style={[styles.statusGlyph, { color: palette.accent }]}>
										↻
									</Text>
								)}
							</View>
							<Text style={[styles.statusHeading, { color: palette.primary }]}>
								{store.loading
									? "Loading your lens settings"
									: "Couldn't load your settings"}
							</Text>
							<Text
								style={[styles.statusDescription, { color: palette.secondary }]}
							>
								{store.loading
									? "Syncing your saved schedule and preferences."
									: "Your saved schedule is temporarily unavailable. Check your connection and try again."}
							</Text>
							{!!store.error && (
								<Text
									accessibilityRole="alert"
									style={[styles.errorText, { color: palette.danger }]}
								>
									{store.error}
								</Text>
							)}
						</View>
					</RNHostView>
					{!store.loading && (
						<NativeAction
							label="Try again"
							emphasis="primary"
							disabled={store.pending}
							onPress={() => {
								if (!store.pending) void store.reload();
							}}
						/>
					)}
				</NativeRow>
			</NativeSection>

			{store.account && (
				<NativeSection title="Wear log">
					<NativeRow>
						<NativeAction
							label="Wear history & automatic logging"
							disabled={store.pending}
							onPress={() => {
								if (
									!store.pending &&
									owner === sessionStore.account?.id &&
									token === sessionStore.token
								)
									router.push("/wear-history");
							}}
						/>
					</NativeRow>
				</NativeSection>
			)}
			{store.account && (
				<NativeSection title="On this iPhone">
					<NativeRow>
						<NativeAction
							label="Contact lens prescription"
							disabled={store.pending}
							onPress={() => {
								if (!store.pending) router.push("/prescriptions");
							}}
						/>
						<NativeAction
							label="Notifications"
							disabled={store.pending}
							onPress={() => {
								if (!store.pending) router.push("/notifications");
							}}
						/>
					</NativeRow>
				</NativeSection>
			)}
			{store.account ? (
				<NativeSection title="Account">
					<NativeRow>
						<AccountPlaceholder key={store.account.id} />
					</NativeRow>
				</NativeSection>
			) : null}
		</NativePage>
	);
}

export default function Settings() {
	const store = useStore();
	if (!store.state) return <UnavailableSettings />;
	return <LoadedSettings key={store.account?.id} state={store.state} />;
}

const styles = StyleSheet.create({
	surface: {
		borderRadius: 20,
		borderWidth: StyleSheet.hairlineWidth,
		overflow: "hidden",
	},
	statusCard: {
		alignItems: "center",
		paddingHorizontal: 22,
		paddingVertical: 30,
		gap: 12,
	},
	statusIcon: {
		width: 58,
		height: 58,
		borderRadius: 19,
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 4,
	},
	statusGlyph: { fontSize: 32, fontWeight: "500" },
	statusHeading: {
		fontSize: 20,
		fontWeight: "700",
		textAlign: "center",
		letterSpacing: -0.5,
	},
	statusDescription: { fontSize: 15, lineHeight: 22, textAlign: "center" },
	errorText: { fontSize: 13, lineHeight: 19, marginTop: 3 },
	fullAction: { alignSelf: "stretch", marginTop: 8 },
	accountRow: {
		flexDirection: "row",
		alignItems: "center",
		padding: 16,
		gap: 13,
	},
	avatar: {
		width: 46,
		height: 46,
		borderRadius: 15,
		alignItems: "center",
		justifyContent: "center",
	},
	avatarText: { fontWeight: "700", fontSize: 21 },
	accountText: { flex: 1, gap: 3 },
	eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
	accountEmail: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
	divider: { height: StyleSheet.hairlineWidth, marginLeft: 75 },
});
