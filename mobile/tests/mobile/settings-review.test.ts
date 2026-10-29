import assert from "node:assert/strict";
import { test } from "node:test";
import {
	dateOnlyFromDate,
	dateOnlyToLocal,
	createDateOnlySession,
} from "../../src/components/presentation/date-only";
import { scheduleCommands } from "../../src/components/settings/schedule";
import { calendarDate } from "../../src/lib/simple-controller";

test("iOS date-only bounds follow the account day across device timezone and DST differences", () => {
	const previous = process.env.TZ;
	const instant = new Date("2026-03-08T10:30:00Z");
	try {
		for (const [device, account] of [
			["America/Los_Angeles", "Pacific/Kiritimati"],
			["Pacific/Kiritimati", "America/Los_Angeles"],
		]) {
			process.env.TZ = device;
			const today = calendarDate(account, instant);
			assert.notEqual(dateOnlyFromDate(instant), today);
			assert.equal(dateOnlyFromDate(dateOnlyToLocal(today)), today);
			const picker = createDateOnlySession("", today);
			picker.select("2099-01-01");
			assert.equal(picker.commit(false), today);
			assert.equal(picker.commit(false), undefined);
			const draft = {
				leftDays: "14",
				rightDays: "30",
				leftOpened: today,
				rightOpened: "",
				differentIntervals: true,
				differentDates: true,
			};
			assert.equal(scheduleCommands(draft, account, today)[0].openedOn, today);
			assert.throws(() =>
				scheduleCommands({ ...draft, leftOpened: `${today}x` }, account, today),
			);
			assert.throws(() =>
				scheduleCommands(
					{ ...draft, leftOpened: "2099-01-01" },
					account,
					today,
				),
			);
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});
