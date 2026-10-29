import assert from "node:assert/strict";
import { test } from "node:test";
import type { SimpleEyeState, SimpleState } from "../../shared/simple-domain";
import {
	todayCalendarDate,
	todayLens,
	todayPresentation,
} from "../../src/components/home/today-model";

function eye(
	name: "left" | "right",
	overrides: Partial<SimpleEyeState> = {},
): SimpleEyeState {
	return {
		id: null,
		eye: name,
		replacementDays: 30,
		openedOn: "2026-10-12",
		dueOn: "2026-11-11",
		daysRemaining: 18,
		spareCount: 6,
		...overrides,
	};
}
function state(
	left: Partial<SimpleEyeState> = {},
	right: Partial<SimpleEyeState> = {},
): SimpleState {
	return {
		today: "2026-10-24",
		timeZone: "Pacific/Kiritimati",
		daily: { localDate: "2026-10-24", worn: null },
		eyes: [eye("right", right), eye("left", left)],
	};
}
const unconfigured = {
	replacementDays: null,
	openedOn: null,
	dueOn: null,
	daysRemaining: null,
};
const unopened = { openedOn: null, dueOn: null, daysRemaining: null };

test("Today status formats the literal server deadline in UTC, with no countdown inference", () => {
	const previous = process.env.TZ;
	try {
		for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
			process.env.TZ = zone;
			assert.equal(todayCalendarDate("2026-01-01"), "Jan 1, 2026");
			assert.equal(
				todayLens(eye("left", { daysRemaining: -2 })).status,
				"Replace Nov 11, 2026 · 2 days overdue",
			);
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
	assert.equal(todayCalendarDate("unavailable"), "unavailable");
	for (const [days, label] of [
		[0, "Due today"],
		[-1, "1 day overdue"],
		[1, "1 day remaining"],
		[18, "18 days remaining"],
	] as const) {
		assert.equal(
			todayLens(eye("left", { daysRemaining: days })).status,
			`Replace Nov 11, 2026 · ${label}`,
		);
	}
});

test("Today selector keeps Left then Right, truthful empty status and visible stock", () => {
	const source = state(unconfigured, unopened);
	const before = JSON.stringify(source);
	const result = todayPresentation(source);
	assert.deepEqual(
		result.eyes.map((item) => item.eye),
		["left", "right"],
	);
	assert.equal(todayLens(result.eyes[0]).status, "Not set up");
	assert.equal(todayLens(result.eyes[1]).status, "No lens open");
	assert.equal(todayLens(eye("left", { spareCount: 0 })).stock, "0 spares");
	assert.equal(todayLens(eye("right", { spareCount: 1 })).stock, "1 spare");
	assert.equal(JSON.stringify(source), before);
});

test("Today task priority covers setup, most overdue, stable ties, unopened and blocking stock", () => {
	const cases: [
		Partial<SimpleEyeState>,
		Partial<SimpleEyeState>,
		string | null,
	][] = [
		[unconfigured, unconfigured, "setup"],
		[unconfigured, {}, "setup"],
		[unconfigured, unopened, "setup"],
		[unconfigured, { ...unopened, spareCount: 0 }, "setup"],
		[unopened, unconfigured, "setup"],
		[{ ...unopened, spareCount: 0 }, unconfigured, "setup"],
		[unconfigured, { daysRemaining: 0 }, "right"],
		[unconfigured, { daysRemaining: 0, spareCount: 0 }, "add"],
		[unconfigured, { daysRemaining: -1 }, "right"],
		[unconfigured, { daysRemaining: -1, spareCount: 0 }, "add"],
		[{ daysRemaining: 0 }, {}, "left"],
		[{ daysRemaining: -1 }, { daysRemaining: -3 }, "right"],
		[{ daysRemaining: -3 }, { daysRemaining: -3 }, "left"],
		[unopened, unopened, "left"],
		[{ ...unopened, spareCount: 0 }, unopened, "add"],
		[unopened, { daysRemaining: -1 }, "right"],
		[unopened, { daysRemaining: 0 }, "right"],
		[{ daysRemaining: 0 }, unopened, "left"],
		[unopened, { daysRemaining: 0, spareCount: 0 }, "add"],
		[{}, {}, null],
	];
	for (const [left, right, expected] of cases)
		assert.equal(todayPresentation(state(left, right)).primary, expected);
});

test("wear does not change status, deadlines, stock or task priority; future lenses invent no task", () => {
	const source = state();
	const expected = JSON.stringify(todayPresentation(source));
	for (const worn of [null, true, false]) {
		source.daily.worn = worn;
		assert.equal(JSON.stringify(todayPresentation(source)), expected);
		assert.equal(todayPresentation(source).primary, null);
	}
	assert.equal(todayLens(eye("left", unopened)).action, "Open left lens");
	assert.equal(todayLens(eye("right")).action, "Replace right lens");
});
