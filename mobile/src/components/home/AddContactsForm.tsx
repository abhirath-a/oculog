// biome-ignore-all lint/a11y/useValidAriaRole: TodayText role is typography.
import { Column, Picker, Row } from "@expo/ui";
import { type AddContactsFormProps, additionHint } from "./model";
import { todayQuantityError } from "./today-add-model";
import { TodayAction, TodayRow, TodaySection, TodayText } from "./today-design";
import TodayQuantity from "./today-quantity";

/** Native-tree grouped fields. Caller owns the one Host and Form/scroller. */
export default function AddContactsForm({
	eye,
	quantity,
	onEyeChange,
	onQuantityChange,
	disabled,
	locked,
	onAdd,
}: AddContactsFormProps) {
	const inputsLocked = disabled || locked;
	const error = todayQuantityError(quantity);
	const submitDisabled = disabled || !!error;
	return (
		<TodaySection title="Spares">
			<TodayRow>
				<Row style={{ width: "100%" }} alignment="center">
					<Column style={{ width: "50%" }}>
						<TodayText>Add to</TodayText>
					</Column>
					<Column style={{ width: "50%" }}>
						<Picker
							selectedValue={eye}
							enabled={!inputsLocked}
							onValueChange={(value) => {
								if (!inputsLocked) onEyeChange(value);
							}}
						>
							<Picker.Item value="both" label="Both eyes" />
							<Picker.Item value="left" label="Left eye" />
							<Picker.Item value="right" label="Right eye" />
						</Picker>
					</Column>
				</Row>
			</TodayRow>
			<TodayRow separated>
				<TodayText>
					{eye === "both" ? "Quantity per eye" : "Quantity"}
				</TodayText>
				<TodayQuantity
					label={eye === "both" ? "Quantity per eye" : "Quantity"}
					value={quantity}
					disabled={inputsLocked}
					onChange={(value) => {
						if (!inputsLocked) onQuantityChange(value);
					}}
				/>
				{!!error && <TodayText tone="error">{error}</TodayText>}
			</TodayRow>
			<TodayRow separated>
				<TodayText role="secondary" tone="secondary">
					{additionHint(eye, locked)}
				</TodayText>
			</TodayRow>
			<TodayRow separated>
				<TodayAction
					label={locked ? "Finish adding spares" : "Add spares"}
					emphasis="primary"
					disabled={submitDisabled}
					onPress={() => {
						if (!submitDisabled) onAdd();
					}}
				/>
			</TodayRow>
		</TodaySection>
	);
}
