import { Host } from "@expo/ui";
import { useEffect, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { useAction } from "../ui";
import TodayFeedbackSurface from "./today-feedback-surface";

type Action = Pick<ReturnType<typeof useAction>, "busy" | "error" | "message">;
export type Notice = { text: string; kind: "pending" | "error" | "success" };

export function todayNotice(
	action: Action,
	pendingLabel: string,
): Notice | null {
	if (action.error) return { text: action.error, kind: "error" };
	if (action.busy) return { text: pendingLabel, kind: "pending" };
	return action.message ? { text: action.message, kind: "success" } : null;
}

/** Today-only feedback overlay. Never participates in the list's vertical layout. */
export default function TodayFeedback({
	action,
	addAction,
	visible,
}: {
	action: Action;
	addAction: Action;
	visible: boolean;
}) {
	// NativeTabs on iOS extends content beneath its bar. Its screen-level
	// SafeAreaProvider reports the actual obstructed bottom area (bar included).
	const insets = useSafeAreaInsets();
	const bottom = insets.bottom + 16;
	const [notice, setNotice] = useState<Notice | null>(null);
	const [width, setWidth] = useState(0);
	const { busy, error, message } = action;
	const { busy: addBusy, error: addError, message: addMessage } = addAction;
	useEffect(() => {
		setNotice(todayNotice({ busy, error, message }, "Saving changes…"));
	}, [busy, error, message]);
	useEffect(() => {
		setNotice(
			todayNotice(
				{ busy: addBusy, error: addError, message: addMessage },
				"Adding spares…",
			),
		);
	}, [addBusy, addError, addMessage]);
	useEffect(() => {
		if (!visible || !notice) return;
		AccessibilityInfo.announceForAccessibility(notice.text);
		// Failures and in-flight work stay available; only success is transient.
		if (notice.kind !== "success") return;
		const timer = setTimeout(() => setNotice(null), 6000);
		return () => clearTimeout(timer);
	}, [notice, visible]);
	if (!visible || !notice) return null;
	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				bottom,
				left: 16,
				right: 16,
				zIndex: 10,
			}}
			onLayout={({ nativeEvent: { layout } }) => {
				if (Number.isFinite(layout.width) && layout.width > 0)
					setWidth(layout.width);
			}}
		>
			{width > 0 && (
				<Host matchContents={{ vertical: true }} style={{ width }}>
					<TodayFeedbackSurface
						notice={notice}
						onDismiss={() => setNotice(null)}
					/>
				</Host>
			)}
		</View>
	);
}
