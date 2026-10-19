import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SimpleState } from "../../shared/simple-domain";
import * as helpers from "../../src/components/home/add-intent";
import * as model from "../../src/components/home/model";
import * as webTypography from "../../src/components/presentation/web-typography";
import * as controller from "../../src/lib/simple-controller";

type Element = { type: unknown; props: Record<string, unknown> };
const jsx = (type: unknown, props: Record<string, unknown>): Element => ({
	type,
	props,
});
function elements(node: unknown): Element[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!node || typeof node !== "object" || !("props" in node)) return [];
	const element = node as Element;
	return [element, ...elements(element.props.children)];
}
function find(node: Element, type: string, title?: string) {
	const found = elements(node).find(
		(item) =>
			(item.type === type ||
				(typeof item.type === "function" && item.type.name === type)) &&
			(title === undefined || (item.props.title ?? item.props.label) === title),
	);
	assert.ok(found, `${type} ${title ?? ""} should exist`);
	return found;
}
function invoke(node: Element, callback: string, ...args: unknown[]) {
	return (node.props[callback] as (...values: unknown[]) => unknown)(...args);
}
function load(path: string, mocks: Record<string, unknown>, append = "") {
	const source = readFileSync(new URL(path, import.meta.url), "utf8");
	const output = ts.transpileModule(source + append, {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;
	const exports: Record<string, (props?: unknown) => Element> = {};
	runInNewContext(output, {
		exports,
		require: (name: string) => {
			assert.ok(name in mocks, name);
			return mocks[name];
		},
	});
	return exports;
}
function harness() {
	const state: SimpleState = {
		today: "2026-04-01",
		timeZone: "UTC",
		eyes: ["left", "right"].map((eye) => ({
			id: null,
			eye: eye as "left" | "right",
			replacementDays: 14,
			openedOn: "2026-03-20",
			dueOn: "2026-04-03",
			spareCount: 2,
			daysRemaining: 2,
		})),
		daily: { localDate: "2026-04-01", worn: null },
	};
	const hooks: unknown[] = [];
	let cursor = 0;
	let confirmed: boolean | Promise<boolean> = true;
	let failRight = false;
	const calls: { route: string; body: Record<string, unknown> }[] = [];
	const routes: string[] = [];
	const confirmations: { title: string; message: string }[] = [];
	const work: Promise<unknown>[] = [];
	const dimensions = { width: 390, height: 844, fontScale: 1 };
	const store = {
		state,
		online: true,
		loading: false,
		pending: false,
		error: "",
		reload: async () => {},
		account: { id: "a" },
		mutate: async (route: string, body: Record<string, unknown>) => {
			calls.push({ route, body: { ...body } });
			if (failRight && body.eye === "right") throw new Error("offline");
			return true;
		},
	};
	let reloads = 0;
	store.reload = async () => {
		reloads++;
	};
	let haptics = 0;
	const presentation = {
		SemanticText: "SemanticText",
		PresentationText: "PresentationText",
		NativeSheet: "NativeSheet",
		ScreenFrame: "ScreenFrame",
		usePresentationEpoch: () => 0,
		usePresentationTheme: () => ({ background: "white", primary: "teal" }),
		notifySuccess: async () => {
			haptics++;
		},
	};
	const mocks: Record<string, unknown> = {
		"./presentation": presentation,
		"../presentation": presentation,
		"../presentation/web-typography": webTypography,
		"@expo/ui/jetpack-compose/modifiers": {
			semantics: (value: unknown) => value,
			fillMaxWidth: () => ({ name: "fillMaxWidth" }),
			weight: (value: number) => ({ name: "weight", value }),
		},
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		react: {
			useEffect: () => {},
			useState: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = initial;
				return [
					hooks[index],
					(value: unknown) => {
						hooks[index] = value;
					},
				];
			},
			useRef: (initial: unknown) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = { current: initial };
				return hooks[index];
			},
		},
		"react-native": {
			Platform: { OS: "ios" },
			useColorScheme: () => "light",
			ScrollView: "ScrollView",
			Text: "Text",
			View: "View",
			Pressable: "Pressable",
			useWindowDimensions: () => dimensions,
		},
		"@expo/ui": {
			Button: "Button",
			Column: "Column",
			Row: "Row",
			Host: "Host",
			FieldGroup: Object.assign(function FieldGroup() {}, {
				Section: "Section",
				SectionFooter: "SectionFooter",
			}),
		},
		"@expo/ui/swift-ui/modifiers": {
			frame: (value: unknown) => value,
			accessibilityLabel: (value: unknown) => value,
			accessibilityValue: (value: unknown) => value,
			accessibilityAddTraits: (value: unknown) => value,
		},
		"expo-router": {
			useRouter: () => ({ push: (path: string) => routes.push(path) }),
		},
		"../lib/simple-controller": controller,
		"../lib/api": { sessionStore: { token: "token", account: { id: "a" } } },
		"../lib/store": { useStore: () => store },
		"./home/add-intent": helpers,
		"./home/daily-choice": { DailyChoice: "DailyChoice" },
		"./ui": {
			...Object.fromEntries(
				["Button", "Card", "Choices", "Feedback", "Field", "Page", "Txt"].map(
					(name) => [name, name],
				),
			),
			styles: { row: {} },
			useColors: () => ({ card: "white", text: "black", danger: "red" }),
			confirm: async (title: string, message: string) => {
				confirmations.push({ title, message });
				return confirmed;
			},
			useAction: () => ({
				busy: false,
				run: (fn: () => Promise<unknown>) => {
					const promise = fn().catch(() => false);
					work.push(promise);
					return promise;
				},
			}),
		},
	};
	const content = load("../../src/components/home/HomeContent.tsx", {
		...mocks,
		"../ui": mocks["./ui"],
		"./daily-choice": mocks["./home/daily-choice"],
		"./model": model,
	});
	mocks["./home/HomeContent"] = { __esModule: true, default: content.default };
	mocks["./home/AddContactsForm"] = {
		__esModule: true,
		default: function AddContactsForm() {},
	};
	const sheet = load("../../src/components/home/AddContactsSheet.tsx", {
		...mocks,
		"../ui": mocks["./ui"],
		"./AddContactsForm": mocks["./home/AddContactsForm"],
	});
	mocks["./home/AddContactsSheet"] = {
		__esModule: true,
		default: sheet.default,
	};
	const exports = {
		...content,
		...load("../../src/components/simple-home.tsx", mocks),
	};
	return {
		exports,
		dimensions,
		store,
		calls,
		confirmations,
		haptics: () => haptics,
		reloads: () => reloads,
		routes,
		mocks,
		render: () => {
			cursor = 0;
			const home = exports.default();
			function expand(node: unknown): unknown {
				if (Array.isArray(node)) return node.map(expand);
				if (!node || typeof node !== "object" || !("props" in node))
					return node;
				const element = node as Element;
				if (element.type === content.default)
					return expand(content.default(element.props));
				if (element.type === sheet.default)
					return expand(sheet.default(element.props));
				element.props.children = expand(element.props.children);
				return element;
			}
			return expand(home) as Element;
		},
		flush: () => Promise.all(work.splice(0)),
		confirm: (value: boolean | Promise<boolean>) => {
			confirmed = value;
		},
		failRight: (value: boolean) => {
			failRight = value;
		},
	};
}

