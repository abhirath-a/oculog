import type { AppStateStatus } from "react-native";

/** Foreground invalidation, not a wallpaper-change detector. Coalesces refreshes while native presentation is busy. */
export function paletteRefreshGate(
	initial: AppStateStatus | null,
	invalidate: () => void,
) {
	let previous = initial;
	let pending = false;
	let disposed = false;
	const holds = new Set<symbol>();
	const flush = () => {
		if (!disposed && pending && holds.size === 0) {
			pending = false;
			invalidate();
		}
	};
	return {
		transition(next: AppStateStatus) {
			if (disposed) return;
			if (
				next === "active" &&
				(previous === "background" || previous === "inactive")
			)
				pending = true;
			previous = next;
			flush();
		},
		hold(token: symbol) {
			if (!disposed) holds.add(token);
		},
		release(token: symbol) {
			holds.delete(token);
			flush();
		},
		dispose() {
			disposed = true;
			holds.clear();
			pending = false;
		},
	};
}
