import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { webTypography } from "../../src/components/presentation/web-typography";

type Element = { type: string; props: Record<string, unknown> };
function jsx(type: string, props: Record<string, unknown>): Element {
	return { type, props };
}
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const element = node as Element;
	return [element, ...elements(element.props.children)];
}
function controls(
	platform: string,
	scheme = "light",
	insets = { top: 24, bottom: 34 },
	version = "26.0",
) {
	const mocks: Record<string, unknown> = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react: {
			useEffect: (effect: () => void) => effect(),
			createContext: () => ({}),
			useContext: () => null,
			useRef: (value: unknown) => ({ current: value }),
			useId: () => "field-id",
			useImperativeHandle: (
				ref: { current: unknown } | undefined,
				create: () => unknown,
			) => {
				if (ref) ref.current = create();
			},
		},
		"@expo/ui": {
			Host: "Host",
			Column: "Column",
			RNHostView: "RNHostView",
			Button: "NativeButton",
			Switch: "NativeSwitch",
			TextInput: "NativeTextInput",
			useNativeState: (value: string) => ({ value }),
		},
		"@expo/ui/jetpack-compose/modifiers": {
			semantics: (value: unknown) => value,
			defaultMinSize: (value: unknown) => ({ minimum: value }),
			fillMaxWidth: () => ({ fillMaxWidth: true }),
			padding: (...value: number[]) => ({ padding: value }),
		},
		"@expo/ui/swift-ui/modifiers": {
			accessibilityLabel: (value: string) => ({ label: value }),
			controlSize: (value: string) => ({ controlSize: value }),
			font: (value: unknown) => ({ font: value }),
			textFieldStyle: (value: string) => ({ textFieldStyle: value }),
			buttonStyle: (value: string) => ({ buttonStyle: value }),
			frame: (value: { minHeight: number }) => ({ frame: value }),
			tint: (value: string) => ({ tint: value }),
		},
		"react-native": {
			Platform: { OS: platform, Version: version },
			useColorScheme: () => scheme,
			Text: "Text",
			View: "View",
			TextInput: "TextInput",
			StyleSheet: { create: (styles: unknown) => styles },
		},
		"react-native-safe-area-context": {
			useSafeAreaInsets: () => insets,
		},
		"../lib/action-guard": {},
		"../lib/api": {},
		"../lib/store": { useStore: () => ({}) },
	};
	mocks["./palette-refresh"] = {};
	const themeExports = {};
	mocks["@expo/ui/jetpack-compose"] = {
		BasicTextField: "BasicTextField",
		useNativeState: (value: string) => ({ value }),
		getMaterialColors: (options: { scheme: string; seedColor?: string }) => {
			assert.equal(options.scheme, scheme);
			assert.equal(
				options.seedColor,
				undefined,
				"Material You must remain unseeded",
			);
			return {
				background: scheme === "dark" ? "#121212" : "#FFFFFF",
				surfaceContainerLow: scheme === "dark" ? "#1C1C1E" : "#FFFFFF",
				onSurface: scheme === "dark" ? "#FFFFFF" : "#000000",
				onSurfaceVariant: "#666666",
				outline: "#8E8E93",
				primary: "#6750A4",
				onPrimary: "#FFFFFF",
				error: "#BA1A1A",
			};
		},
	};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					`../../src/components/presentation/theme${platform === "android" ? ".android" : ""}.ts`,
					import.meta.url,
				),
				"utf8",
			),
			{ compilerOptions: { module: ts.ModuleKind.CommonJS } },
		).outputText,
		{
			exports: themeExports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./theme"] = themeExports;
	mocks["./semantic-text"] = { SemanticText: "SemanticText" };
	mocks["./text"] = { PresentationText: "PresentationText" };
	const fieldExports = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					`../../src/components/presentation/native-field${platform === "ios" ? ".ios" : ""}.tsx`,
					import.meta.url,
				),
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
			exports: fieldExports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./presentation"] = {
		...themeExports,
		...fieldExports,
		ChoiceControl: "ChoiceControl",
	};
	mocks["./presentation/web-typography"] = { webTypography };
	const adapterExports = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL(
					`../../src/components/ui-controls.${platform === "web" ? "web" : "native"}.tsx`,
					import.meta.url,
				),
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
			exports: adapterExports,
			require: (name: string) => {
				assert.ok(name in mocks, name);
				return mocks[name];
			},
		},
	);
	mocks["./ui-controls"] = adapterExports;
	const exports = {} as {
		Button: (props: unknown) => Element;
		Field: (props: unknown) => Element;
		Toggle: (props: unknown) => Element;
		Page: (props: unknown) => Element;
		useColors: () => Record<string, string>;
	};
	const source = readFileSync(
		new URL("../../src/components/ui.tsx", import.meta.url),
		"utf8",
	);
	const output = ts.transpileModule(source, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;
	runInNewContext(output, {
		exports,
		require: (name: string) => {
			assert.ok(name in mocks);
			return mocks[name];
		},
	});
	for (const name of ["Field", "Button", "Toggle"] as const) {
		const component = exports[name];
		exports[name] = (props: unknown) => {
			const host = component(props);
			const child = host.props.children as unknown as {
				type: (props: unknown) => Element;
				props: unknown;
			};
			return {
				...host,
				props: { ...host.props, children: child.type(child.props) },
			};
		};
	}
	return exports;
}

