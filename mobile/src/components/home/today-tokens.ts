/** Today-only layout contracts. Never export these through global presentation. */
export const todaySpace = {
	tight: 4,
	small: 8,
	row: 12,
	inset: 16,
	section: 24,
} as const;
export const todayType = {
	section: { size: 20, leading: 25, weight: "600", ramp: "title3" },
	headline: { size: 17, leading: 22, weight: "600", ramp: "headline" },
	body: { size: 17, leading: 22, weight: "400", ramp: "body" },
	secondary: { size: 15, leading: 20, weight: "400", ramp: "subheadline" },
	caption: { size: 13, leading: 18, weight: "400", ramp: "caption1" },
} as const;
export type TodayActionProps = {
	label: string;
	onPress: () => void;
	/** Caller elects at most one primary per Today task surface. */
	emphasis?: "primary" | "secondary";
	disabled?: boolean;
	/** Honest destructive color; emphasis still controls filled vs secondary. */
	danger?: boolean;
	/** Controlled choice only; omission means an ordinary action. */
	selected?: boolean;
	accesibilityText?: string;
};

/** Do not let native event delivery bypass a pending/stale owner gate. */
export function todayPress(disabled: boolean | undefined, onPress: () => void) {
	return () => {
		if (!disabled) onPress();
	};
}
