// biome-ignore-all lint/a11y/useValidAriaRole: PresentationText role is a typography token, not a DOM ARIA role.
import { ChoiceControl, PresentationText } from "../presentation";
import { Button, Field } from "../ui";
import { type AddContactsFormProps, additionHint } from "./model";

export default function AddContactsForm({
	eye,
	quantity,
	onEyeChange,
	onQuantityChange,
	disabled,
	locked,
	onAdd,
}: AddContactsFormProps) {
	return (
		<>
			<ChoiceControl
				label="Add to"
				value={eye}
				onChange={onEyeChange}
				disabled={disabled || locked}
				options={[
					{ value: "both", label: "Both eyes" },
					{ value: "left", label: "Left eye" },
					{ value: "right", label: "Right eye" },
				]}
			/>
			<Field
				label={eye === "both" ? "Quantity per eye" : "Quantity"}
				value={quantity}
				disabled={disabled || locked}
				onChange={onQuantityChange}
				keyboardType="decimal-pad"
			/>
			<PresentationText role="callout" tone="secondary">
				{additionHint(eye, locked)}
			</PresentationText>
			<Button
				title={locked ? "Finish adding spares" : "Add spares"}
				disabled={disabled}
				onPress={onAdd}
			/>
		</>
	);
}