test("platform surfaces follow the OS scheme and Android RN colors match unseeded Compose", () => {
	for (const platform of ["ios", "android", "web"]) {
		const light = controls(platform).useColors();
		const dark = controls(platform, "dark").useColors();
		assert.equal(light.bg, platform === "ios" ? "#F2F2F7" : "#FFFFFF");
		assert.equal(dark.bg, platform === "android" ? "#121212" : "#000000");
		assert.equal(light.text, "#000000");
		assert.equal(dark.text, "#FFFFFF");
		assert.equal(dark.card, "#1C1C1E");
		if (platform === "android")
			assert.equal(
				light.accent,
				"#6750A4",
				"RN inherits the unseeded Compose primary",
			);
	}
});

test("Page keeps content spacing separate from router-managed safe area insets", () => {
	for (const managedInsets of [true, false]) {
		const page = controls("ios").Page({
			title: "Home",
			managedInsets,
			contentPaddingTop: 32,
			contentPaddingBottom: 48,
		});
		const scroll = page.props.children as Element;
		const padding = (
			scroll.props.contentContainerStyle as Record<string, number>[]
		)[1];
		assert.equal(padding.paddingTop, 32 + (managedInsets ? 0 : 24));
		assert.equal(padding.paddingBottom, 48 + (managedInsets ? 0 : 34));
	}
	const page = controls("ios").Page({ title: "Form", managedInsets: true });
	const scroll = page.props.children as Element;
	const padding = (
		scroll.props.contentContainerStyle as Record<string, number>[]
	)[1];
	assert.equal(padding.paddingTop, 20);
	assert.equal(padding.paddingBottom, 28);
});

test("Android Page retains tall top cutout insets without doubling NativeTabs bottom padding", () => {
	for (const top of [44, 48]) {
		const page = controls("android", "light", { top, bottom: 34 }).Page({
			title: "Home",
			managedInsets: true,
			contentPaddingTop: 32,
			contentPaddingBottom: 48,
		});
		const scroll = page.props.children as Element;
		const padding = (
			scroll.props.contentContainerStyle as Record<string, number>[]
		)[1];
		assert.equal(padding.paddingTop, top === 48 ? 80 : 76);
		assert.equal(padding.paddingBottom, 48);
	}
});

