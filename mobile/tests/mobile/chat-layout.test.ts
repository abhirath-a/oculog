import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	composerBounds,
	createChatScrollPolicy,
	measuredComposerHeight,
} from "../../src/components/advice/chat-layout";

test("composer starts at one comfortable line, grows, caps and handles invalid native measurements", () => {
	const b = composerBounds(1);
	assert.equal(b.min, 44);
	assert.equal(b.max, 130);
	assert.equal(measuredComposerHeight(22, b), 44);
	assert.equal(measuredComposerHeight(81.4, b), 82);
	assert.equal(measuredComposerHeight(600, b), 130);
	for (const value of [0, -20, NaN, Infinity])
		assert.equal(measuredComposerHeight(value, b), 44);
});
test("large text keeps a readable minimum while bounding the multiline composer", () => {
	for (const scale of [1, 1.5, 2, 3]) {
		const b = composerBounds(scale);
		assert.ok(b.min >= 44);
		assert.ok(b.max >= b.min);
		assert.ok(b.max <= 160);
	}
	assert.equal(composerBounds(NaN).min, 44);
});
test("reading older messages survives content growth; an explicit new question restores following", () => {
	const p = createChatScrollPolicy();
	assert.equal(p.shouldFollow(), true);
	p.onScroll(100, 500, 1800);
	assert.equal(p.shouldFollow(), false);
	assert.equal(
		p.shouldFollow(),
		false,
		"A content resize alone must not reset reading position",
	);
	p.requestFollow();
	assert.equal(p.shouldFollow(), true);
	p.onScroll(1260, 500, 1800);
	assert.equal(p.shouldFollow(), true);
	p.onScroll(20, 500, 1800);
	p.onScroll(NaN, 500, 1800);
	assert.equal(p.shouldFollow(), false);
});
test("chat gives the transcript native drag ownership and measures only its local input", () => {
	const source = readFileSync(
		new URL("../../src/components/advice/advice-screen.tsx", import.meta.url),
		"utf8",
	);
	assert.doesNotMatch(
		source,
		/TouchableWithoutFeedback|onPress=\{Keyboard.dismiss\}/,
	);
	assert.match(source, /keyboardDismissMode="interactive"/);
	assert.match(
		source,
		/if \(follow.current.shouldFollow\(\)\)\s+scrollRef.current\?\.scrollToEnd/,
	);
	assert.match(
		source,
		/inputMeasurement.current = nativeEvent.contentSize.height/,
	);
	assert.match(source, /scrollEnabled=\{inputHeight >= bounds.max\}/);
	assert.match(source, /height: inputHeight/);
});
