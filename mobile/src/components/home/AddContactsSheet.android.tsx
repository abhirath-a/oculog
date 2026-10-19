import { Button, Picker } from "@expo/ui";
import {
	Column,
	Host,
	ModalBottomSheet,
	type ModalBottomSheetRef,
	OutlinedTextField,
	Text,
	TextField,
	useNativeState,
} from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	padding,
	semantics,
	verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState } from "react";
import {
	usePresentationPaletteHold,
	usePresentationTheme,
} from "../presentation/theme";
import type { AddContactsSheetProps } from "./AddContactsSheet";
import { additionHint } from "./model";

/** Inventory-only Compose presentation. No RNHostView or nested matchContents
 * Hosts: Expo's queued Yoga size flush can outlive those Fabric nodes on hide.
 * Keep the outer Host alive and remove the modal only after native hide resolves.
 * The controller, confirmation Alert and AddIntent remain owned by SimpleHome.
 */
export default function AddContactsSheet(props: AddContactsSheetProps) {
	const theme = usePresentationTheme();
	const [mounted, setMounted] = useState(props.presented);
	const sheet = useRef<ModalBottomSheetRef>(null);
	const hiding = useRef(false);
	const quantity = useNativeState(props.quantity);
	usePresentationPaletteHold(props.presented || mounted || props.busy);
	useEffect(() => {
		if (quantity.value !== props.quantity) quantity.value = props.quantity;
	}, [quantity, props.quantity]);
	useEffect(() => {
		if (props.presented) {
			setMounted(true);
			// A new request during hide must reverse native motion as well as
			// cancel JS removal; retaining a hidden modal alone cannot reopen it.
			if (hiding.current) void sheet.current?.expand();
			return;
		}
		let cancelled = false;
		// hide() is the SDK's dismissal-completion boundary, not a timer.
		const completion = sheet.current?.hide();
		if (completion) {
			hiding.current = true;
			void completion.then(() => {
				hiding.current = false;
				if (!cancelled) setMounted(false);
			});
		}
		return () => {
			cancelled = true;
		};
	}, [props.presented]);
	const locked = props.disabled || props.locked;
	return (
		<Host style={{ position: "absolute" }} pointerEvents="none">
			{mounted && (
				<ModalBottomSheet
					ref={sheet}
					skipPartiallyExpanded
					containerColor={theme.surface}
					contentColor={theme.text}
					sheetGesturesEnabled={!props.busy}
					properties={{
						shouldDismissOnBackPress: !props.busy,
						shouldDismissOnClickOutside: !props.busy,
					}}
					onDismissRequest={() => {
						if (!props.busy) props.onDismiss();
					}}
				>
					<Column
						verticalArrangement={{ spacedBy: 16 }}
						modifiers={[
							fillMaxWidth(),
							verticalScroll(),
							padding(16, 8, 16, 24),
						]}
					>
						<Text style={{ typography: "titleLarge" }}>Add spares</Text>
						<Button
							label="Close"
							variant="text"
							disabled={props.busy}
							onPress={() => {
								if (!props.busy) props.onRequestClose();
							}}
						/>
						{!!props.error && (
							<>
								<Text color={theme.error}>{props.error}</Text>
								<Button
									label="Retry connection"
									disabled={props.reloading || props.busy}
									onPress={props.onReload}
								/>
							</>
						)}
						<Text>Add to</Text>
						<Picker
							selectedValue={props.eye}
							enabled={!locked}
							onValueChange={(value) => {
								if (!locked) props.onEyeChange(value);
							}}
						>
							<Picker.Item value="both" label="Both eyes" />
							<Picker.Item value="left" label="Left eye" />
							<Picker.Item value="right" label="Right eye" />
						</Picker>
						<OutlinedTextField
							value={quantity}
							enabled={!locked}
							singleLine
							onValueChange={(value) => {
								if (!locked) props.onQuantityChange(value);
							}}
							keyboardOptions={{ keyboardType: "decimal", imeAction: "done" }}
							modifiers={[
								fillMaxWidth(),
								semantics({
									contentDescription:
										props.eye === "both" ? "Quantity per eye" : "Quantity",
								}),
							]}
						>
							<TextField.Label>
								<Text>
									{props.eye === "both" ? "Quantity per eye" : "Quantity"}
								</Text>
							</TextField.Label>
						</OutlinedTextField>
						<Text color={theme.secondary}>
							{additionHint(props.eye, props.locked)}
						</Text>
						<Button
							label={props.locked ? "Finish adding spares" : "Add spares"}
							disabled={props.disabled}
							onPress={() => {
								if (!props.disabled) props.onAdd();
							}}
						/>
						{props.action.busy && <Text>Adding spares…</Text>}
						{!!props.action.error && (
							<Text color={theme.error}>{props.action.error}</Text>
						)}
						{!!props.action.message && <Text>{props.action.message}</Text>}
					</Column>
				</ModalBottomSheet>
			)}
		</Host>
	);
}
