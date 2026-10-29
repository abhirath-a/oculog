import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { monthDates } from "../../src/lib/wear-history/model";
import {
	reportMonths,
	type WearReport,
	wearReportRange,
	wearTotals,
} from "../../src/lib/wear-history/report";
import type { WearReportState } from "../../src/lib/wear-history/report-controller";

const require = createRequire(import.meta.url);
function fixture(): WearReport {
	const range = wearReportRange("2026-06-18");
	const days = reportMonths(range.from, range.through)
		.flatMap(monthDates)
		.filter((d) => d >= range.from && d <= range.through)
		.map((localDate, i) => ({
			localDate,
			...(localDate === range.through
				? { source: "manual" as const, worn: true }
				: [
						{ source: "manual" as const, worn: true },
						{ source: "manual" as const, worn: false },
						{ source: "assumed" as const, worn: true },
						{ source: "unknown" as const, worn: null },
					][i % 4]!),
		}));
	return { ...range, days, timeZone: "UTC", totals: wearTotals(days) };
}

// Execute the real screen and its retained JSX callbacks; native leaves are inert test nodes.
function harness(insetMode: "tabs" | "stack" = "stack") {
	let token = "synthetic-token";
	let valid = true;
	let mounted = false;
	let cursor = 0;
	let exports = 0;
	let loads = 0;
	let focus = () => {};
	let focusCleanup: (() => void) | undefined;
	let focusInitialized = false;
	let state: WearReportState = {
		report: fixture(),
		loading: false,
		exporting: false,
		error: "",
	};
	const slots: any[] = [];
	const pending: (() => void | (() => void))[] = [];
	const cleanups: (() => void)[] = [];
	const nodes: any[] = [];
	const routes: string[] = [];
	const lease = () => (valid ? JSON.stringify(["synthetic-owner", token]) : "");
	const controller = {
		getState: () => state,
		subscribe: () => () => {},
		mount() {
			mounted = true;
		},
		dispose() {
			mounted = false;
		},
		async load() {
			loads++;
			return true;
		},
		async exportPdf() {
			if (mounted) exports++;
			return true;
		},
	};
	const react = {
		useMemo(fn: () => any) {
			const i = cursor++;
			if (!(i in slots)) slots[i] = fn();
			return slots[i];
		},
		useRef(value: any) {
			const i = cursor++;
			if (!(i in slots)) slots[i] = { current: value };
			return slots[i];
		},
		useState(value: any) {
			const i = cursor++;
			if (!(i in slots)) slots[i] = value;
			return [
				slots[i],
				(next: any) => {
					slots[i] = typeof next === "function" ? next(slots[i]) : next;
				},
			];
		},
		useEffect(fn: () => void | (() => void)) {
			const i = cursor++;
			if (!(i in slots)) {
				slots[i] = true;
				pending.push(fn);
			}
		},
		useSyncExternalStore(_subscribe: any, get: () => any) {
			return get();
		},
		useCallback(fn: any) {
			return fn;
		},
	};
	const jsx = (type: any, props: any, key?: any) => ({
		type,
		props: props ?? {},
		key,
	});
	const mocks: Record<string, any> = {
		react,
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		"@expo/ui/swift-ui": { HStack: "HStack" },
		"expo-router": {
			useRouter: () => ({ navigate: (route: string) => routes.push(route) }),
			useFocusEffect: (fn: () => void | (() => void)) => {
				focus = () => {
					const cleanup = fn();
					focusCleanup = typeof cleanup === "function" ? cleanup : undefined;
				};
				if (!focusInitialized) {
					focusInitialized = true;
					pending.push(() => {
						focus();
						return () => focusCleanup?.();
					});
				}
			},
		},
		"expo-router/react-navigation": { usePreventRemove: () => {} },
		"../../lib/store": {
			useStore: () => ({
				account: { id: "synthetic-owner" },
				state: { today: "2026-06-18" },
			}),
		},
		"../../lib/wear-history/report-runtime": {
			createDeviceWearReportController: () => controller,
		},
		"../native-page": Object.fromEntries(
			[
				"NativePage",
				"NativeSection",
				"NativeRow",
				"NativeText",
				"PageToggle",
			].map((name) => [name, name]),
		),
		"./native-support": {
			useSessionLease: lease,
			sessionLease: lease,
			ownsSession: (owner: string) => valid && owner === "synthetic-owner",
			dateLabel: (date: string) => date,
			monthLabel: (month: string) => month,
			WearAction: "WearAction",
			WEEKDAYS: [
				"Monday",
				"Tuesday",
				"Wednesday",
				"Thursday",
				"Friday",
				"Saturday",
				"Sunday",
			],
		},
	};
	const path = new URL(
		"../../src/components/wear-history/logs-screen.tsx",
		import.meta.url,
	);
	const code = ts.transpileModule(readFileSync(path, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;
	const module = { exports: {} as any };
	vm.runInNewContext(code, {
		module,
		exports: module.exports,
		require: (name: string) =>
			mocks[name] ??
			require(
				new URL(`../../src/components/wear-history/${name}`, import.meta.url)
					.pathname,
			),
		console,
	});
	function walk(node: any): void {
		if (node == null || typeof node === "boolean") return;
		if (Array.isArray(node)) {
			for (const child of node) walk(child);
			return;
		}
		if (typeof node !== "object") return;
		if (typeof node.type === "function") {
			walk(node.type(node.props));
			return;
		}
		nodes.push(node);
		walk(node.props.children);
	}
	function render() {
		nodes.length = 0;
		cursor = 0;
		walk(jsx(module.exports.default, { owner: "synthetic-owner", insetMode }));
		while (pending.length) {
			const cleanup = pending.shift()!();
			if (typeof cleanup === "function") cleanups.push(cleanup);
		}
	}
	render();
	const action = (label: string) => {
		const result = nodes.find(
			(n) => n.type === "WearAction" && n.props.label === label,
		);
		assert.ok(result, `Missing ${label}`);
		return result.props;
	};
	const text = () =>
		nodes
			.filter((n) => n.type === "NativeText")
			.map((n) => n.props.children)
			.join("\n");
	return {
		render,
		action,
		text,
		nodes,
		routes,
		controller,
		state: () => state,
		replace: (next: WearReportState) => {
			state = next;
		},
		exports: () => exports,
		loads: () => loads,
		focus: () => focus(),
		blur: () => {
			focusCleanup?.();
			focusCleanup = undefined;
		},
		rotate: () => {
			token = "rotated-token";
		},
		logout: () => {
			valid = false;
		},
		unmount: () => {
			for (const cleanup of cleanups.splice(0)) cleanup();
		},
	};
}

test("the Logs tab uses tab-safe content insets rather than nested-stack insets", () => {
	const h = harness("tabs");
	assert.equal(
		h.nodes.find((n) => n.type === "NativePage")?.props.insetMode,
		"tabs",
	);
});

test("logs show only worn dates by default, with assumed wear labelled and other statuses optional", () => {
	const h = harness();
	assert.match(h.text(), /confirmed worn/);
	assert.match(h.text(), /confirmed not worn/);
	assert.match(h.text(), /assumed worn/);
	assert.match(h.text(), /unknown/);
	const dateTexts = () =>
		h.nodes
			.filter(
				(n) =>
					n.type === "NativeText" && /^\w+, 2026-06-/.test(n.props.children),
			)
			.map((n) => n.props.children);
	const recorded = dateTexts();
	assert.ok(recorded.length > 0);
	assert.ok(
		!h.nodes.some(
			(n) =>
				n.type === "NativeText" && n.props.children === "Confirmed not worn",
		),
	);
	assert.ok(
		h.nodes.some(
			(n) =>
				n.type === "NativeText" &&
				n.props.children === "Assumed worn - not confirmed",
		),
	);
	assert.match(recorded[0], /2026-06-18/);
	const toggle = h.nodes.find((n) => n.type === "PageToggle")!.props;
	assert.equal(toggle.value, false);
	toggle.onChange(true);
	h.render();
	assert.equal(dateTexts().length, 18);
	assert.ok(dateTexts().length > recorded.length);
});

test("month navigation rejects the old callback before rerender and respects the latest-month bound", () => {
	const h = harness();
	assert.equal(h.action("Later").blocked, true);
	const old = h.action("Earlier").onPress;
	old();
	old();
	h.render();
	assert.ok(
		h.nodes.some(
			(n) => n.type === "NativeSection" && n.props.title === "2026-05",
		),
	);
	old();
	h.render();
	assert.ok(
		h.nodes.some(
			(n) => n.type === "NativeSection" && n.props.title === "2026-05",
		),
	);
	h.action("Later").onPress();
	h.render();
	assert.equal(h.action("Later").blocked, true);
});

for (const change of ["token", "logout", "unmount"] as const)
	test(`retained native export/read/navigation callbacks reject ${change} before rerender`, () => {
		const h = harness();
		const share = h.action("Export PDF").onPress;
		const refresh = h.action("Refresh logs").onPress;
		const calendar = h.action("Calendar").onPress;
		const before = h.loads();
		if (change === "token") h.rotate();
		else if (change === "logout") h.logout();
		else h.unmount();
		share();
		refresh();
		calendar();
		h.focus();
		assert.equal(h.exports(), 0);
		assert.equal(h.loads(), before);
		assert.equal(h.routes.length, 0);
	});

test("export uses the controller; loading and exporting disable report controls", () => {
	const h = harness();
	h.action("Export PDF").onPress();
	assert.equal(h.exports(), 1);
	h.replace({ ...h.state(), exporting: true });
	h.render();
	assert.equal(h.action("Preparing…").blocked, true);
	assert.equal(h.action("Refresh logs").blocked, true);
	assert.equal(h.action("Earlier").blocked, true);
	h.replace({ report: null, loading: true, exporting: false, error: "" });
	h.render();
	assert.equal(h.action("Export PDF").blocked, true);
	assert.match(h.text(), /Loading your complete past year/);
});

test("leaving the Logs tab cancels its active scope and blocks retained actions until refocused", () => {
	const h = harness();
	const share = h.action("Export PDF").onPress;
	const calendar = h.action("Calendar").onPress;
	h.blur();
	share();
	calendar();
	assert.equal(h.exports(), 0);
	assert.equal(h.routes.length, 0);
	const reads = h.loads();
	h.focus();
	assert.equal(h.loads(), reads + 1);
	h.action("Export PDF").onPress();
	assert.equal(h.exports(), 1);
});

test("calendar navigation is read-only and uses navigate rather than stacking duplicate calendars", () => {
	const h = harness();
	h.action("Calendar").onPress();
	assert.deepEqual(h.routes, ["/wear-history"]);
	assert.equal(h.exports(), 0);
});
