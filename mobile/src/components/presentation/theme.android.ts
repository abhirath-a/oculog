import { getMaterialColors } from "@expo/ui/jetpack-compose";
import {
	createContext,
	createElement,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { AppState, useColorScheme } from "react-native";
import { paletteRefreshGate } from "./palette-refresh";
import type { PresentationTheme } from "./theme";

type PaletteSnapshot = {
	theme: PresentationTheme;
	epoch: number;
	hold(token: symbol): void;
	release(token: symbol): void;
};
const PaletteContext = createContext<PaletteSnapshot | null>(null);

function readTheme(scheme: "light" | "dark"): PresentationTheme {
	// Always read outside Host's memoized JS palette context. Never seed Material You.
	const colors = getMaterialColors({ scheme });
	return {
		background: colors.background,
		surface: colors.surfaceContainerLow,
		text: colors.onSurface,
		secondary: colors.onSurfaceVariant,
		divider: colors.outline,
		primary: colors.primary,
		onPrimary: colors.onPrimary,
		error: colors.error,
	};
}

/** One app subscription and one snapshot for RN and native descendants. Epoch keys remount only Hosts to invalidate SDK cache. */
export function PresentationThemeProvider({
	children,
}: {
	children: ReactNode;
}) {
	const scheme = useColorScheme() === "dark" ? "dark" : "light";
	const [epoch, setEpoch] = useState(0);
	const gate = useRef<ReturnType<typeof paletteRefreshGate> | null>(null);
	const holders = useRef(new Set<symbol>());
	const controls = useMemo(
		() => ({
			hold(token: symbol) {
				holders.current.add(token);
				gate.current?.hold(token);
			},
			release(token: symbol) {
				holders.current.delete(token);
				gate.current?.release(token);
			},
		}),
		[],
	);
	useEffect(() => {
		const current = paletteRefreshGate(AppState.currentState, () =>
			setEpoch((value) => value + 1),
		);
		gate.current = current;
		for (const token of holders.current) current.hold(token);
		const subscription = AppState.addEventListener(
			"change",
			current.transition,
		);
		return () => {
			subscription.remove();
			current.dispose();
			gate.current = null;
		};
	}, []);
	const snapshot = useMemo(
		() => ({ theme: readTheme(scheme), epoch, ...controls }),
		[scheme, epoch, controls],
	);
	return createElement(PaletteContext.Provider, { value: snapshot }, children);
}

export function usePresentationTheme(): PresentationTheme {
	const snapshot = useContext(PaletteContext);
	const scheme = useColorScheme() === "dark" ? "dark" : "light";
	return snapshot?.theme ?? readTheme(scheme);
}

/** Native boundary key only; never put this key on a screen/router/controller. */
export function usePresentationEpoch(): string {
	const scheme = useColorScheme() === "dark" ? "dark" : "light";
	return `${scheme}:${useContext(PaletteContext)?.epoch ?? 0}`;
}

/** Keep every RN/native palette on the same snapshot until the busy sheet's mutation finishes, even if Android dismisses it. */
export function usePresentationPaletteHold(busy: boolean): void {
	const snapshot = useContext(PaletteContext);
	const token = useRef(Symbol("busy-native-sheet"));
	const hold = snapshot?.hold;
	const release = snapshot?.release;
	useEffect(() => {
		if (!busy || !hold || !release) return;
		hold(token.current);
		return () => release(token.current);
	}, [busy, hold, release]);
}