test("native controls have a fresh content-sized Host at RN boundaries", () => {
	for (const platform of ["ios", "android"]) {
		const ui = controls(platform);
		const button = ui.Button({
			title: "Save",
			disabled: true,
			secondary: true,
			onPress: () => {},
		});
		assert.equal(button.type, "Host");
		assert.equal(button.props.matchContents, true);
		assert.equal(button.props.ignoreSafeArea, "all");
		assert.equal(
			button.props.seedColor,
			platform === "android" ? undefined : "#1D655C",
		);
		const nativeButton = button.props.children as Element;
		assert.equal(nativeButton.type, "NativeButton");
		assert.equal(nativeButton.props.disabled, true);
		assert.equal(nativeButton.props.label, "Save");
		assert.equal(nativeButton.props.variant, "outlined");
		assert.equal(nativeButton.props.children, undefined);
		if (platform === "ios") {
			const modifiers = nativeButton.props.modifiers as {
				controlSize?: string;
				frame?: { minHeight: number };
				tint?: string;
			}[];
			assert.equal(modifiers[0].controlSize, "regular");
			assert.equal(modifiers[1].frame?.minHeight, 44);
			assert.equal(modifiers[2].tint, "#1D655C");
		} else {
			assert.equal(nativeButton.props.modifiers, undefined);
		}
		const toggle = ui.Toggle({
			label: "Wore contacts today",
			value: false,
			disabled: false,
			onChange: () => {},
		});
		assert.equal(toggle.type, "Host");
		assert.equal(
			(toggle.props.children as Element).props.label,
			"Wore contacts today",
		);
		let submitted = 0;
		const field = ui.Field({
			returnKeyType: "next",
			onSubmitEditing: () => submitted++,
			label: "Password",
			value: "secret",
			secure: true,
			autoComplete: "current-password",
			onChange: () => {},
		});
		const host = field;
		assert.equal(host.type, "Host");
		assert.equal(host.props.ignoreSafeArea, "all");
		assert.equal(
			(host.props.matchContents as { vertical: boolean }).vertical,
			true,
		);
		const input = elements(host).find(
			(node) =>
				node.type ===
				(platform === "android" ? "BasicTextField" : "NativeTextInput"),
		);
		assert.ok(input);
		if (platform === "android") {
			assert.equal(input.props.visualTransformation, "password");
			assert.equal(
				(input.props.keyboardOptions as { imeAction: string }).imeAction,
				"next",
			);
			(input.props.keyboardActions as { onNext(): void }).onNext();
			assert.equal(submitted, 1);
			assert.equal(
				(input.props.keyboardOptions as { keyboardType: string }).keyboardType,
				"password",
			);
		} else {
			assert.equal(input.props.secureTextEntry, true);
			assert.equal(input.props.style, undefined);
			assert.deepEqual(JSON.parse(JSON.stringify(input.props.modifiers)), [
				{ label: "Password" },
				{ font: { textStyle: "body" } },
				{ textFieldStyle: "roundedBorder" },
				{ frame: { minHeight: 44 } },
			]);
		}
		if (platform === "android") {
			assert.ok(
				(input.props.modifiers as { contentType?: string }[]).some(
					(modifier) => modifier.contentType === "current-password",
				),
			);
		} else assert.equal(input.props.autoComplete, "current-password");
		const inputStyle = (input.props.style ?? {}) as Record<string, unknown>;
		assert.equal(
			inputStyle.borderWidth,
			undefined,
			"native forms own row decoration",
		);
		assert.equal((input.props.textStyle as { color: string }).color, "#000000");
		assert.equal((input.props.value as { value: string }).value, "secret");
		assert.equal((input.props.modifiers as unknown[]).length, 4);
		assert.equal(
			inputStyle.height,
			undefined,
			"fields grow with large system text",
		);
	}
});

