// biome-ignore-all lint/suspicious/noExplicitAny: VM mocks isolate native Expo APIs on Linux.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const root = new URL("../../", import.meta.url);
const valid = () => ({
	pageCount: 1,
	lines: [
		{
			text: "OD SPH -1.25",
			confidence: 0.95,
			x: 0.1,
			y: 0.1,
			width: 0.5,
			height: 0.1,
			page: 0,
		},
	],
});
function harness(native: any = null) {
	const exports: any = {};
	const dependencies: string[] = [];
	const output = ts.transpileModule(
		readFileSync(new URL("src/lib/prescriptions/ocr.ts", root), "utf8"),
		{
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2022,
			},
		},
	).outputText;
	runInNewContext(output, {
		exports,
		Set,
		Error,
		Object,
		decodeURIComponent,
		require(name: string) {
			dependencies.push(name);
			if (name === "expo") return { requireOptionalNativeModule: () => native };
			throw new Error(`Unexpected dependency ${name}`);
		},
	});
	return { api: exports, dependencies };
}

test("missing iOS native module preserves manual entry and no-op cleanup", async () => {
	{
		const { api } = harness(null);
		assert.equal(api.ocrAvailable(), false);
		assert.equal(api.scannerAvailable(), false);
		for (const operation of [
			() => api.scanPrescription(),
			() => api.importPrescriptionImage(),
			() => api.recognizePrescriptionImage("file:///cache/test.jpg"),
		]) {
			await assert.rejects(operation(), { code: "OCR_UNAVAILABLE" });
		}
		await api.cleanupPrescriptionImages();
	}
});

test("native output is bounded for scan and import; cancellation/errors are sanitized", async () => {
	let result: any = valid();
	let error: any;
	const recognize = async () => {
		if (error) throw error;
		return result;
	};
	const { api } = harness({
		scannerAvailable: () => true,
		scanPrescription: recognize,
		importPrescriptionImage: recognize,
	});
	assert.equal(api.scannerAvailable(), true);
	const output = await api.scanPrescription();
	assert.equal(output.lines[0].text, "OD SPH -1.25");
	assert.notEqual(output.lines, result.lines);
	for (const bad of [
		undefined,
		{ ...valid(), pageCount: 4 },
		{ ...valid(), lines: Array(601).fill(valid().lines[0]) },
		{ ...valid(), lines: [{ ...valid().lines[0], confidence: Number.NaN }] },
		{ ...valid(), lines: [{ ...valid().lines[0], page: 1 }] },
		{ ...valid(), lines: [{ ...valid().lines[0], text: "x".repeat(513) }] },
		{ ...valid(), lines: [{ ...valid().lines[0], text: "界".repeat(200) }] },
		{ ...valid(), lines: [{ ...valid().lines[0], x: 0.9 }] },
		{
			...valid(),
			lines: Array(150).fill({ ...valid().lines[0], text: "x".repeat(500) }),
		},
	]) {
		result = bad;
		await assert.rejects(api.scanPrescription());
		await assert.rejects(api.importPrescriptionImage());
	}
	result = null;
	assert.equal(await api.importPrescriptionImage(), null);
	await assert.rejects(api.scanPrescription());
	error = { code: "OCR_CANCELLED", message: "file:///private/secret.jpg" };
	await assert.rejects(api.importPrescriptionImage(), {
		code: "OCR_CANCELLED",
		message: "Scanning was cancelled.",
	});
	error = { code: "RANDOM", message: "private OCR text" };
	await assert.rejects(
		api.scanPrescription(),
		(e: any) => e.code === "OCR_FAILED" && !e.message.includes("private"),
	);
	error = null;
	result = valid();
	await api.scanPrescription();
});

test("network and traversal URIs never reach native; recognition never deletes source", async () => {
	const calls: string[] = [];
	const { api, dependencies } = harness({
		recognizePrescriptionImage: async (uri: string) => {
			calls.push(uri);
			return valid();
		},
	});
	for (const uri of [
		"https://example.test/rx.png",
		"ph://asset",
		"file:///cache/../Documents/rx.jpg",
		"file:///cache/%2e%2e/rx.jpg",
		"file:///cache/rx.jpg?query",
	]) {
		await assert.rejects(api.recognizePrescriptionImage(uri), {
			code: "OCR_INVALID_URI",
		});
	}
	assert.equal(calls.length, 0);
	await api.recognizePrescriptionImage("file:///cache/source.jpg");
	assert.deepEqual(calls, ["file:///cache/source.jpg"]);
	assert.deepEqual(dependencies, ["expo"]);
});

