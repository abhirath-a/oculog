// biome-ignore-all lint/a11y/useValidAriaRole: NativeText roles select typography, not ARIA.
import { Button, Column, type TextInputRef } from "@expo/ui";
import { frame } from "@expo/ui/swift-ui/modifiers";
import { randomUUID } from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { sessionStore } from "../../lib/api";
import {
	notificationContextReady,
	reminderManager,
} from "../../lib/local-reminders/runtime";
import {
	calendarDaysBetween,
	deviceCalendarDate,
} from "../../lib/prescriptions/calendar";
import { createPrescriptionController } from "../../lib/prescriptions/controller";
import { prescriptionRepository } from "../../lib/prescriptions/device-repository";
import {
	draftFromPrescription,
	type EyeValues,
	emptyDraft,
	type PrescriptionDraft,
} from "../../lib/prescriptions/model";
import {
	cleanupPrescriptionImages,
	importPrescriptionImage,
	ocrAvailable,
	scannerAvailable,
	scanPrescription,
} from "../../lib/prescriptions/ocr";
import NativeInput from "../native-input";
import {
	NativeAction,
	NativeDisclosure,
	NativePage,
	NativeRow,
	NativeSection,
	NativeStack,
	NativeText,
	PageToggle,
} from "../native-page";
import { usePresentationTheme } from "../presentation/theme";
import { ExpiryField } from "./expiry-field";

const FIELDS: {
	key: keyof EyeValues;
	label: string;
	placeholder: string;
	unit: string;
}[] = [
	{
		key: "sphere",
		label: "SPH / PWR",
		placeholder: "For example -2.25 or Plano",
		unit: "D",
	},
	{
		key: "cylinder",
		label: "CYL",
		placeholder: "For example -0.75",
		unit: "D",
	},
	{ key: "axis", label: "AXIS", placeholder: "For example 180", unit: "°" },
	{ key: "baseCurve", label: "BC", placeholder: "For example 8.6", unit: "mm" },
	{
		key: "diameter",
		label: "DIA",
		placeholder: "For example 14.2",
		unit: "mm",
	},
	{
		key: "add",
		label: "ADD",
		placeholder: "For example +1.50 or Low",
		unit: "D",
	},
	{
		key: "lensName",
		label: "Lens name / brand",
		placeholder: "Only if printed on the prescription",
		unit: "",
	},
];
function display(value: string, unit: string) {
	if (!value) return "Not recorded";
	return `${value}${unit && /^[+\-\d.]+$/.test(value) ? ` ${unit}` : ""}`;
}
function expiryText(expires: string | null, today: string) {
	if (!expires)
		return "Expiry unknown — no renewal reminders can be scheduled.";
	const days = calendarDaysBetween(today, expires);
	return days < 0
		? `Expired ${expires}. Book an eye-care appointment; do not extend the prescription yourself.`
		: days === 0
			? "Expires today. Contact your eye-care professional about renewal."
			: `Expires ${expires} · ${days} ${days === 1 ? "day" : "days"} remaining${days <= 30 ? ". Book an appointment before it expires." : "."}`;
}