test("full-width buttons constrain native content without sending RN percentages to Compose", () => {
	for (const platform of ["android", "ios"]) {
		const button = controls(platform).Button({
			title: "Sign in",
			fullWidth: true,
			onPress: () => {},
		});
		assert.equal(
			(button.props.style as { width: string }).width,
			"100%",
			"Host remains an RN layout boundary",
		);
		const native = button.props.children as Element;
		assert.equal(native.props.style, undefined);
		const modifiers = native.props.modifiers as {
			fillMaxWidth?: boolean;
			frame?: { maxWidth?: number };
		}[];
		assert.ok(
			modifiers.some((modifier) =>
				platform === "android"
					? modifier.fillMaxWidth
					: modifier.frame?.maxWidth === Infinity,
			),
		);
	}
});

test("glass actions opt into iOS 26 styles with explicit bordered fallback on older iOS", () => {
	for (const version of ["18.5", "26.0", "27.0"]) {
		const button = controls(
			"ios",
			"light",
			{ top: 0, bottom: 0 },
			version,
		).Button({
			title: "Sign in",
			glass: true,
			fullWidth: true,
			onPress: () => {},
		});
		const native = button.props.children as Element;
		const modifiers = native.props.modifiers as { buttonStyle?: string }[];
		assert.equal(
			modifiers.at(-1)?.buttonStyle,
			version === "18.5" ? "borderedProminent" : "glassProminent",
		);
		assert.equal(
			(native.props.style as Record<string, unknown> | undefined)
				?.backgroundColor,
			undefined,
		);
	}
});

test("Toggle passes Android accessibility semantics only to the native switch", () => {
	for (const platform of ["android", "ios", "web"]) {
		const onChange = () => {};
		const toggle = controls(platform).Toggle({
			label: "Wore contacts today",
			value: true,
			disabled: true,
			onChange,
		});
		const nativeSwitch = toggle.props.children as Element;
		if (platform === "web") {
			assert.equal(nativeSwitch.type, "label");
			const input = elements(nativeSwitch).find(
				(element) => element.type === "input",
			);
			assert.ok(input);
			assert.equal(input.props.type, "checkbox");
			assert.equal(input.props.role, "switch");
			assert.equal(input.props.checked, true);
			assert.equal(input.props.disabled, true);
			continue;
		}
		assert.equal(nativeSwitch.type, "NativeSwitch");
		assert.equal(nativeSwitch.props.value, true);
		assert.equal(nativeSwitch.props.disabled, true);
		assert.equal(nativeSwitch.props.onValueChange, onChange);
		if (platform === "android") {
			const modifiers = nativeSwitch.props.modifiers as {
				contentDescription: string;
			}[];
			assert.equal(modifiers.length, 1);
			assert.equal(modifiers[0].contentDescription, "Wore contacts today");
		} else {
			assert.equal(nativeSwitch.props.modifiers, undefined);
		}
	}
});

test("web fields retain RN accessible labels absent from Expo's universal input API", () => {
	const field = controls("web").Field({
		label: "Email",
		value: "",
		onChange: () => {},
	});
	const input = elements(field).find((node) => node.type === "TextInput");
	assert.ok(input);
	assert.ok(elements(field).some((node) => node.type === "RNHostView"));
	assert.equal(input.props.accessibilityLabel, "Email");
});

