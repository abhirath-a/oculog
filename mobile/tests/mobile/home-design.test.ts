import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	AddIntent,
	dateHeading,
	homeLayout,
} from "../../src/components/home/add-intent";
import {
	dailyAcknowledgement,
	eyeSummary,
} from "../../src/components/home/model";

test("home pairs eyes only when width and text scale allow; wide layouts gain columns", () => {
	assert.deepEqual(homeLayout(320, 1), { pairedEyes: false, columns: false });
	assert.deepEqual(homeLayout(390, 1), { pairedEyes: false, columns: false });
	assert.deepEqual(homeLayout(719, 1), { pairedEyes: false, columns: false });
	assert.deepEqual(homeLayout(720, 1), { pairedEyes: true, columns: false });
	assert.deepEqual(homeLayout(899, 1), { pairedEyes: true, columns: false });
	assert.deepEqual(homeLayout(900, 1), { pairedEyes: true, columns: true });
	assert.deepEqual(homeLayout(900, 1.25), { pairedEyes: true, columns: false });
	assert.deepEqual(homeLayout(900, 1.26), {
		pairedEyes: false,
		columns: false,
	});
	assert.deepEqual(homeLayout(1440, 1.5), {
		pairedEyes: false,
		columns: false,
	});
	assert.deepEqual(homeLayout(960, 1), { pairedEyes: true, columns: true });
	assert.deepEqual(homeLayout(960, 1.5), { pairedEyes: false, columns: false });
});

test("lens copy preserves every server interval and date without wear-based extensions", () => {
	for (let interval = 1; interval <= 365; interval++) {
		const eye = {
			id: null,
			eye: "left" as const,
			replacementDays: interval,
			openedOn: "2026-03-01",
			dueOn: "2026-04-01",
			daysRemaining: interval,
			spareCount: 3,
		};
		const original = JSON.stringify(eye);
		assert.equal(
			eyeSummary(eye).countdown,
			`Replace in ${interval} ${interval === 1 ? "day" : "days"}`,
		);
		assert.equal(eyeSummary(eye).due, "Replace on 2026-04-01");
		for (const worn of [null, false, true]) {
			assert.equal(typeof dailyAcknowledgement(worn), "string");
			assert.equal(eyeSummary(eye).due, "Replace on 2026-04-01");
		}
		assert.equal(JSON.stringify(eye), original);
	}
});

test("header formats the server calendar date without device timezone drift", () => {
	assert.equal(dateHeading(undefined), "Today");
	assert.match(dateHeading("2026-04-01"), /Apr.*1|1.*Apr/);
	assert.equal(dateHeading("invalid"), "invalid");
});

test("partial Add both throwing failure retries only the unfinished eye", async () => {
	const intent = new AddIntent();
	const writes: string[] = [];
	await assert.rejects(
		intent.save("owner", "both", 3, async (eye) => {
			writes.push(eye);
			if (eye === "right") throw new Error("offline");
			return true;
		}),
	);
	assert.deepEqual([...intent.completed], ["left"]);
	assert.equal(
		await intent.save("owner", "both", 3, async (eye, quantity) => {
			writes.push(eye);
			assert.equal(quantity, 3);
			return true;
		}),
		true,
	);
	assert.deepEqual(writes, ["left", "right", "right"]);
	assert.equal(intent.completed.size, 0);
});

test("false mutation results do not close or forget a partial addition", async () => {
	const intent = new AddIntent();
	assert.equal(
		await intent.save("owner", "both", 1, async (eye) => eye === "left"),
		false,
	);
	const retry: string[] = [];
	await intent.save("owner", "both", 1, async (eye) => {
		retry.push(eye);
		return true;
	});
	assert.deepEqual(retry, ["right"]);
});

test("new account and new completed intent cannot inherit successful-eye skips", async () => {
	const intent = new AddIntent();
	await intent.save("a", "both", 1, async (eye) => eye === "left");
	const writes: string[] = [];
	const write = async (eye: "left" | "right") => {
		writes.push(eye);
		return true;
	};
	await intent.save("b", "both", 1, write);
	await intent.save("b", "both", 1, write);
	assert.deepEqual(writes, ["left", "right", "left", "right"]);
});

test("Home routes setup to the focused lens editor and delegates sheet boundary to the adapter", () => {
	const source = readFileSync(
		new URL("../../src/components/home/screen.tsx", import.meta.url),
		"utf8",
	);
	assert.match(source, /router\.push\("\/lens-editor"\)/);
	assert.match(
		source,
		/<AddContactsSheet\s+presented=\{showAdd\}\s+busy=\{saving\}/,
	);
	assert.doesNotMatch(
		source,
		/<BottomSheet|<RNHostView|interactiveDismissDisabled/,
	);
	assert.match(source, /if \(!saving\) setShowAdd\(false\)/);
	assert.match(source, /localDate: state\.today/);
	assert.doesNotMatch(source, /ScheduleForm|<Modal|logout\(/);
});
