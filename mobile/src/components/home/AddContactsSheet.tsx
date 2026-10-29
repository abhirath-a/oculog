// biome-ignore-all lint/a11y/useValidAriaRole: TodayText role is typography.
import { Column, Host, Row } from "@expo/ui";
import { BottomSheet, Group } from "@expo/ui/swift-ui";
import {
	interactiveDismissDisabled,
	presentationBackground,
	presentationDetents,
} from "@expo/ui/swift-ui/modifiers";
import {
	usePresentationPaletteHold,
	usePresentationTheme,
} from "../presentation/theme";
import type { useAction } from "../ui";
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

import {
	TodayAction,
	TodayForm,
	TodayRow,
	TodaySection,
	TodayText,
} from "./today-design";

/** Native sheet proposal bounds one native Form. No RN bridge, window width or inner scroller. */
export default function AddContactsSheet(props: AddContactsSheetProps) {
	const theme = usePresentationTheme();
	usePresentationPaletteHold(props.presented || props.busy);
	return (
		<Host style={{ position: "absolute", width: 0, height: 0 }}>
			<BottomSheet
				isPresented={props.presented}
				onIsPresentedChange={(presented) => {
					// Native intent is blocked below. Unexpected actual dismissal still informs
					// the owner while busy, retaining its controlled draft and retry ledger.
					if (!presented) props.onDismiss();
				}}
			>
				<Group
					modifiers={[
						interactiveDismissDisabled(props.busy),
						presentationDetents(["large"]),
						presentationBackground(theme.background),
					]}
				>
					<TodayForm>
						<TodaySection title="">
							<TodayRow>
								<Row style={{ width: "100%" }} alignment="center">
									<Column style={{ width: "60%" }}>
										<TodayText role="headline">Add spares</TodayText>
									</Column>
									<Column style={{ width: "40%" }}>
										<TodayAction
											label="Cancel"
											disabled={props.busy}
											onPress={() => {
												if (!props.busy) props.onRequestClose();
											}}
										/>
									</Column>
								</Row>
							</TodayRow>
						</TodaySection>
						{!!props.error && (
							<TodaySection title="Connection">
								<TodayRow>
									<TodayText tone="error">{props.error}</TodayText>
									<TodayAction
										label="Retry connection"
										disabled={props.reloading || props.busy}
										onPress={() => {
											if (!props.reloading && !props.busy) props.onReload();
										}}
									/>
								</TodayRow>
							</TodaySection>
						)}
						<AddContactsForm {...props} />
						{(props.action.busy ||
							!!props.action.error ||
							!!props.action.message) && (
							<TodaySection title="Status">
								<TodayRow>
									{props.action.busy && <TodayText>Adding spares…</TodayText>}
									{!!props.action.error && (
										<TodayText tone="error">{props.action.error}</TodayText>
									)}
									{!!props.action.message && (
										<TodayText>{props.action.message}</TodayText>
									)}
								</TodayRow>
							</TodaySection>
						)}
					</TodayForm>
				</Group>
			</BottomSheet>
		</Host>
	);
}