export default function PrescriptionScreen({ owner }: { owner: string }) {
	const router = useRouter();
	const theme = usePresentationTheme();
	const currentSession = useCallback(
		() =>
			sessionStore.isValid && sessionStore.account?.id === owner
				? { owner, sessionKey: JSON.stringify([owner, sessionStore.token]) }
				: { owner: null, sessionKey: null },
		[owner],
	);
	const [controller] = useState(() =>
		createPrescriptionController(prescriptionRepository, currentSession),
	);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getState,
		controller.getState,
	);
	const reminders = useSyncExternalStore(
		reminderManager.subscribe,
		reminderManager.getState,
		reminderManager.getState,
	);
	const [editing, setEditing] = useState(false);
	const [contactConfirmed, setContactConfirmed] = useState(false);
	const [reviewConfirmed, setReviewConfirmed] = useState(false);
	const [enableRenewal, setEnableRenewal] = useState(false);
	const [renewalChanged, setRenewalChanged] = useState(false);
	const [deleteConfirm, setDeleteConfirm] = useState(false);
	const [help, setHelp] = useState(false);
	const [notice, setNotice] = useState("");
	const [operationError, setOperationError] = useState("");
	const [operation, setOperation] = useState<"scan" | "save" | "delete" | null>(
		null,
	);
	const [today, setToday] = useState(() => deviceCalendarDate(new Date()));
	const fields = useRef<Record<string, TextInputRef | null>>({});
	const mounted = useRef(false);
	const ticket = useRef(0);
	const locked = useRef(false);
	const editingRef = useRef(editing);
	editingRef.current = editing;
	useFocusEffect(
		useCallback(() => {
			if (!editingRef.current) void controller.load();
		}, [controller]),
	);
	const renderLease = currentSession().sessionKey;
	const validRender = () =>
		!!renderLease && currentSession().sessionKey === renderLease;
	usePreventRemove(operation === "save" || operation === "delete", () => {});
	useEffect(() => {
		mounted.current = true;
		controller.mount();
		void controller.load();
		let lease = currentSession().sessionKey;
		const unsubscribe = sessionStore.onChange(() => {
			const next = currentSession().sessionKey;
			if (next === lease) return;
			lease = next;
			ticket.current++;
			locked.current = false;
			controller.syncSession();
			setEditing(false);
			setOperation(null);
			setDeleteConfirm(false);
			setContactConfirmed(false);
			setReviewConfirmed(false);
			setRenewalChanged(false);
			setNotice("");
			if (next) void controller.load();
			void cleanupPrescriptionImages().catch(() => {});
		});
		const timer = setInterval(
			() => setToday(deviceCalendarDate(new Date())),
			30000,
		);
		return () => {
			mounted.current = false;
			ticket.current++;
			locked.current = false;
			unsubscribe();
			clearInterval(timer);
			controller.dispose();
			void cleanupPrescriptionImages().catch(() => {});
		};
	}, [controller, currentSession]);
	const blur = () => {
		for (const input of Object.values(fields.current)) input?.blur();
	};
	const change = (draft: PrescriptionDraft) => {
		if (!validRender() || operation === "save" || operation === "delete")
			return;
		controller.setDraft(draft);
		setReviewConfirmed(false);
		setNotice("");
	};
	const startEditing = () => {
		if (!validRender() || state.busy || state.loading) return;
		controller.setDraft(
			state.record ? draftFromPrescription(state.record) : emptyDraft(),
		);
		setEditing(true);
		setContactConfirmed(!!state.record);
		setReviewConfirmed(false);
		setEnableRenewal(reminders.preferences.prescription.enabled);
		setRenewalChanged(false);
		setDeleteConfirm(false);
		setNotice("");
	};
	const perform = async (
		kind: "scan" | "save" | "delete",
		work: (valid: () => boolean) => Promise<void>,
	) => {
		if (locked.current || state.loading || state.busy || !validRender()) return;
		locked.current = true;
		const key = ++ticket.current;
		const lease = currentSession().sessionKey;
		const valid = () =>
			mounted.current &&
			key === ticket.current &&
			currentSession().sessionKey === lease;
		setOperation(kind);
		setNotice("");
		setOperationError("");
		try {
			await work(valid);
		} catch {
			if (valid())
				setOperationError(
					"The local operation could not finish. Your saved details were not intentionally removed; reload to check before retrying.",
				);
		} finally {
			if (valid()) {
				locked.current = false;
				setOperation(null);
			}
		}
	};
	const scan = (camera: boolean) =>
		void perform("scan", async (valid) => {
			let received = false;
			await controller.scan(async () => {
				const result = camera
					? await scanPrescription()
					: await importPrescriptionImage();
				if (!result)
					throw Object.assign(new Error("Scanning was cancelled."), {
						code: "OCR_CANCELLED",
					});
				received = true;
				return result;
			});
			if (valid() && !controller.getState().error && received) {
				setEditing(true);
				setContactConfirmed(false);
				setReviewConfirmed(false);
				setEnableRenewal(reminders.preferences.prescription.enabled);
				setRenewalChanged(false);
				setNotice(
					"Unconfirmed suggestions only. Keep the original nearby and check every value, sign, eye and date.",
				);
			}
		});
	const save = () =>
		void perform("save", async (valid) => {
			blur();
			const now = new Date();
			await controller.save({
				id: state.record?.id ?? randomUUID(),
				now,
				contactLensConfirmed: contactConfirmed,
				reviewConfirmed,
			});
			const record = controller.getState().record;
			if (
				!valid() ||
				controller.getState().error ||
				record?.confirmedAt !== now.toISOString()
			)
				return;
			setEditing(false);
			setReviewConfirmed(false);
			setNotice("Saved securely on this iPhone. Nothing was uploaded.");
			if (renewalChanged) {
				const prefs = reminderManager.getState().preferences;
				await reminderManager.updatePreferences({
					...prefs,
					prescription: { ...prefs.prescription, enabled: enableRenewal },
				});
				if (
					valid() &&
					enableRenewal &&
					reminderManager.getState().permission !== "granted"
				)
					setNotice(
						"Prescription saved. Renewal alerts are not active without iOS notification permission; check Notifications.",
					);
			}
		});
	const remove = () =>
		void perform("delete", async (valid) => {
			await controller.remove();
			if (valid() && !controller.getState().error) {
				setEditing(false);
				setDeleteConfirm(false);
				setNotice(
					"Local prescription deleted. Its renewal reminders are being cleared; check Notifications for any scheduling error.",
				);
			}
		});
	const blocked = state.loading || state.busy || !!operation;
	const fieldDisabled =
		state.loading || operation === "save" || operation === "delete";
	const hasDetails =
		!!state.draft.expiresOn ||
		[
			...Object.values(state.draft.right),
			...Object.values(state.draft.left),
		].some((v) => !!v.trim());
	return (
		<NativePage title="Prescription" insetMode="stack">
			<NativeSection title="Only on this iPhone">
				<NativeRow>
					<NativeText tone="secondary">
						One current contact-lens prescription for your signed-in account.
						Images are temporary and cleaned up after scanning; raw OCR text is
						not stored. Nothing is uploaded. Signing out pauses reminders but
						does not delete the saved prescription.
					</NativeText>
					{!ocrAvailable() && (
						<NativeText tone="secondary">
							Offline OCR requires an iOS development build with Apple Vision.
							Expo Go supports manual entry, not scanning.
						</NativeText>
					)}
					{state.loading && (
						<NativeText>Reading your local prescription…</NativeText>
					)}
					{!!state.error && <NativeText tone="error">{state.error}</NativeText>}
					{!!notice && <NativeText>{notice}</NativeText>}
					{!!operationError && (
						<NativeText tone="error">{operationError}</NativeText>
					)}
					{!!reminders.error && (
						<NativeText tone="error">{`Local reminders: ${reminders.error}`}</NativeText>
					)}
					{reminders.busy && (
						<NativeText tone="secondary">
							Refreshing local reminders…
						</NativeText>
					)}
					<NativeAction
						label="Notification settings"
						disabled={blocked}
						onPress={() => {
							if (validRender() && !blocked) router.push("/notifications");
						}}
					/>
				</NativeRow>
			</NativeSection>
			{!editing && (
				<NativeSection
					title={
						state.record ? "Confirmed prescription" : "Add your prescription"
					}
				>
					<NativeRow>
						{state.record && (
							<NativeText
								tone={
									state.record.expiresOn &&
									calendarDaysBetween(today, state.record.expiresOn) <= 0
										? "error"
										: "text"
								}
							>
								{expiryText(state.record.expiresOn, today)}
							</NativeText>
						)}
						<NativeAction
							label={
								state.record
									? "Edit prescription"
									: "Enter prescription manually"
							}
							emphasis="primary"
							disabled={blocked}
							onPress={startEditing}
						/>
						<NativeAction
							label={
								operation === "scan"
									? "Reading prescription…"
									: state.record
										? "Scan a replacement prescription"
										: "Scan prescription"
							}
							disabled={blocked || !scannerAvailable()}
							onPress={() => scan(true)}
						/>
						<NativeAction
							label="Import prescription image"
							disabled={blocked || !ocrAvailable()}
							onPress={() => scan(false)}
						/>
						<NativeText tone="secondary">
							Use a clear image or up to three camera-scanned pages. OCR can
							miss minus signs or mix columns. Review is always required; no
							expiry is inferred from an issue date.
						</NativeText>
						{!!state.error && (
							<NativeAction
								label="Reload local prescription"
								disabled={blocked}
								onPress={() => void controller.load()}
							/>
						)}
					</NativeRow>
				</NativeSection>
			)}
			{!editing &&
				state.record &&
				(["right", "left"] as const).map((side) => (
					<NativeSection
						key={side}
						title={side === "right" ? "Right eye · OD" : "Left eye · OS"}
					>
						<NativeRow>
							{FIELDS.map((field) => (
								<NativeText
									key={field.key}
									role={field.key === "sphere" ? "headline" : "body"}
								>{`${field.label}: ${display(state.record?.[side][field.key] ?? "", field.unit)}`}</NativeText>
							))}
						</NativeRow>
					</NativeSection>
				))}
			{editing && (
				<>
					<NativeSection title="Review before saving">
						<NativeRow>
							<NativeText>
								Compare with the original. Blank means not recorded, not zero.
								Keep OD/right and OS/left separate.
							</NativeText>
							{state.warnings.map((warning) => (
								<NativeText key={warning} tone="secondary">
									{warning}
								</NativeText>
							))}
							<Button
								label="Hide keyboard"
								variant="text"
								onPress={blur}
								modifiers={[frame({ minHeight: 44 })]}
							/>
						</NativeRow>
					</NativeSection>
					{(["right", "left"] as const).map((side) => (
						<NativeSection
							key={side}
							title={side === "right" ? "Right eye · OD" : "Left eye · OS"}
						>
							{FIELDS.map((field) => (
								<NativeRow key={field.key}>
									<Column
										style={{
											width: "100%",
											padding: 12,
											borderWidth: 1,
											borderColor: theme.divider,
											borderRadius: 10,
										}}
									>
										<NativeInput
											label={`${side === "right" ? "Right" : "Left"} ${field.label}${field.unit ? ` (${field.unit})` : ""}`}
											value={state.draft[side][field.key]}
											placeholder={field.placeholder}
											keyboardType={
												field.key === "lensName" ||
												field.key === "add" ||
												field.key === "sphere"
													? "default"
													: "numbers-and-punctuation"
											}
											maxLength={field.key === "lensName" ? 48 : 16}
											autoCorrect={false}
											autoCapitalize="none"
											disabled={fieldDisabled}
											inputRef={(ref) => {
												fields.current[`${side}.${field.key}`] = ref;
											}}
											onChange={(value) => {
												const draft = controller.getState().draft;
												change({
													...draft,
													[side]: { ...draft[side], [field.key]: value },
												});
											}}
										/>
									</Column>
								</NativeRow>
							))}
						</NativeSection>
					))}
					<NativeSection title="Prescription expiry">
						<NativeRow>
							{state.expiryCandidates.map((candidate) => (
								<NativeAction
									key={candidate.date}
									label={`Use ${candidate.date}: ${candidate.label}`}
									disabled={fieldDisabled}
									onPress={() =>
										change({
											...controller.getState().draft,
											expiresOn: candidate.date,
										})
									}
								/>
							))}
							<ExpiryField
								value={state.draft.expiresOn}
								disabled={fieldDisabled}
								onChange={(value) =>
									change({ ...controller.getState().draft, expiresOn: value })
								}
							/>
						</NativeRow>
					</NativeSection>
					<NativeSection title="Confirm the original">
						<NativeRow>
							<PageToggle
								label="This is a contact-lens prescription, not a glasses prescription"
								value={contactConfirmed}
								disabled={fieldDisabled}
								onChange={(value) => {
									if (validRender()) setContactConfirmed(value);
								}}
							/>
							<PageToggle
								label="I checked both eyes, signs, values and expiry (or confirmed it is unknown) against the original"
								value={reviewConfirmed}
								disabled={fieldDisabled}
								onChange={(value) => {
									if (validRender()) setReviewConfirmed(value);
								}}
							/>
							<PageToggle
								label="Enable renewal reminders after saving"
								value={
									renewalChanged
										? enableRenewal
										: reminders.preferences.prescription.enabled
								}
								disabled={
									fieldDisabled ||
									!notificationContextReady() ||
									reminders.loading ||
									reminders.busy ||
									(!state.draft.expiresOn &&
										!(renewalChanged
											? enableRenewal
											: reminders.preferences.prescription.enabled))
								}
								onChange={(value) => {
									if (validRender()) {
										setEnableRenewal(value);
										setRenewalChanged(true);
									}
								}}
							/>
							<NativeText tone="secondary">
								Renewal reminders use the confirmed expiry only: normally 30 and
								7 days before. iOS permission is requested only if you enable
								reminders. Unknown or expired dates cannot create future renewal
								alerts.
							</NativeText>
							<NativeAction
								label={
									operation === "save"
										? "Saving…"
										: "Save confirmed prescription"
								}
								emphasis="primary"
								disabled={
									blocked ||
									!contactConfirmed ||
									!reviewConfirmed ||
									!hasDetails
								}
								onPress={save}
							/>
							<NativeAction
								label="Cancel edits"
								disabled={operation === "save" || operation === "delete"}
								onPress={() => {
									if (
										!validRender() ||
										operation === "save" ||
										operation === "delete"
									)
										return;
									blur();
									controller.setDraft(
										state.record
											? draftFromPrescription(state.record)
											: emptyDraft(),
									);
									setEditing(false);
									setReviewConfirmed(false);
									setNotice("");
								}}
							/>
						</NativeRow>
					</NativeSection>
				</>
			)}
			{!editing && state.record && (
				<NativeSection title="Remove local data">
					<NativeRow>
						{deleteConfirm ? (
							<>
								<NativeText>
									Delete this prescription from this iPhone? This does not
									delete the original image in Files or Photos.
								</NativeText>
								<NativeAction
									label="Delete prescription"
									emphasis="primary"
									danger
									disabled={blocked}
									onPress={remove}
								/>
								<NativeAction
									label="Keep prescription"
									disabled={blocked}
									onPress={() => setDeleteConfirm(false)}
								/>
							</>
						) : (
							<NativeAction
								label="Delete prescription…"
								danger
								disabled={blocked}
								onPress={() => setDeleteConfirm(true)}
							/>
						)}
					</NativeRow>
				</NativeSection>
			)}
			<NativeSection title="Understand the fields">
				<NativeRow>
					<NativeDisclosure
						label="OD, OS and prescription abbreviations"
						expanded={help}
						onExpandedChange={setHelp}
					>
						<NativeStack>
							<NativeText>
								OD is the right eye; OS is the left eye. SPH/PWR is spherical
								lens power in diopters (D). CYL is cylinder power, used with an
								AXIS orientation in degrees. BC is base curve in millimetres;
								DIA is diameter. ADD may be a near-add power or a manufacturer’s
								named level.
							</NativeText>
							<NativeText>
								Missing values do not mean no correction. This summary is a
								reading aid, not a new prescription or clinical validation. Do
								not change powers, substitute products, extend the expiry or
								extend lens wear based on it. Ask your prescriber if anything is
								unclear.
							</NativeText>
						</NativeStack>
					</NativeDisclosure>
				</NativeRow>
			</NativeSection>
		</NativePage>
	);
}
