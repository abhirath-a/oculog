import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { inflateSync } from "node:zlib";
import ts from "typescript";

const source = readFileSync(
	new URL("../../src/components/brand/wordmark.tsx", import.meta.url),
	"utf8",
);
const svg = readFileSync(
	new URL("../../../assets/logo.svg", import.meta.url),
	"utf8",
);
function component() {
	const exports: Record<string, any> = {};
	runInNewContext(
		ts.transpileModule(source, {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				jsx: ts.JsxEmit.ReactJSX,
			},
		}).outputText,
		{
			exports,
			require(name: string) {
				if (name === "react-native") return { Image: "Image" };
				if (name === "react/jsx-runtime")
					return { jsx: (type: any, props: any) => ({ type, props }) };
				if (name === "./wordmark-mask.png") return "brand-alpha-mask";
				throw new Error(`Unexpected brand dependency ${name}`);
			},
		},
	);
	return exports.BrandWordmark;
}

test("the supplied SVG stays authoritative and retains its currentColor fill and stroke", () => {
	assert.match(svg, /fill="currentColor"/);
	assert.match(svg, /stroke="currentColor"/);
	assert.match(svg, /viewBox="0 0 359 94"/);
	assert.doesNotMatch(
		source,
		/expo-file-system|sessionStore|@expo\/ui|Host|Pressable|onPress/,
	);
});

test("the actual wordmark follows light/dark/high-contrast ink without a new native dependency", () => {
	const Brand = component();
	for (const color of ["#192720", "#EDF3F0", "#000000", "#FFFFFF"]) {
		const node = Brand({ color });
		assert.equal(node.type, "Image");
		assert.equal(node.props.tintColor, color);
		assert.equal(node.props.source, "brand-alpha-mask");
		assert.equal(node.props.resizeMode, "contain");
		assert.equal(node.props.accessibilityLabel, "Oculog");
		assert.equal(node.props.accessibilityRole, "image");
		assert.equal(node.props.style.width, 112);
		assert.equal(node.props.style.height, (112 * 94) / 359);
		assert.equal(node.props.style.flexShrink, 0);
	}
});

test("generated mask preserves transparent margins and antialiased ink, not an opaque white rectangle", () => {
	const png = readFileSync(
		new URL("../../src/components/brand/wordmark-mask.png", import.meta.url),
	);
	assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	const width = png.readUInt32BE(16),
		height = png.readUInt32BE(20);
	assert.equal(width, 1077);
	assert.equal(height, 282);
	assert.equal(png[24], 8);
	assert.equal(png[25], 6);
	const chunks: Buffer[] = [];
	for (let p = 8; p < png.length; ) {
		const length = png.readUInt32BE(p);
		if (png.toString("ascii", p + 4, p + 8) === "IDAT")
			chunks.push(png.subarray(p + 8, p + 8 + length));
		p += 12 + length;
	}
	const encoded = inflateSync(Buffer.concat(chunks));
	const stride = width * 4;
	let previous = Buffer.alloc(stride);
	let offset = 0;
	let transparent = 0,
		ink = 0,
		antialias = 0;
	const paeth = (a: number, b: number, c: number) => {
		const p = a + b - c,
			pa = Math.abs(p - a),
			pb = Math.abs(p - b),
			pc = Math.abs(p - c);
		return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
	};
	for (let y = 0; y < height; y++) {
		const filter = encoded[offset++]!;
		assert.ok(filter <= 4);
		const row = Buffer.alloc(stride);
		for (let x = 0; x < stride; x++) {
			const a = x >= 4 ? row[x - 4]! : 0,
				b = previous[x]!,
				c = x >= 4 ? previous[x - 4]! : 0;
			const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][
				filter
			]!;
			row[x] = (encoded[offset++]! + prediction) & 255;
		}
		for (let x = 0; x < stride; x += 4) {
			const alpha = row[x + 3]!;
			if (alpha === 0) transparent++;
			else {
				ink++;
				assert.equal(row[x], 0);
				assert.equal(row[x + 1], 0);
				assert.equal(row[x + 2], 0);
				if (alpha < 255) antialias++;
			}
		}
		previous = row;
	}
	assert.ok(transparent > (width * height) / 2);
	assert.ok(ink > 10000);
	assert.ok(antialias > 1000);
});

test("Today opts into branding; onboarding does not gain repeated logos", () => {
	const today = readFileSync(
		new URL("../../src/components/home/screen.tsx", import.meta.url),
		"utf8",
	);
	assert.match(today, /\bbrand\b/);
	for (const file of ["onboarding/index.tsx", "onboarding/page.tsx"])
		assert.doesNotMatch(
			readFileSync(
				new URL(`../../src/components/${file}`, import.meta.url),
				"utf8",
			),
			/BrandWordmark|wordmark-mask/,
		);
});
