// biome-ignore-all lint/a11y/useValidAriaRole: NativeText role selects typography, not an ARIA role.
import {
	NativeAction,
	NativePage,
	NativeRow,
	NativeSection,
	NativeText,
} from "../native-page";
import EditorLink from "./editor-link";
import { supportingLines } from "./overview-summary";
import type { SettingsModel } from "./use-schedule-settings";

export type SettingsOverviewProps = {
	model: SettingsModel;
	summary: string;
	onEdit(): void;
	onPrescription?(): void;
	onNotifications?(): void;
	onWearHistory?(): void;
};

/** Presentation only. The outer Settings screen owns store access and routing. */
export default function SettingsOverview({
	model: m,
	summary,
	onEdit,
	onPrescription,
	onNotifications,
	onWearHistory,
}: SettingsOverviewProps) {
	return (
		<NativePage title="Account">
			<NativeSection title="Lenses">
				<NativeRow>
					<NativeText role="headline">Lens setup</NativeText>
					{supportingLines(summary).map((line) => (
						<NativeText key={line} tone="secondary">
							{line}
						</NativeText>
					))}
					<EditorLink disabled={m.accountDisabled} onEdit={onEdit} />
				</NativeRow>
			</NativeSection>
			{onWearHistory && (
				<NativeSection title="Wear log">
					<NativeRow>
						<NativeAction
							label="Wear history & automatic logging"
							disabled={m.accountDisabled}
							onPress={() => {
								if (!m.accountDisabled) onWearHistory();
							}}
						/>
						<NativeText tone="secondary">
							Review missed days and separately marked assumptions. Your wear
							log is saved to your account.
						</NativeText>
					</NativeRow>
				</NativeSection>
			)}
			{(onPrescription || onNotifications) && (
				<NativeSection title="On this iPhone">
					<NativeRow>
						{onPrescription && (
							<NativeAction
								label="Contact lens prescription"
								disabled={m.accountDisabled}
								onPress={() => {
									if (!m.accountDisabled) onPrescription();
								}}
							/>
						)}
						{onNotifications && (
							<NativeAction
								label="Notifications"
								disabled={m.accountDisabled}
								onPress={() => {
									if (!m.accountDisabled) onNotifications();
								}}
							/>
						)}
						<NativeText tone="secondary">
							Prescription details and reminder preferences stay on this device.
						</NativeText>
					</NativeRow>
				</NativeSection>
			)}
			<NativeSection title="Account">
				<NativeRow>
					<NativeText role="headline">Email</NativeText>
					<NativeText>{m.email}</NativeText>
				</NativeRow>
				<NativeRow>
					<NativeText role="headline">Calendar time zone</NativeText>
					<NativeText>{m.timeZone}</NativeText>
				</NativeRow>
				<NativeRow>
					<NativeAction
						label="Sign out"
						disabled={m.accountDisabled}
						onPress={() => {
							if (!m.accountDisabled) m.signOut();
						}}
					/>
					{!!m.accountError && (
						<NativeText tone="error">{m.accountError}</NativeText>
					)}
				</NativeRow>
			</NativeSection>
			{!!m.connectionError && (
				<NativeSection title="Connection">
					<NativeRow>
						<NativeText tone="error">{m.connectionError}</NativeText>
						<NativeAction
							label="Retry connection"
							disabled={m.loading || m.accountDisabled}
							onPress={() => {
								if (!m.loading && !m.accountDisabled) m.reload();
							}}
						/>
					</NativeRow>
				</NativeSection>
			)}
		</NativePage>
	);
}
