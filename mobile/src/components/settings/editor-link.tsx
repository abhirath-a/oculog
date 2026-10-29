import { NativeAction } from "../native-page";
export default function EditorLink({
	disabled,
	onEdit,
}: {
	disabled: boolean;
	onEdit(): void;
}) {
	return (
		<NativeAction
			label="Edit lens setup"
			emphasis="primary"
			disabled={disabled}
			onPress={() => {
				if (!disabled) onEdit();
			}}
		/>
	);
}
