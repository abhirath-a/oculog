import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { sessionStore } from "../lib/api";
import { type Eye, positiveInteger } from "../lib/simple-controller";
import { useStore } from "../lib/store";
import AddContactsSheet from "./home/AddContactsSheet";
import { AddIntent, dateHeading } from "./home/add-intent";
import HomeContent from "./home/HomeContent";
import { notifySuccess, PresentationText, ScreenFrame } from "./presentation";
import { Button, confirm, Feedback, useAction } from "./ui";

export default function SimpleHome() {
	const store = useStore();
	const action = useAction();
	const addAction = useAction();
	const router = useRouter();
	const [showAdd, setShowAdd] = useState(false);
	const [eye, setEye] = useState("both");
	const [quantity, setQuantity] = useState("1");
	const added = useRef(new AddIntent());
	const owner = store.account?.id ?? "";
	const sessionToken = sessionStore.token;
	const currentOwner = useRef(owner);
	currentOwner.current = owner;
	useEffect(() => {
		currentOwner.current = owner;
		return () => {
			currentOwner.current = "";
		};
	}, [owner]);
	const disabled =
		!store.online ||
		store.loading ||
		store.pending ||
		action.busy ||
		addAction.busy;
	const saving = store.pending || action.busy || addAction.busy;
	const state = store.state;
	const openSettings = () => router.push("/lens-editor");

	function isCurrentSession() {
		return (
			currentOwner.current === owner && sessionStore.token === sessionToken
		);
	}

	async function addContacts() {
		if (disabled || !isCurrentSession()) return false;
		const count = positiveInteger(quantity);
		// A partial success already confirmed this immutable intent. Retry only
		// its unfinished eyes; never reset the AddIntent ledger on dismissal.
		if (
			added.current.completed.size === 0 &&
			!(await confirm(
				"Add spares?",
				`Add ${count} ${count === 1 ? "spare" : "spares"} ${eye === "both" ? "to each eye" : `to your ${eye} eye`}? This does not change your current lenses.`,
			))
		)
			return false;
		if (!isCurrentSession()) return false;
		const saved = await added.current.save(
			owner,
			eye,
			count,
			(target, amount) =>
				isCurrentSession()
					? store.mutate("add", { eye: target, quantity: amount })
					: Promise.resolve(false),
		);
		if (!saved || !isCurrentSession()) return false;
		setShowAdd(false);
		await notifySuccess().catch(() => {});
		return true;
	}

	function isOpening(target: Eye) {
		return (
			state?.eyes.some(
				(settings) =>
					settings.eye === target &&
					settings.replacementDays !== null &&
					settings.openedOn === null,
			) ?? false
		);
	}

	async function replaceLens(target: Eye) {
		if (disabled || !isCurrentSession()) return false;
		const opening = isOpening(target);
		if (
			!(await confirm(
				`${opening ? "Open" : "Replace"} ${target} lens?`,
				opening
					? "Opening uses one spare and records your account’s current calendar date as the opening date. Your replacement interval starts on that date."
					: "This uses one spare and starts a new calendar interval today.",
			))
		)
			return false;
		if (!isCurrentSession()) return false;
		const saved = await store.mutate("replace", { eye: target });
		if (saved && isCurrentSession()) await notifySuccess().catch(() => {});
		return saved;
	}

	function logToday(worn: boolean) {
		if (!state || disabled) return;
		void action.run(async () => {
			if (!isCurrentSession()) return false;
			const saved = await store.mutate("day", { localDate: state.today, worn });
			if (saved && isCurrentSession()) await notifySuccess().catch(() => {});
			return saved;
		}, "Daily log saved.");
	}

	function closeSheet() {
		if (!saving) setShowAdd(false);
	}

	function dismissSheet() {
		// Native dismissal changes presentation only; retain the draft and retry ledger.
		setShowAdd(false);
	}

	return (
		<ScreenFrame
			title="Today"
			subtitle={dateHeading(state?.today)}
			insetMode="tabs"
			scrollOwner="content"
		>
			{!showAdd && <Feedback action={action} />}
			{!showAdd && !addAction.busy && (
				<Feedback action={addAction} busyLabel="Adding spares…" />
			)}
			{(!store.online || store.loading || !!store.error || !state) && (
				<View style={{ gap: 12 }} accessibilityLiveRegion="polite">
					<PresentationText tone="secondary">
						{store.loading
							? "Refreshing your records…"
							: state
								? "Showing your last records. Reconnect before saving."
								: "Your records are not available yet."}
					</PresentationText>
					{!!store.error && (
						<PresentationText tone="danger">{store.error}</PresentationText>
					)}
					<Button
						title="Retry connection"
						disabled={store.loading || saving}
						onPress={() => void store.reload()}
					/>
				</View>
			)}
			{state && (
				<HomeContent
					state={state}
					disabled={disabled}
					pairedEyes={false}
					onLog={logToday}
					onSettings={openSettings}
					onAdd={() => setShowAdd(true)}
					onReplace={(target) =>
						void action.run(
							() => replaceLens(target),
							isOpening(target) ? "Lens opened." : "Lens replaced.",
						)
					}
				/>
			)}
			<AddContactsSheet
				presented={showAdd}
				busy={saving}
				onRequestClose={closeSheet}
				onDismiss={dismissSheet}
				eye={eye}
				quantity={quantity}
				onEyeChange={setEye}
				onQuantityChange={setQuantity}
				disabled={disabled}
				locked={added.current.completed.size > 0}
				onAdd={() => void addAction.run(addContacts, "Spares added.")}
				error={
					!store.online || store.error
						? store.error || "Reconnect before adding spares."
						: ""
				}
				reloading={store.loading}
				onReload={() => void store.reload()}
				action={addAction}
			/>
		</ScreenFrame>
	);
}
