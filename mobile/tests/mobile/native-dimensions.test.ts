import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const dimensions = new Set([
	"width",
	"height",
	"minWidth",
	"maxWidth",
	"minHeight",
	"maxHeight",
	"padding",
	"paddingHorizontal",
	"paddingVertical",
	"paddingTop",
	"paddingBottom",
	"paddingLeft",
	"paddingRight",
	"borderRadius",
	"borderWidth",
]);

// Inspect the actual source boundary, not a mocked native component that accepts
// strings. Expo's universal native mapper casts dimensions; it does not resolve %.
function invalidDimensions(source: string): string[] {
	const file = ts.createSourceFile(
		"component.tsx",
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const nativeNames = new Set<string>();
	for (const statement of file.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			!ts.isStringLiteral(statement.moduleSpecifier)
		)
			continue;
		if (statement.moduleSpecifier.text !== "@expo/ui") continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const binding of bindings.elements) {
			const imported = (binding.propertyName ?? binding.name).text;
			// These bridge views use RN/Yoga styles, where percentages are valid.
			if (imported !== "Host" && imported !== "RNHostView")
				nativeNames.add(binding.name.text);
		}
	}
	const failures: string[] = [];
	function inspectStyle(node: ts.Node) {
		if (
			ts.isPropertyAssignment(node) &&
			dimensions.has(node.name.getText(file).replace(/["']/g, ""))
		) {
			const strings: string[] = [];
			function inspectValue(value: ts.Node) {
				if (
					ts.isStringLiteral(value) ||
					ts.isNoSubstitutionTemplateLiteral(value) ||
					ts.isTemplateExpression(value)
				)
					strings.push(value.getText(file));
				ts.forEachChild(value, inspectValue);
			}
			inspectValue(node.initializer);
			if (strings.length)
				failures.push(`${node.name.getText(file)}: ${strings.join(", ")}`);
		}
		ts.forEachChild(node, inspectStyle);
	}
	function visit(node: ts.Node) {
		if (
			(ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
			nativeNames.has(node.tagName.getText(file))
		) {
			for (const attribute of node.attributes.properties) {
				if (
					ts.isJsxAttribute(attribute) &&
					attribute.name.getText(file) === "style" &&
					attribute.initializer
				)
					inspectStyle(attribute.initializer);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return failures;
}

test("dimension guard rejects native percentage styles but preserves RN bridge percentages", () => {
	assert.deepEqual(
		invalidDimensions(
			'import { Button as NativeButton, Host } from "@expo/ui"; const x = <Host style={{width: "100%"}}><NativeButton style={fullWidth ? {width: "100%"} : {}} /></Host>;',
		),
		['width: "100%"'],
	);
	assert.deepEqual(
		invalidDimensions(
			'import { Column, RNHostView } from "@expo/ui"; const x = <RNHostView style={{width: "100%"}}><Column style={{paddingVertical: 6}} /></RNHostView>;',
		),
		[],
	);
});

test("native universal components never pass string dimensions to Compose/SwiftUI", () => {
	const root = new URL("../../src/", import.meta.url);
	const failures: string[] = [];
	for (const path of readdirSync(root, { recursive: true })) {
		if (
			typeof path !== "string" ||
			!path.endsWith(".tsx") ||
			path.endsWith(".web.tsx")
		)
			continue;
		for (const failure of invalidDimensions(
			readFileSync(new URL(path, root), "utf8"),
		))
			failures.push(`${path}: ${failure}`);
	}
	assert.deepEqual(failures, []);
});