test("native import delegates without Expo picker/filesystem, and native cleanup remains independent of JS busy lock", async () => {
	let resolve: (value: any) => void = () => {};
	let cleanups = 0;
	const { api, dependencies } = harness({
		importPrescriptionImage: () =>
			new Promise((r) => {
				resolve = r;
			}),
		cleanupPrescriptionImages: async () => {
			cleanups++;
		},
	});
	const pending = api.importPrescriptionImage();
	for (const operation of [
		() => api.scanPrescription(),
		() => api.importPrescriptionImage(),
		() => api.recognizePrescriptionImage("file:///cache/image.jpg"),
	]) {
		await assert.rejects(operation(), { code: "OCR_BUSY" });
	}
	await api.cleanupPrescriptionImages();
	assert.equal(cleanups, 1);
	resolve(valid());
	assert.equal((await pending).pageCount, 1);
	const cancelled = api.importPrescriptionImage();
	resolve(null);
	assert.equal(await cancelled, null);
	assert.deepEqual(dependencies, ["expo"]);
});

test("cleanup errors are sanitized and native size failures release import lock", async () => {
	let code = "OCR_INPUT_TOO_LARGE";
	const { api } = harness({
		importPrescriptionImage: async () => {
			throw { code, message: "private source URL" };
		},
		cleanupPrescriptionImages: async () => {
			throw new Error("private URL");
		},
	});
	await assert.rejects(api.importPrescriptionImage(), { code });
	code = "OCR_CLEANUP_FAILED";
	await assert.rejects(api.importPrescriptionImage(), { code });
	await assert.rejects(
		api.cleanupPrescriptionImages(),
		(error: any) =>
			error.code === "OCR_CLEANUP_FAILED" && !error.message.includes("private"),
	);
});

test("Apple native contract: open-in-place bounded protected copies, source preservation, cancellation lifetime", () => {
	const config = JSON.parse(
		readFileSync(
			new URL("modules/prescription-ocr/expo-module.config.json", root),
			"utf8",
		),
	);
	assert.deepEqual(config.platforms, ["apple"]);
	assert.deepEqual(config.apple.modules, ["OculogPrescriptionOCRModule"]);
	const swift = readFileSync(
		new URL(
			"modules/prescription-ocr/ios/OculogPrescriptionOCRModule.swift",
			root,
		),
		"utf8",
	);
	for (const marker of [
		'Name("OculogPrescriptionOCR")',
		"forOpeningContentTypes: [.jpeg, .png, .heic, .heif], asCopy: false",
		"startAccessingSecurityScopedResource()",
		"defer { if scoped { source.stopAccessingSecurityScopedResource() } }",
		"size > Recognition.maxBytes",
		"count <= Recognition.maxBytes - total",
		"InputStream(url: source)",
		"FileProtectionType.complete",
		"active.insert(destination)",
		"defer { active.remove(destination) }",
		"!active.contains(file)",
		"values.isSymbolicLink != true",
		"resolvingSymlinksInPath()",
		"scan.pageCount <= 3",
		"kCGImageSourceCreateThumbnailWithTransform",
		"request?.cancel()",
		"self.operation?.cancel()",
		"promise = nil",
		"private let lock = NSLock()",
		"try operation.checkCancellation()",
		"defer { DispatchQueue.main.async { finish() } }",
		".runOnQueue(recognitionQueue)",
	])
		assert.ok(swift.includes(marker), marker);
	assert.ok(
		swift.indexOf("size > Recognition.maxBytes") <
			swift.indexOf("active.insert(destination)"),
	);
	const deletionTargets = [...swift.matchAll(/removeItem\(at: ([^)]+)\)/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(deletionTargets, ["file", "destination"]);
	assert.doesNotMatch(
		swift,
		/URLSession|print\(|@unchecked Sendable|@concurrent|DocumentPicker\/|copyItem\(/,
	);
	const pod = readFileSync(
		new URL("modules/prescription-ocr/ios/OculogPrescriptionOCR.podspec", root),
		"utf8",
	);
	assert.match(pod, /s.swift_version = '5.9'/);
	assert.match(pod, /s.platforms = \{ :ios => '16.4' \}/);
});