test("Android eye headings are constrained Compose text without the RN measurement bridge", () => {
	const h = harness();
	const android = load("../../src/components/home/HomeContent.android.tsx", {
		...h.mocks,
		"@expo/ui/jetpack-compose": {
			Column: "Column",
			Row: "Row",
			Host: "Host",
			Text: "ComposeText",
		},
		"../settings/material-section.android": {
			MaterialSection: "MaterialSection",
		},
		"../settings/native-fields": { __esModule: true, default: "NativeFields" },
		"./daily-choice": { DailyChoice: "DailyChoice" },
		"./model": model,
	});
	for (const fontScale of [1, 1.5]) {
		for (const settings of h.store.state.eyes) {
			const row = android.EyeCard({
				settings,
				disabled: false,
				stacked: fontScale > 1,
			});
			const heading = find(row, "ComposeText");
			assert.equal(
				heading.props.children,
				`${settings.eye === "left" ? "Left" : "Right"} lens`,
			);
			assert.deepEqual(JSON.parse(JSON.stringify(heading.props.style)), {
				typography: "titleMedium",
			});
			assert.deepEqual(JSON.parse(JSON.stringify(heading.props.modifiers)), [
				{ name: "fillMaxWidth" },
			]);
			assert.equal(heading.props.maxLines, undefined);
			assert.equal(
				elements(row).some(
					(node) => node.type === "SemanticText" && node.props.heading,
				),
				false,
			);
		}
	}
});

