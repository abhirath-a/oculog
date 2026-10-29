import { Button, Text } from "@expo/ui/swift-ui";
import {
	accessibilityAddTraits,
	accessibilityLabel,
	buttonStyle,
	controlSize,
	disabled,
	fixedSize,
	font,
	frame,
	multilineTextAlignment,
	padding,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useFocusEffect } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import { sessionStore } from "../../lib/api";
import { createDeviceWearHistoryController } from "../../lib/wear-history/runtime";
import { useButtonActionColors } from "../button-action-colors";

export function sessionLease() {
	return sessionStore.isValid && sessionStore.account && sessionStore.token
		? JSON.stringify([sessionStore.account.id, sessionStore.token])
		: "";
}
export function ownsSession(owner: string) {
	return sessionStore.account?.id === owner && !!sessionLease();
}
export function useSessionLease() {
	return useSyncExternalStore(
		sessionStore.onChange,
		sessionLease,
		sessionLease,
	);
}

/** This hook lives inside a session-keyed screen: no draft/selection crosses a token change. */
export function useWearController(
	owner: string,
	lease: string,
	initialMonth: string,
) {
	const controller = useMemo(() => createDeviceWearHistoryController(), []);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getState,
		controller.getState,
	);
	const generation = useRef(0);
	const mounted = useRef(false);
	const lock = useRef(false);
	usePreventRemove(state.busy, () => {});
	useEffect(() => {
		mounted.current = true;
		generation.current++;
		void controller.mount();
		void controller.load(initialMonth);
		return () => {
			mounted.current = false;
			generation.current++;
			lock.current = false;
			controller.dispose();
		};
	}, [controller, initialMonth]);
	useFocusEffect(
		useCallback(() => {
			if (
				mounted.current &&
				sessionLease() === lease &&
				sessionStore.account?.id === owner &&
				!lock.current &&
				!controller.getState().busy
			)
				void controller.load(controller.getState().month);
		}, [controller, owner, lease]),
	);
	const current = () =>
		mounted.current &&
		!!lease &&
		sessionLease() === lease &&
		sessionStore.account?.id === owner;
	const currentMonth = () =>
		current() && controller.getState().month === state.month;
	return { controller, state, generation, lock, current, currentMonth };
}

/** Native-tree child only. Primary glass is deliberately stronger than quiet actions. */
export function WearAction({
	label,
	onPress,
	blocked = false,
	primary = false,
	selected = false,
	accessibility,
}: {
	label: string;
	onPress(): void;
	blocked?: boolean;
	primary?: boolean;
	selected?: boolean;
	accessibility?: string;
}) {
	const colors = useButtonActionColors();
	return (
		<Button
			onPress={() => {
				if (!blocked) onPress();
			}}
			modifiers={[
				buttonStyle(primary || selected ? "glassProminent" : "glass"),
				controlSize("regular"),
				tint(colors.accent),
				disabled(blocked),
				accessibilityLabel(accessibility ?? label),
				...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
			]}
		>
			<Text
				modifiers={[
					font({ textStyle: "body" }),
					fixedSize({ horizontal: true, vertical: true }),
					multilineTextAlignment("center"),
					padding({ horizontal: 8, vertical: 2 }),
					// frame({ minHeight: 44 }),
				]}
			>
				{label}
			</Text>
		</Button>
	);
}

export const WEEKDAYS = [
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
	"Sunday",
];
export const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];
export function monthLabel(month: string) {
	return `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}
export function dateLabel(date: string) {
	return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}, ${date.slice(0, 4)}`;
}
export function dayStatus(day: { source: string; worn: boolean | null }) {
	return day.source === "assumed"
		? "Assumed worn"
		: day.source === "manual"
			? day.worn
				? "Manual: wore lenses"
				: "Manual: did not wear"
			: "Unknown";
}
