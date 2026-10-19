import { Column, Row, Switch } from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	semantics,
	weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { SemanticText } from "../presentation";

export default function SettingsSwitch({
	label,
	value,
	disabled,
	onValueChange,
}: {
	label: string;
	value: boolean;
	disabled?: boolean;
	onValueChange: (value: boolean) => void;
}) {
	return (
		<Row
			verticalAlignment="center"
			horizontalArrangement={{ spacedBy: 8 }}
			modifiers={[fillMaxWidth()]}
		>
			<Column modifiers={[weight(1)]}>
				<SemanticText>{label}</SemanticText>
			</Column>
			<Switch
				value={value}
				enabled={!disabled}
				onCheckedChange={onValueChange}
				modifiers={[semantics({ contentDescription: label })]}
			/>
		</Row>
	);
}
