import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
type Element = {
	type: string;
	props: Record<string, unknown>;
};
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
				ref:
					| {
							current: unknown;
					  }
					| undefined,
				create: () => unknown,
			) => {
				if (ref) ref.current = create();
			},
		},
		"@expo/ui": {
			Host: "Host",
			Column: "Column",
			RNHostView: "RNHostView",
			Text: "NativeText",
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
		"./button-action-colors": {
			useButtonActionColors: () => ({
				accent: "#1D655C",
				onAccent: "#FFFFFF",
				muted: "#8E8E93",
			}),
		},
		"@expo/ui/swift-ui/modifiers": {
			fixedSize: (value: unknown) => ({ fixedSize: value }),
			multilineTextAlignment: (value: unknown) => ({
				multilineTextAlignment: value,
			}),
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
					`../../src/components/presentation/theme${""}.ts`,
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
					`../../src/components/presentation/native-field${""}.tsx`,
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
	const adapterExports = {};
	runInNewContext(
		ts.transpileModule(
			readFileSync(
				new URL("../../src/components/ui-controls.tsx", import.meta.url),
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
test("iOS surfaces follow the OS scheme", () => {
	for (const platform of ["ios"]) {
		const light = controls(platform).useColors();
		const dark = controls(platform, "dark").useColors();
		assert.equal(light.bg, "#F2F2F7");
		assert.equal(dark.bg, "#000000");
		assert.equal(light.text, "#000000");
		assert.equal(dark.text, "#FFFFFF");
		assert.equal(dark.card, "#1C1C1E");
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
test("native controls have a fresh content-sized Host at RN boundaries", () => {
	for (const platform of ["ios"]) {
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
		assert.equal(button.props.seedColor, "#1D655C");
		const nativeButton = button.props.children as Element;
		assert.equal(nativeButton.type, "NativeButton");
		assert.equal(nativeButton.props.disabled, true);
		assert.equal(
			(nativeButton.props.children as Element).props.children,
			"Save",
		);
		assert.equal(nativeButton.props.variant, "outlined");
		assert.equal((nativeButton.props.children as Element).type, "NativeText");
		{
			const modifiers = nativeButton.props.modifiers as {
				controlSize?: string;
				frame?: {
					minHeight: number;
				};
				tint?: string;
			}[];
			assert.equal(modifiers[0].controlSize, "regular");
			assert.equal(modifiers[1].frame?.minHeight, 44);
			assert.equal(modifiers[2].tint, "#8E8E93");
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
			(
				host.props.matchContents as {
					vertical: boolean;
				}
			).vertical,
			true,
		);
		const input = elements(host).find(
			(node) => node.type === "NativeTextInput",
		);
		assert.ok(input);
		{
			assert.equal(input.props.secureTextEntry, true);
			assert.equal(input.props.style, undefined);
			assert.deepEqual(JSON.parse(JSON.stringify(input.props.modifiers)), [
				{ label: "Password" },
				{ font: { textStyle: "body" } },
				{ textFieldStyle: "roundedBorder" },
				{ frame: { minHeight: 44 } },
			]);
		}
		assert.equal(input.props.autoComplete, "current-password");
		const inputStyle = (input.props.style ?? {}) as Record<string, unknown>;
		assert.equal(
			inputStyle.borderWidth,
			undefined,
			"native forms own row decoration",
		);
		assert.equal(
			(
				input.props.textStyle as {
					color: string;
				}
			).color,
			"#000000",
		);
		assert.equal(
			(
				input.props.value as {
					value: string;
				}
			).value,
			"secret",
		);
		assert.equal((input.props.modifiers as unknown[]).length, 4);
		assert.equal(
			inputStyle.height,
			undefined,
			"fields grow with large system text",
		);
	}
});
test("full-width buttons constrain native content using SwiftUI frames", () => {
	for (const platform of ["ios"]) {
		const button = controls(platform).Button({
			title: "Sign in",
			fullWidth: true,
			onPress: () => {},
		});
		assert.equal(
			(
				button.props.style as {
					width: string;
				}
			).width,
			"100%",
			"Host remains an RN layout boundary",
		);
		const native = button.props.children as Element;
		assert.equal(native.props.style, undefined);
		const modifiers = native.props.modifiers as {
			fillMaxWidth?: boolean;
			frame?: {
				maxWidth?: number;
			};
		}[];
		assert.ok(
			modifiers.some((modifier) => modifier.frame?.maxWidth === Infinity),
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
		const modifiers = native.props.modifiers as {
			buttonStyle?: string;
		}[];
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
test("Toggle passes labelled state to the native switch", () => {
	for (const platform of ["ios"]) {
		const onChange = () => {};
		const toggle = controls(platform).Toggle({
			label: "Wore contacts today",
			value: true,
			disabled: true,
			onChange,
		});
		const nativeSwitch = toggle.props.children as Element;
		assert.equal(nativeSwitch.type, "NativeSwitch");
		assert.equal(nativeSwitch.props.value, true);
		assert.equal(nativeSwitch.props.disabled, true);
		assert.equal(nativeSwitch.props.onValueChange, onChange);
		{
			assert.equal(nativeSwitch.props.modifiers, undefined);
		}
	}
});
test("native lens editor disables every editable control while overview account recovery stays available", () => {
	const source = readFileSync(
		new URL(
			"../../src/components/settings/lens-setup-fields.tsx",
			import.meta.url,
		),
		"utf8",
	);
	function elements(node: unknown): Element[] {
		if (Array.isArray(node)) return node.flatMap(elements);
		if (!node || typeof node !== "object" || !("props" in node)) return [];
		const element = node as Element;
		return [element, ...elements(element.props.children)];
	}
	for (const platform of ["ios"]) {
		const mocks: Record<string, unknown> = {
			react: {
				useEffect: () => {},
				useCallback: (fn: unknown) => fn,
				useRef: (current: unknown) => ({ current }),
			},
			"../presentation/theme": {
				usePresentationTheme: () => ({ text: "black", secondary: "gray" }),
			},
			"../native-input": { __esModule: true, default: "NativeInput" },
			"./editor-date": { __esModule: true, default: "EditorDate" },
			"../native-page": {
				PageToggle: "PageToggle",
				NativePage: "NativePage",
				NativeSection: "NativeSection",
				NativeRow: "NativeRow",
				NativeStack: "NativeStack",
				NativeText: "NativeText",
				NativeAction: "NativeAction",
			},
			"./editor-link": { __esModule: true, default: "EditorLink" },
			"./overview-summary": { supportingLines: () => [] },
			"@expo/ui/swift-ui/modifiers": Object.fromEntries(
				[
					"accessibilityAddTraits",
					"buttonStyle",
					"fixedSize",
					"font",
					"foregroundStyle",
					"frame",
					"glassEffect",
					"tint",
				].map((name) => [name, (value: unknown) => ({ name, value })]),
			),

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
		const exports = {} as {
			LensSetupFields: (props: unknown) => Element;
		};
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
		const overview = {} as {
			default: (props: unknown) => Element;
		};
		runInNewContext(
			ts.transpileModule(
				readFileSync(
					new URL(
						"../../src/components/settings/overview-content.tsx",
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
			const page = exports.LensSetupFields({
				change() {},
				current: () => true,
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
					validationEvent: 0,
					canLeave: () => true,
					error: "",
				},
			});
			const controls = elements(page).filter(
				(node) =>
					node.type === "EditorDate" ||
					node.type === "NativeInput" ||
					node.type === "PageToggle",
			);
			assert.equal(
				controls.length,
				6,
				"both eyes' fields and both native switches must be covered",
			);
			for (const control of controls)
				assert.equal(control.props.disabled, disabled);
			const editor = readFileSync(
				new URL(
					"../../src/components/settings/editor-form.tsx",
					import.meta.url,
				),
				"utf8",
			);
			assert.match(editor, /disabled=\{model.disabled\}/);
			assert.match(
				editor,
				/if \(current\(\) && !model.disabled && model.canLeave\(\)\)\s+model.save\(\)/,
			);
			assert.ok(
				!elements(page).some((node) => node.props.label === "Sign out"),
				"the focused editor does not own account actions",
			);
			for (const accountDisabled of [false, true]) {
				const accountPage = overview.default({
					model: {
						disabled,
						accountDisabled,
						draft: {},
						email: "test@example.com",
					},
					summary: "14-day replacement",
					onEdit() {},
				});
				const signOut = elements(accountPage).find(
					(node) =>
						node.type === "NativeAction" && node.props.label === "Sign out",
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
