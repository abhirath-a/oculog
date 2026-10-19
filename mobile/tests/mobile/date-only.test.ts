import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	createDateOnlySession,
	dateOnlyFromDate,
	dateOnlyToLocal,
	dateOnlyToUTC,
} from "../../src/components/presentation/date-only";

test("date-only bridges preserve days across timezones and DST boundaries", () => {
	const previous = process.env.TZ;
	try {
		for (const zone of [
			"UTC",
			"America/Los_Angeles",
			"America/New_York",
			"Europe/Berlin",
			"Asia/Kathmandu",
			"Pacific/Kiritimati",
		]) {
			process.env.TZ = zone;
			for (const value of [
				"2024-02-29",
				"2026-03-08",
				"2026-03-29",
				"2026-10-25",
				"2026-11-01",
				"2026-12-31",
			]) {
				assert.equal(dateOnlyFromDate(dateOnlyToLocal(value)), value, zone);
				assert.equal(dateOnlyToLocal(value).getHours(), 12);
				assert.equal(dateOnlyFromDate(dateOnlyToUTC(value), true), value, zone);
				assert.equal(
					dateOnlyToUTC(value).toISOString(),
					`${value}T00:00:00.000Z`,
				);
			}
		}
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
});

test("date transactions enforce explicit once-only commit, cancel and upper bound", () => {
	const session = createDateOnlySession("", "2026-03-08");
	assert.equal(session.draft, "2026-03-08");
	session.select("2026-03-09");
	assert.equal(session.draft, "2026-03-08");
	session.select("2026-03-01");
	assert.equal(session.commit(true), undefined);
	assert.equal(session.commit(false), "2026-03-01");
	assert.equal(session.commit(false), undefined);
	const reopened = createDateOnlySession("2026-03-01", "2026-03-08");
	reopened.select("2026-02-01");
	reopened.cancel();
	reopened.select("2026-01-01");
	assert.equal(reopened.commit(false), undefined);
	assert.equal(
		createDateOnlySession("2026-03-01", "2026-03-08").draft,
		"2026-03-01",
	);
});

test("native presentations are isolated and don't put a calendar in form layout", () => {
	const source = (file: string) =>
		readFileSync(
			new URL(`../../src/components/presentation/${file}`, import.meta.url),
			"utf8",
		);
	assert.match(
		source("date-field-picker.ios.tsx"),
		/datePickerStyle\("wheel"\)/,
	);
	assert.match(source("date-field-picker.ios.tsx"), /<BottomSheet/);
	assert.match(source("date-field-picker.android.tsx"), /<DatePickerDialog/);
	assert.doesNotMatch(
		source("date-field.tsx"),
		/DateTimePicker|display="inline"|settings\/calendar/,
	);
	assert.doesNotMatch(
		source("date-field.web.tsx"),
		/from "@expo\/ui|date-field-picker/,
	);
});
