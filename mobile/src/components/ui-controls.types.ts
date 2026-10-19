export type ButtonControlProps = {
	title: string;
	onPress(): void;
	disabled: boolean;
	appearance: "filled" | "outlined" | "text";
	fullWidth: boolean;
	glass: boolean;
	colors: { accent: string; danger: string; onAccent: string };
	danger: boolean;
};

export type SwitchControlProps = {
	label: string;
	value: boolean;
	disabled: boolean;
	onChange(value: boolean): void;
};