test("eye countdown uses server days and no spare omits replacement", () => {
	const h = harness();
	const settings = {
		...h.store.state.eyes[0],
		daysRemaining: -1,
		spareCount: 0,
	};
	const eye = h.exports.EyeCard({
		settings,
		disabled: false,
		onReplace: () => {},
		onSettings: () => {},
	});
	assert.ok(
		elements(eye).some((node) => node.props.children === "1 day overdue"),
	);
	assert.ok(
		elements(eye).some(
			(node) => node.props.children === "Add spares to replace this lens.",
		),
	);
	assert.equal(
		elements(eye).filter((node) => node.type === "Button").length,
		0,
	);
	settings.daysRemaining = 0;
	const today = h.exports.EyeCard({
		settings,
		disabled: false,
		onReplace: () => {},
		onSettings: () => {},
	});
	assert.ok(
		elements(today).some((node) => node.props.children === "Replace today"),
	);
});

test("native and web lens labels distinguish configured unopened lenses from replacements", () => {
	const h = harness();
	const web = load("../../src/components/home/HomeContent.web.tsx", {
		...h.mocks,
		"./daily-choice": { DailyChoice: "DailyChoice" },
		"./model": model,
	});
	for (const settings of h.store.state.eyes) {
		for (const openedOn of [null, "2026-03-20"]) {
			settings.openedOn = openedOn;
			settings.dueOn = openedOn ? "2026-04-03" : null;
			settings.daysRemaining = openedOn ? 2 : null;
			const label = `${openedOn === null ? "Open" : "Replace"} ${settings.eye} lens`;
			const props = {
				state: h.store.state,
				settings,
				disabled: false,
				onReplace: () => {},
				onSettings: () => {},
				onLog: () => {},
				onAdd: () => {},
			};
			assert.equal(
				find(h.exports.EyeCard(props), "Button", label).props.disabled,
				false,
			);
			assert.ok(
				elements(web.default(props)).some(
					(node) =>
						node.type === "PresentationText" && node.props.children === label,
				),
			);
		}
		settings.openedOn = null;
		settings.replacementDays = null;
		assert.equal(
			elements(h.exports.EyeCard({ settings, disabled: false })).filter(
				(node) => node.type === "Button",
			).length,
			0,
		);
		assert.equal(
			model.eyeSummary(settings).actionLabel,
			`Replace ${settings.eye} lens`,
		);
	}
});

test("unconfigured Home shares one setup action and preserves the other eye action", () => {
	const h = harness();
	const web = load("../../src/components/home/HomeContent.web.tsx", {
		...h.mocks,
		"./daily-choice": { DailyChoice: "DailyChoice" },
		"./model": model,
	});
	for (const unconfigured of [1, 2]) {
		for (const eye of h.store.state.eyes.slice(0, unconfigured)) {
			eye.replacementDays = null;
			eye.openedOn = null;
			eye.dueOn = null;
			eye.daysRemaining = null;
		}
		const native = h.render();
		assert.equal(
			elements(native).filter((node) => node.props.label === "Lens setup")
				.length,
			1,
		);
		for (const eye of h.store.state.eyes.slice(0, unconfigured)) {
			const summary = model.eyeSummary(eye);
			assert.equal(summary.countdown, "Replacement interval not set");
			assert.equal(summary.due, null);
		}
		for (const openedOn of [null, "2026-03-20"]) {
			h.store.state.eyes[1].openedOn = openedOn;
			const tree = web.default({
				state: h.store.state,
				disabled: false,
				onSettings: () => {},
			});
			const text = elements(tree).map((node) => node.props.children);
			assert.equal(text.filter((value) => value === "Lens setup").length, 1);
			assert.equal(
				text.filter((value) => value === "Replacement interval not set").length,
				unconfigured,
			);
			if (unconfigured === 1) {
				assert.ok(text.includes(`${openedOn ? "Replace" : "Open"} right lens`));
				assert.ok(
					find(
						h.exports.EyeCard({
							settings: h.store.state.eyes[1],
							disabled: false,
						}),
						"Button",
						`${openedOn ? "Replace" : "Open"} right lens`,
					),
				);
			}
		}
	}
});

