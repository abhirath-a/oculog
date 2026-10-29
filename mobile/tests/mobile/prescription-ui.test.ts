// biome-ignore-all lint/suspicious/noExplicitAny: Strict JSX boundary harness, not native visual evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { defaultPreferences } from "../../src/lib/local-reminders/model";
import * as calendar from "../../src/lib/prescriptions/calendar";
import * as model from "../../src/lib/prescriptions/model";

const require = createRequire(import.meta.url);
const context = React.createContext(false);
function Native({ children, label, value }: any) {
	assert.equal(React.useContext(context), true, "Native child outside Host");
	return React.createElement(
		"div",
		null,
		children,
		label,
		typeof value === "string" ? value : null,
	);
}
function Page({ children }: any) {
	return React.createElement(context.Provider, { value: true }, children);
}
const native = {
	NativeAction: Native,
	NativeDisclosure: Native,
	NativePage: Page,
	NativeRow: Native,
	NativeSection: Native,
	NativeStack: Native,
	NativeText: Native,
	PageToggle: Native,
};
function load(file: string, mocks: Record<string, any>) {
	const exports: any = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(`../../src/components/${file}`, import.meta.url),
				"utf8",
			),
			{
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			},
		).outputText,
		{
			exports,
			require(name: string) {
				if (name === "react/jsx-runtime") return require(name);
				assert.ok(name in mocks, `Unexpected import ${name}`);
				return mocks[name];
			},
		},
	);
	return exports;
}
function rx(editing: boolean, confirmed = false, renewal = false) {
	let hook = 0,
		refIndex = 0;
	const controls: any[] = [],
		toggles: any[] = [],
		updates: any[] = [],
		values: any[] = [],
		refs: any[] = [];
	const d = model.emptyDraft();
	d.right.sphere = "-2.25";
	d.left.sphere = "Plano";
	d.expiresOn = "2027-04-03";
	let record = model.confirmPrescription(d, {
		id: "synthetic",
		now: new Date("2026-10-24T00:00:00Z"),
		contactLensConfirmed: true,
		reviewConfirmed: true,
	});
	const controller = {
		getState: () => ({
			record,
			draft: d,
			busy: false,
			loading: false,
			warnings: ["Check the original"],
			expiryCandidates: [],
		}),
		subscribe() {},
		setDraft() {},
		async save(options: any) {
			record = model.confirmPrescription(d, {
				...options,
				now: new Date(options.now.toISOString()),
			});
		},
	};
	const reminders = {
		preferences: defaultPreferences(),
		permission: "granted",
	};
	reminders.preferences.prescription.enabled = renewal;
	const { default: Screen } = load("prescriptions/prescription-screen.tsx", {
		react: {
			...React,
			useEffect() {},
			useRef(value: any) {
				const index = refIndex++;
				if (!refs[index]) refs[index] = { current: index === 1 ? true : value };
				return refs[index];
			},
			useState(value: any) {
				const index = hook++;
				if (!(index in values))
					values[index] =
						index === 1
							? editing
							: index === 2 || index === 3
								? confirmed
								: typeof value === "function"
									? value()
									: value;
				return [
					values[index],
					(next: any) => {
						values[index] =
							typeof next === "function" ? next(values[index]) : next;
					},
				];
			},
			useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
		},
		"@expo/ui": { Button: Native, Column: Native },
		"@expo/ui/swift-ui/modifiers": { frame() {} },
		"expo-crypto": { randomUUID: () => "synthetic" },
		"expo-router": { useRouter: () => ({ push() {} }), useFocusEffect() {} },
		"expo-router/react-navigation": { usePreventRemove() {} },
		"../../lib/api": {
			sessionStore: {
				isValid: true,
				account: { id: "owner" },
				token: "synthetic",
			},
		},
		"../../lib/local-reminders/runtime": {
			reminderManager: {
				getState: () => reminders,
				subscribe() {},
				async updatePreferences(next: any) {
					updates.push(next);
					reminders.preferences = next;
				},
			},
			notificationContextReady: () => true,
		},
		"../../lib/prescriptions/calendar": calendar,
		"../../lib/prescriptions/controller": {
			createPrescriptionController: () => controller,
		},
		"../../lib/prescriptions/device-repository": {
			prescriptionRepository: {},
		},
		"../../lib/prescriptions/model": model,
		"../../lib/prescriptions/ocr": {
			ocrAvailable: () => false,
			scannerAvailable: () => false,
		},
		"../native-input": { __esModule: true, default: Native },
		"../native-page": {
			...native,
			NativeAction: (props: any) => {
				controls.push(props);
				return React.createElement(Native, props);
			},
			PageToggle: (props: any) => {
				toggles.push(props);
				return React.createElement(Native, props);
			},
		},
		"../presentation/theme": {
			usePresentationTheme: () => ({ divider: "#ddd" }),
		},
		"./expiry-field": { ExpiryField: Native },
	});
	const render = () => {
		hook = 0;
		refIndex = 0;
		controls.length = 0;
		toggles.length = 0;
		return renderToStaticMarkup(
			React.createElement(Screen, { owner: "owner" }),
		);
	};
	return { html: render(), controls, toggles, updates, render };
}
test("confirmed paired-eye summary labels OD/OS and missing fields without inventing zero", () => {
	const { html } = rx(false);
	assert.match(html, /-2.25 D/);
	assert.match(html, /Plano/);
	assert.match(html, /Not recorded/);
	assert.match(html, /Expo Go supports manual entry/);
	assert.doesNotMatch(html, /CYL: 0/);
});
test("prescription editing stays inside native tree and save requires both confirmations", () => {
	const before = rx(true, false),
		after = rx(true, true);
	assert.equal(
		before.controls.find((c) => c.label === "Save confirmed prescription")
			.disabled,
		true,
	);
	assert.equal(
		after.controls.find((c) => c.label === "Save confirmed prescription")
			.disabled,
		false,
	);
	assert.match(after.html, /Right SPH/);
	assert.match(after.html, /Left SPH/);
});
test("saving an explicit renewal-off choice persists false rather than leaving alerts enabled", async () => {
	const h = rx(true, true, true);
	const toggle = h.toggles.find(
		(t) => t.label === "Enable renewal reminders after saving",
	);
	assert.equal(toggle.value, true);
	toggle.onChange(false);
	h.render();
	h.controls.find((c) => c.label === "Save confirmed prescription").onPress();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(h.updates.length, 1);
	assert.equal(h.updates[0].prescription.enabled, false);
});
test("saving without changing renewal choice preserves existing preferences", async () => {
	const h = rx(true, true, true);
	h.controls.find((c) => c.label === "Save confirmed prescription").onPress();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(h.updates.length, 0);
});
test("notification preferences render three local opt-in kinds with explicit system-delivery limits", () => {
	const state = {
		preferences: defaultPreferences(),
		permission: "denied",
		scheduledCount: 0,
		error: null,
		notice: null,
		busy: false,
		loading: false,
	};
	const { default: Screen } = load(
		"reminders/notification-settings-screen.tsx",
		{
			react: {
				...React,
				useEffect() {},
				useRef: (v: any) => ({ current: v }),
				useState: (v: any) => [v, () => {}],
				useSyncExternalStore: (_s: any, snapshot: any) => snapshot(),
			},
			"react-native": { Linking: {} },
			"../../lib/api": {
				sessionStore: {
					isValid: true,
					account: { id: "owner" },
					token: "synthetic",
				},
			},
			"../../lib/local-reminders/runtime": {
				reminderManager: { getState: () => state, subscribe() {} },
				notificationContextReady: () => true,
			},
			"../../lib/store": { useStore: () => ({ pending: false }) },
			"../native-page": native,
			"./time-field": { ReminderTimeField: Native },
		},
	);
	const html = renderToStaticMarkup(React.createElement(Screen));
	assert.match(html, /blocked in iOS/);
	assert.match(html, /Daily check-in reminder/);
	assert.match(html, /Replacement deadline reminders/);
	assert.match(html, /Book before the prescription expires/);
	assert.match(html, /not measure hours/);
});
