import { requireOptionalNativeModule } from "expo";
import type { OCRLine, OCRResult } from "./ocr-parser";

interface NativeOCR {
	scannerAvailable(): boolean;
	scanPrescription(): Promise<unknown>;
	recognizePrescriptionImage(uri: string): Promise<unknown>;
	importPrescriptionImage(): Promise<unknown>;
	cleanupPrescriptionImages(): Promise<void>;
}

// Optional lookup is intentional: Expo Go must retain manual entry without crashing.
let native: NativeOCR | null = null;
try {
	native = requireOptionalNativeModule<NativeOCR>("OculogPrescriptionOCR");
} catch {
	// A missing development-build module is not an application startup failure.
}
let busy = false;

function failure(code: string): Error & { code: string } {
	return Object.assign(
		new Error(
			code === "OCR_CANCELLED"
				? "Scanning was cancelled."
				: "Image reading is unavailable. Try another image or enter values manually.",
		),
		{ code },
	);
}
const safeCodes = new Set([
	"OCR_CANCELLED",
	"OCR_BUSY",
	"OCR_SCANNER_UNAVAILABLE",
	"OCR_CAMERA_PERMISSION",
	"OCR_CAMERA_CONFIGURATION",
	"OCR_PRESENTATION_FAILED",
	"OCR_CAMERA_FAILED",
	"OCR_INVALID_URI",
	"OCR_INPUT_TOO_LARGE",
	"OCR_UNSUPPORTED_IMAGE",
	"OCR_TOO_MANY_PAGES",
	"OCR_RESULT_TOO_LARGE",
	"OCR_FAILED",
	"OCR_UNAVAILABLE",
	"OCR_CLEANUP_FAILED",
]);
function sanitized(error: unknown): Error {
	const code =
		error && typeof error === "object" && "code" in error ? error.code : null;
	return failure(
		typeof code === "string" && safeCodes.has(code) ? code : "OCR_FAILED",
	);
}
function moduleOrThrow(): NativeOCR {
	if (!native) throw failure("OCR_UNAVAILABLE");
	return native;
}
export function ocrAvailable(): boolean {
	return native !== null;
}
export function scannerAvailable(): boolean {
	try {
		return native?.scannerAvailable() === true;
	} catch {
		return false;
	}
}

function boundedResult(value: unknown): OCRResult {
	if (!value || typeof value !== "object") throw failure("OCR_FAILED");
	const result = value as Record<string, unknown>;
	if (
		!Number.isInteger(result.pageCount) ||
		(result.pageCount as number) < 1 ||
		(result.pageCount as number) > 3 ||
		!Array.isArray(result.lines) ||
		result.lines.length > 600
	) {
		throw failure("OCR_RESULT_TOO_LARGE");
	}
	let bytes = 0;
	const lines: OCRLine[] = result.lines.map((raw: unknown) => {
		if (!raw || typeof raw !== "object") throw failure("OCR_FAILED");
		const line = raw as Record<string, unknown>;
		if (typeof line.text !== "string" || line.text.length > 512)
			throw failure("OCR_FAILED");
		// Upper-bound UTF-8 bytes without assuming TextEncoder exists in Hermes.
		let textBytes = 0;
		for (const character of line.text) {
			const cp = character.codePointAt(0) ?? 0;
			textBytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
		}
		bytes += textBytes;
		if (textBytes > 512 || bytes > 60_000)
			throw failure("OCR_RESULT_TOO_LARGE");
		for (const key of ["confidence", "x", "y", "width", "height"]) {
			if (
				typeof line[key] !== "number" ||
				!Number.isFinite(line[key]) ||
				(line[key] as number) < 0 ||
				(line[key] as number) > 1
			)
				throw failure("OCR_FAILED");
		}
		if (
			!Number.isInteger(line.page) ||
			(line.page as number) < 0 ||
			(line.page as number) >= (result.pageCount as number) ||
			(line.x as number) + (line.width as number) > 1.00001 ||
			(line.y as number) + (line.height as number) > 1.00001
		)
			throw failure("OCR_FAILED");
		return {
			text: line.text,
			confidence: line.confidence as number,
			x: line.x as number,
			y: line.y as number,
			width: line.width as number,
			height: line.height as number,
			page: line.page as number,
		};
	});
	return { lines, pageCount: result.pageCount as number };
}

function localURI(uri: string): void {
	if (
		typeof uri !== "string" ||
		uri.length > 4096 ||
		!uri.startsWith("file:///")
	) {
		throw failure("OCR_INVALID_URI");
	}
	// Native also canonicalizes real paths and checks app cache/tmp containment.
	try {
		const decoded = decodeURIComponent(uri.slice(7));
		if (
			decoded.split("/").includes("..") ||
			uri.includes("?") ||
			uri.includes("#")
		) {
			throw failure("OCR_INVALID_URI");
		}
	} catch {
		throw failure("OCR_INVALID_URI");
	}
}
async function exclusive(
	work: () => Promise<OCRResult | null>,
): Promise<OCRResult | null> {
	moduleOrThrow();
	if (busy) throw failure("OCR_BUSY");
	busy = true;
	try {
		return await work();
	} catch (error) {
		throw sanitized(error);
	} finally {
		busy = false;
	}
}
export async function scanPrescription(): Promise<OCRResult> {
	return (await exclusive(async () =>
		boundedResult(await moduleOrThrow().scanPrescription()),
	)) as OCRResult;
}
export async function recognizePrescriptionImage(
	uri: string,
): Promise<OCRResult> {
	return (await exclusive(async () => {
		localURI(uri);
		return boundedResult(await moduleOrThrow().recognizePrescriptionImage(uri));
	})) as OCRResult;
}

/** Native cleanup excludes active copies and never touches provider/source files. */
export async function cleanupPrescriptionImages(): Promise<void> {
	if (!native) return;
	try {
		await native.cleanupPrescriptionImages();
	} catch {
		throw failure("OCR_CLEANUP_FAILED");
	}
}

export async function importPrescriptionImage(): Promise<OCRResult | null> {
	return exclusive(async () => {
		const result = await moduleOrThrow().importPrescriptionImage();
		return result === null ? null : boundedResult(result);
	});
}
