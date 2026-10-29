import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { PresentationTheme } from "../../src/components/presentation/theme";

const source = readFileSync(
	new URL("../../src/components/presentation/theme.ts", import.meta.url),
	"utf8",
);
function luminance(hex: string) {
	const parts = hex.slice(1).match(/../g);
	assert.ok(parts);
	const rgb = parts.map((part) => {
		const value = Number.parseInt(part, 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
	const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (values[0] + 0.05) / (values[1] + 0.05);
}