test("opening confirmation uses the target eye state and preserves cancellation and replace API", async () => {
	for (const target of ["left", "right"] as const) {
		for (const opening of [true, false]) {
			const h = harness();
			h.store.state.timeZone = "Pacific/Kiritimati";
			const settings = h.store.state.eyes.find((eye) => eye.eye === target);
			assert.ok(settings);
			settings.openedOn = opening ? null : "2026-03-20";
			settings.dueOn = opening ? null : "2026-04-03";
			settings.daysRemaining = opening ? null : 2;
			h.confirm(false);
			invoke(find(h.render(), "EyeCard"), "onReplace", target);
			await h.flush();
			assert.deepEqual(h.calls, []);
			assert.deepEqual(h.confirmations[0], {
				title: `${opening ? "Open" : "Replace"} ${target} lens?`,
				message: opening
					? "Opening uses one spare and records your account’s current calendar date as the opening date. Your replacement interval starts on that date."
					: "This uses one spare and starts a new calendar interval today.",
			});
			h.confirm(true);
			invoke(find(h.render(), "EyeCard"), "onReplace", target);
			await h.flush();
			assert.deepEqual(h.calls, [{ route: "replace", body: { eye: target } }]);
		}
	}
});

test("replacement cancellation is nonmutating and confirmed replacement targets one eye", async () => {
	const h = harness();
	h.confirm(false);
	invoke(find(h.render(), "EyeCard"), "onReplace", "left");
	await h.flush();
	assert.equal(h.calls.length, 0);
	h.confirm(true);
	invoke(find(h.render(), "EyeCard"), "onReplace", "right");
	await h.flush();
	assert.deepEqual(h.calls, [{ route: "replace", body: { eye: "right" } }]);
});

test("daily check-in shows unknown explicitly and writes the authoritative server day", async () => {
	const h = harness();
	const section = h.exports.DailyLogSection({
		state: h.store.state,
		disabled: false,
		onLog: () => {},
	});
	assert.equal(find(section, "DailyChoice").props.worn, null);
	invoke(find(h.render(), "DailyLogSection"), "onLog", false);
	await h.flush();
	assert.deepEqual(h.calls, [
		{ route: "day", body: { localDate: "2026-04-01", worn: false } },
	]);
});

test("web daily radios leave unknown unchecked and control Yes/No selection", () => {
	const h = harness();
	const choices = load("../../src/components/home/daily-choice.tsx", {
		...h.mocks,
		"react-native": {
			Platform: { OS: "web" },
			View: "View",
			Pressable: "Pressable",
			Text: "Text",
		},
	});
	const values: boolean[] = [];
	for (const worn of [null, true, false]) {
		const node = choices.DailyChoice({
			worn,
			disabled: false,
			onLog: (value: boolean) => values.push(value),
		});
		assert.equal(node.props.accessibilityLabel, "Did you wear lenses today?");
		const radios = elements(node).filter(
			(item) => item.props.accessibilityRole === "radio",
		);
		assert.equal(radios.length, 2);
		assert.deepEqual(
			radios.map(
				(radio) =>
					(radio.props.accessibilityState as { checked: boolean }).checked,
			),
			[worn === true, worn === false],
		);
		assert.deepEqual(
			radios.map((radio) => radio.props.accessibilityLabel),
			["Did you wear lenses today: Yes", "Did you wear lenses today: No"],
		);
		for (const radio of radios) {
			assert.equal(radio.props.disabled, false);
			invoke(radio, "onPress");
		}
	}
	assert.deepEqual(values, [true, false, true, false, true, false]);
	const disabled = choices.DailyChoice({
		worn: null,
		disabled: true,
		onLog: (value: boolean) => values.push(value),
	});
	for (const radio of elements(disabled).filter(
		(item) => item.props.accessibilityRole === "radio",
	)) {
		assert.equal(
			(radio.props.accessibilityState as { disabled: boolean }).disabled,
			true,
		);
		invoke(radio, "onPress");
	}
	assert.equal(values.length, 6);
	assert.ok(
		elements(disabled)
			.filter((item) => item.type === "Pressable")
			.every((button) => button.props.disabled === true),
	);
});

