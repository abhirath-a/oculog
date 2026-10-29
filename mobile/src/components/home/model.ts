import type {
	SimpleEyeState,
	SimpleState,
} from "../../../shared/simple-domain";
import { type Eye, remainingLabel } from "../../lib/simple-controller";

export type HomeContentProps = {
	state: SimpleState;
	disabled: boolean;
	pairedEyes: boolean;
	onLog: (worn: boolean) => void;
	onReplace: (eye: Eye) => void;
	onSettings: () => void;
	onAdd: () => void;
	onHistory?: () => void;
};

/** Presentation only: dates and countdowns remain authoritative server values. */
export function eyeSummary(eye: SimpleEyeState) {
	const configured = eye.replacementDays !== null;
	return {
		name: eye.eye === "left" ? "Left lens" : "Right lens",
		actionLabel: `${configured && eye.openedOn === null ? "Open" : "Replace"} ${eye.eye} lens`,
		countdown: !configured
			? "Replacement interval not set"
			: eye.daysRemaining === 0
				? "Replace today"
				: eye.daysRemaining === null
					? "No lens open"
					: eye.daysRemaining > 0
						? `Replace in ${eye.daysRemaining} ${eye.daysRemaining === 1 ? "day" : "days"}`
						: remainingLabel(eye.daysRemaining),
		due: eye.dueOn
			? `Replace on ${eye.dueOn}`
			: configured
				? "Start a lens to set a deadline."
				: null,
		metadata: configured ? `${eye.replacementDays}-day replacement` : null,
		hint:
			configured && eye.spareCount < 1
				? eye.openedOn
					? "Add a spare before replacing."
					: "Start an open lens in Settings, or add a spare."
				: null,
		configured,
	};
}

export function dailyAcknowledgement(worn: boolean | null) {
	return worn === null ? "Not recorded" : `Recorded: ${worn ? "Yes" : "No"}`;
}

export type AddContactsFormProps = {
	eye: string;
	quantity: string;
	onEyeChange: (eye: string) => void;
	onQuantityChange: (quantity: string) => void;
	disabled: boolean;
	locked: boolean;
	onAdd: () => void;
};

export function additionHint(eye: string, locked: boolean) {
	return locked
		? "One eye is already saved. Retry adds only the unfinished eye; keep the same quantity."
		: eye === "both"
			? "Unopened spares for each eye. Each eye saves separately."
			: "Unopened spares, ready for your next replacement.";
}
