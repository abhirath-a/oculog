import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import type { SimpleState } from "../../shared/simple-domain";
import { sessionStore } from "../lib/api";
import { useStore } from "../lib/store";
import { PresentationText, ScreenFrame } from "./presentation";
import SettingsOverview from "./settings/overview";
import { lensSummary } from "./settings/summary";
import {
	confirmedSignOut,
	useScheduleSettings,
} from "./settings/use-schedule-settings";
import { Button, useAction } from "./ui";

export type { SettingsModel } from "./settings/use-schedule-settings";
export { useScheduleSettings } from "./settings/use-schedule-settings";

function UnavailableAccount() {
	const store = useStore();
	const action = useAction();
	const locked = useRef(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const latest = useRef(store);
	latest.current = store;
	const owner = store.account?.id;
	const token = sessionStore.token;
	const current = () =>
		mounted.current &&
		!!owner &&
		sessionStore.account?.id === owner &&
		sessionStore.token === token;
	return (
		<View style={{ gap: 12 }}>
			<PresentationText>{store.account?.email || ""}</PresentationText>
			{!!action.error && (
				<PresentationText tone="danger">{action.error}</PresentationText>
			)}
			<Button
				title="Sign out"
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
		</View>
	);
}

function LoadedSettings({ state }: { state: SimpleState }) {
	const model = useScheduleSettings(state);
	const router = useRouter();
	return (
		<SettingsOverview
			model={{ ...model, timeZone: state.timeZone.replaceAll("_", " ") }}
			summary={lensSummary(state)}
			onEdit={() => {
				if (model.canLeave()) router.push("/lens-editor");
			}}
		/>
	);
}

export default function Settings() {
	const store = useStore();
	if (!store.state)
		return (
			<ScreenFrame title="Settings" insetMode="tabs" scrollOwner="frame">
				<View style={{ gap: 12 }} accessibilityLiveRegion="polite">
					<PresentationText heading>
						{store.loading
							? "Loading your schedule"
							: "Your schedule is unavailable"}
					</PresentationText>
					<PresentationText tone="secondary">
						{store.loading
							? "Getting your saved lens settings."
							: "Connect to load your saved lens settings."}
					</PresentationText>
					{store.account && <UnavailableAccount key={store.account.id} />}
					{store.loading ? (
						<ActivityIndicator accessibilityLabel="Loading settings" />
					) : (
						<>
							{!!store.error && (
								<View accessibilityRole="alert">
									<PresentationText tone="danger">
										{store.error}
									</PresentationText>
								</View>
							)}
							<Button
								title="Retry connection"
								disabled={store.pending}
								onPress={() => void store.reload()}
							/>
						</>
					)}
				</View>
			</ScreenFrame>
		);
	return <LoadedSettings key={store.account?.id} state={store.state} />;
}