test("Home delegates insets and scrolling and keeps rows intrinsic at every text scale", () => {
	const h = harness();
	for (const [width, fontScale] of [
		[390, 1],
		[760, 1],
		[960, 1.5],
		[1440, 2],
	]) {
		Object.assign(h.dimensions, { width, fontScale });
		const home = h.render();
		assert.equal(home.props.title, "Today");
		assert.equal(home.props.insetMode, "tabs");
		assert.equal(home.props.scrollOwner, "content");
		assert.equal(
			elements(home).filter((node) => node.type === "Host").length,
			1,
		);
		assert.equal(
			elements(home).filter(
				(node) =>
					typeof node.type === "function" && node.type.name === "EyeCard",
			).length,
			2,
		);
	}
	// NativeSheet owns keyboard avoidance and scrolling; the form must not nest another scroller.
	assert.equal(
		elements(h.render()).filter((node) => node.type === "ScrollView").length,
		0,
	);
	assert.ok(find(h.render(), "NativeSheet"));
	const eye = h.exports.EyeCard({
		settings: h.store.state.eyes[0],
		disabled: false,
		onReplace: () => {},
		onSettings: () => {},
	});
	assert.equal((eye.props.style as Record<string, unknown>).height, undefined);
	assert.equal(find(eye, "Button").props.variant, "outlined");
});

test("daily question and acknowledgement reflect the controlled server choice", () => {
	const h = harness();
	for (const worn of [null, true, false]) {
		h.store.state.daily.worn = worn;
		const section = h.exports.DailyLogSection({
			state: h.store.state,
			disabled: false,
			onLog: () => {},
		});
		const text = elements(section)
			.filter((item) => item.type === "SemanticText")
			.map((item) => item.props.children);
		assert.ok(text.includes("Did you wear lenses today?"));
		assert.ok(
			text.includes(
				worn === null ? "Not recorded" : `Recorded: ${worn ? "Yes" : "No"}`,
			),
		);
		assert.equal(find(section, "DailyChoice").props.worn, worn);
	}
});

test("partial Add both survives dismissal and reopens locked without double increment", async () => {
	const h = harness();
	invoke(find(h.render(), "Button", "Add spares"), "onPress");
	h.failRight(true);
	invoke(find(h.render(), "AddContactsForm"), "onAdd");
	await h.flush();
	assert.equal(find(h.render(), "AddContactsForm").props.locked, true);
	assert.equal(h.haptics(), 0);
	invoke(find(h.render(), "NativeSheet"), "onDismiss");
	assert.equal(find(h.render(), "NativeSheet").props.presented, false);
	invoke(find(h.render(), "Button", "Add spares"), "onPress");
	h.failRight(false);
	invoke(find(h.render(), "AddContactsForm"), "onAdd");
	await h.flush();
	assert.deepEqual(
		h.calls.map((call) => call.body.eye),
		["left", "right", "right"],
	);
	assert.equal(find(h.render(), "NativeSheet").props.presented, false);
	assert.equal(h.haptics(), 1);
});

test("pending system dismissal retains form and disables reopening; setup navigates", () => {
	const h = harness();
	invoke(find(h.render(), "Button", "Add spares"), "onPress");
	h.store.pending = true;
	invoke(find(h.render(), "NativeSheet"), "onDismiss");
	const sheet = find(h.render(), "NativeSheet");
	assert.equal(sheet.props.presented, false);
	assert.equal(find(h.render(), "AddContactsForm").props.quantity, "1");
	assert.equal(find(h.render(), "Button", "Add spares").props.disabled, true);
	assert.equal(sheet.props.busy, true);
	h.store.state.eyes[0].replacementDays = null;
	invoke(find(h.render(), "Button", "Lens setup"), "onPress");
	assert.deepEqual(h.routes, ["/lens-editor"]);
});

