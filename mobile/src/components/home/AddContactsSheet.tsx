import { View } from "react-native";
import { NativeSheet, PresentationText } from "../presentation";
import { Button, Feedback, type useAction } from "../ui";
import AddContactsForm from "./AddContactsForm";
import type { AddContactsFormProps } from "./model";

export type AddContactsSheetProps = AddContactsFormProps & {
	presented: boolean;
	busy: boolean;
	onRequestClose(): void;
	onDismiss(): void;
	error: string;
	reloading: boolean;
	onReload(): void;
	action: ReturnType<typeof useAction>;
};

/** iOS/web retain the existing RN form and platform sheet presentation. */
export default function AddContactsSheet(props: AddContactsSheetProps) {
	return (
		<NativeSheet
			presented={props.presented}
			busy={props.busy}
			title="Add spares"
			onRequestClose={props.onRequestClose}
			onDismiss={props.onDismiss}
		>
			<View
				style={{ gap: 16, width: "100%", maxWidth: 560, alignSelf: "center" }}
			>
				{!!props.error && (
					<>
						<PresentationText tone="danger">{props.error}</PresentationText>
						<Button
							title="Retry connection"
							disabled={props.reloading || props.busy}
							onPress={props.onReload}
						/>
					</>
				)}
				<AddContactsForm {...props} />
				<Feedback action={props.action} busyLabel="Adding spares…" />
			</View>
		</NativeSheet>
	);
}
