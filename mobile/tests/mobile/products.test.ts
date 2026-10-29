import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isSafeAdviceURL } from "../../src/lib/advice-api";
import {
	mockProducts,
	productConsultationNotice,
} from "../../src/lib/product-mocks";

const source = (path: string) =>
	readFileSync(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("mock catalogue includes product types, balanced limitations and doctor-first notice", () => {
	assert.match(productConsultationNotice, /Consult an eye doctor before/);
	assert.match(
		productConsultationNotice,
		/not recommendations or endorsements/,
	);
	assert.ok(mockProducts.length >= 4);
	assert.equal(
		new Set(mockProducts.map((product) => product.id)).size,
		mockProducts.length,
	);
	for (const product of mockProducts) {
		assert.match(product.id, /^mock-/);
		for (const value of [product.name, product.category, product.description])
			assert.ok(value.trim());
		assert.ok(product.pros.length > 0);
		assert.ok(product.cons.length > 0);
		assert.equal(product.retailers.length, 2);
		for (const retailer of product.retailers) {
			assert.equal(isSafeAdviceURL(retailer.url), true);
			const url = new URL(retailer.url);
			assert.ok(["www.amazon.com", "www.target.com"].includes(url.hostname));
			assert.match(retailer.name, /\(US\)/);
			assert.equal(
				url.hostname === "www.amazon.com"
					? url.searchParams.get("k")
					: url.searchParams.get("searchTerm"),
				product.name,
			);
			assert.equal(url.searchParams.has("tag"), false);
		}
	}
});

test("Products remains account-keyed with one native page and honest catalogue/retailer labels", () => {
	const route = source("app/products.tsx");
	assert.match(route, /useStore/);
	assert.match(route, /key=\{store.account.id\}/);
	const screen = source("components/products/products-screen.tsx").replace(
		/\s+/g,
		" ",
	);
	assert.match(screen, /<NativePage title="Products"/);
	assert.doesNotMatch(
		screen,
		/<ScrollView|ModalSheet|ToolbarView|fetch\(|<View|borderRadius/,
	);
	for (const phrase of [
		"Example catalogue · not recommendations",
		"Consult an eye-care professional before choosing or using a product",
		"Suitability depends on your eyes, lenses and care plan",
		"Consult your eye doctor before using",
		"Potential benefits",
		"Things to check",
		"does not use your location",
		"not endorsements or verified listings, stock or prices",
		"Check the product label, seller, price and availability",
		"choose your store on the retailer website",
		"Search Amazon and Target in the US",
		"Review and sentiment scraping is not integrated",
	])
		assert.ok(screen.includes(phrase), phrase);
	assert.doesNotMatch(screen, /no affiliate|not affiliated/i);
});

test("collapsed native rows retain balanced comparison and essential peroxide/saline hazards before disclosure", () => {
	const screen = source("components/products/products-screen.tsx");
	const collapsed = screen.slice(0, screen.indexOf("<NativeDisclosure"));
	assert.match(collapsed, /\{product\.name\}/);
	assert.match(collapsed, /product\.category/);
	assert.match(collapsed, /\{product\.description\}/);
	assert.match(collapsed, /Potential benefit: \$\{product\.pros\[0\]\}/);
	assert.match(collapsed, /Check: \$\{product\.cons\[0\]\}/);
	assert.match(
		mockProducts.find((product) => product.id === "mock-peroxide-system")
			?.cons[0] ?? "",
		/serious eye injury; it must never go directly into the eye/,
	);
	assert.match(
		mockProducts.find((product) => product.id === "mock-sterile-saline")
			?.cons[0] ?? "",
		/does not disinfect contact lenses and does not replace disinfecting solution/,
	);
	assert.match(screen, /product\.pros\.slice\(1\)/);
	assert.match(screen, /product\.cons\.slice\(1\)/);
	assert.match(screen, /expanded=\{retailersExpanded\}/);
	assert.match(screen, /product\.retailers\.map/);
	assert.match(screen, /\{productConsultationNotice\}/);
	assert.match(screen, /Mock examples only/);
});