test("a confirmation opened by another account cannot write after session changes", async () => {
	const h = harness();
	let accept: (value: boolean) => void = () => {};
	h.confirm(
		new Promise<boolean>((resolve) => {
			accept = resolve;
		}),
	);
	invoke(find(h.render(), "EyeCard"), "onReplace", "left");
	h.store.account.id = "b";
	h.render();
	accept(true);
	await h.flush();
	assert.equal(h.calls.length, 0);
});

test("Add both stops between eyes if the account changes during the first write", async () => {
	const h = harness();
	let finish: (value: boolean) => void = () => {};
	h.store.mutate = async (route, body) => {
		h.calls.push({ route, body });
		return new Promise<boolean>((resolve) => {
			finish = resolve;
		});
	};
	invoke(find(h.render(), "AddContactsForm"), "onAdd");
	h.store.account.id = "b";
	h.render();
	finish(true);
	await h.flush();
	assert.deepEqual(
		h.calls.map((call) => call.body.eye),
		[],
	);
	assert.equal(h.haptics(), 0);
});

test("shared Add form retains controlled adapters, locked retry explanation and finish action", () => {
	const values: string[] = [];
	const form = load("../../src/components/home/AddContactsForm.tsx", {
		"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
		"../presentation": {
			ChoiceControl: "ChoiceControl",
			PresentationText: "PresentationText",
		},
		"../ui": { Field: "Field", Button: "Button" },
		"./model": model,
	}).default({
		eye: "both",
		quantity: "3",
		disabled: false,
		locked: true,
		onEyeChange: (value: string) => values.push(value),
		onQuantityChange: (value: string) => values.push(value),
		onAdd: () => {},
	});
	assert.equal(find(form, "ChoiceControl").props.value, "both");
	assert.equal(find(form, "ChoiceControl").props.disabled, true);
	assert.equal(find(form, "Field").props.value, "3");
	assert.equal(find(form, "Field").props.disabled, true);
	assert.equal(find(form, "Field").props.label, "Quantity per eye");
	assert.equal(
		find(form, "Button", "Finish adding spares").props.disabled,
		false,
	);
	assert.equal(
		find(form, "PresentationText").props.children,
		model.additionHint("both", true),
	);
	invoke(find(form, "Field"), "onChange", "4");
	invoke(find(form, "ChoiceControl"), "onChange", "right");
	assert.deepEqual(values, ["4", "right"]);
});

test("dismissal preserves controlled quantity and eye drafts", () => {
	const h = harness();
	invoke(find(h.render(), "AddContactsForm"), "onEyeChange", "right");
	invoke(find(h.render(), "AddContactsForm"), "onQuantityChange", "7");
	invoke(find(h.render(), "NativeSheet"), "onDismiss");
	invoke(find(h.render(), "Button", "Add spares"), "onPress");
	const form = find(h.render(), "AddContactsForm");
	assert.equal(form.props.eye, "right");
	assert.equal(form.props.quantity, "7");
});

test("stale records disable writes, retain feedback, and offer manual retry", async () => {
	const h = harness();
	h.store.online = false;
	h.store.error = "Connection lost";
	const tree = h.render();
	assert.equal(find(tree, "Button", "Add spares").props.disabled, true);
	assert.equal(find(tree, "AddContactsForm").props.disabled, true);
	invoke(find(tree, "AddContactsForm"), "onAdd");
	invoke(find(tree, "DailyLogSection"), "onLog", true);
	invoke(find(tree, "EyeCard"), "onReplace", "left");
	await h.flush();
	assert.equal(h.calls.length, 0);
	assert.equal(h.haptics(), 0);
	assert.ok(
		elements(tree).some((node) => node.props.children === "Connection lost"),
	);
	invoke(find(tree, "Button", "Retry connection"), "onPress");
	assert.equal(h.reloads(), 1);
});