test("native lens editor disables every editable control while overview account recovery stays available", () => {
	const source = readFileSync(
		new URL("../../src/components/settings/form.tsx", import.meta.url),
		"utf8",
	);
	function elements(node: unknown): Element[] {
		if (Array.isArray(node)) return node.flatMap(elements);
		if (!node || typeof node !== "object" || !("props" in node)) return [];
		const element = node as Element;
		return [element, ...elements(element.props.children)];
	}
	for (const platform of ["ios", "android"]) {
		const mocks: Record<string, unknown> = {
			react: { useEffect: () => {}, useRef: () => ({ current: null }) },
			"./calendar": { localDateString: () => "2026-04-01" },
			"./days": { __esModule: true, default: "Days" },
			"./native-fields": { __esModule: true, default: "NativeFields" },
			"./section": { __esModule: true, default: "Section" },
			"./switch": { __esModule: true, default: "NativeSwitch" },
			"@expo/ui": {
				Host: "Host",
				Column: "Column",
				Button: "NativeButton",
				Switch: "NativeSwitch",
				Picker: "Picker",
				RNHostView: "RNHostView",
				FieldGroup: Object.assign(
					(props: Record<string, unknown>) => jsx("FieldGroup", props),
					{ Section: "Section", SectionFooter: "SectionFooter" },
				),
			},
			"../auth/field": { AuthField: "AuthField" },
			"../presentation": {
				ScreenFrame: "ScreenFrame",
				DateField: "DateField",
				PresentationText: "PresentationText",
				SemanticText: "SemanticText",
				notifySuccess: async () => {},
				usePresentationEpoch: () => 0,
				usePresentationTheme: () => ({ text: "black" }),
			},
			"react/jsx-runtime": { jsx, jsxs: jsx },
			"react-native": {
				ActivityIndicator: "ActivityIndicator",
				View: "View",
				Platform: { OS: platform },
				useWindowDimensions: () => ({ width: 1024 }),
			},
			"../ui": Object.fromEntries(
				["Button", "Card", "Choices", "Field", "Page", "Txt"].map((name) => [
					name,
					name,
				]),
			),
		};
		const exports = {} as { default: (props: unknown) => Element };
		runInNewContext(
			ts.transpileModule(source, {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					jsx: ts.JsxEmit.ReactJSX,
				},
			}).outputText,
			{
				exports,
				require: (name: string) => {
					assert.ok(name in mocks, name);
					return mocks[name];
				},
			},
		);
		const overview = {} as { default: (props: unknown) => Element };
		runInNewContext(
			ts.transpileModule(
				readFileSync(
					new URL(
						"../../src/components/settings/overview.tsx",
						import.meta.url,
					),
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
				exports: overview,
				require: (name: string) => {
					assert.ok(name in mocks, name);
					return mocks[name];
				},
			},
		);
		for (const disabled of [false, true]) {
			const page = exports.default({
				model: {
					draft: {
						differentIntervals: true,
						differentDates: true,
						leftDays: "14",
						rightDays: "30",
						leftOpened: "2026-04-01",
						rightOpened: "",
					},
					disabled,
					accountDisabled: false,
					fieldErrors: {},
					savedEvent: 0,
					error: "",
				},
			});
			assert.equal(page.type, "ScreenFrame");
			assert.equal(page.props.insetMode, "stack");
			assert.equal(page.props.scrollOwner, "content");
			const controls = elements(page).filter(
				(node) =>
					node.type === "DateField" ||
					node.type === "Days" ||
					node.type === "NativeSwitch",
			);
			assert.equal(
				controls.length,
				6,
				"both eyes' fields and both native switches must be covered",
			);
			for (const control of controls)
				assert.equal(control.props.disabled, disabled);
			const save = elements(page).find(
				(node) => node.props.label === "Save changes",
			);
			assert.equal(save?.props.disabled, disabled);
			assert.ok(save, "explicit schedule save remains available");
			assert.ok(
				!elements(page).some((node) => node.props.label === "Sign out"),
				"the focused editor does not own account actions",
			);
			for (const accountDisabled of [false, true]) {
				const accountPage = overview.default({
					model: { disabled, accountDisabled },
					summary: "14-day replacement",
					onEdit() {},
				});
				const signOut = elements(accountPage).find(
					(node) =>
						node.type === "NativeButton" && node.props.label === "Sign out",
				);
				assert.ok(signOut, "overview owns account recovery");
				assert.equal(signOut.props.disabled, accountDisabled);
			}
			const reset = elements(page).find(
				(node) => node.props.label === "Send password reset email",
			);
			assert.equal(reset, undefined, "password recovery is not an active flow");
		}
	}
});
