import assert from "node:assert/strict";
import { test } from "node:test";
import type { WearHistorySession } from "../../src/lib/wear-history/controller";
import {
	type HistoryDay,
	monthDates,
	type WearHistory,
} from "../../src/lib/wear-history/model";
import {
	loadWearReport,
	reportDayStatus,
	reportMonths,
	type WearReport,
	wearReportRange,
	wearTotals,
} from "../../src/lib/wear-history/report";
import { createWearReportController } from "../../src/lib/wear-history/report-controller";
import {
	createReportSharing,
	type ReportSharingIO,
} from "../../src/lib/wear-history/report-sharing";

const TODAY = "2025-01-15";
const OWNER = { owner: "synthetic-owner", token: "synthetic-token" };
const EMPTY = { report: null, loading: false, exporting: false, error: "" };

// Every DTO has the entire literal calendar month, including future unknown rows.
function history(month: string, today = TODAY): WearHistory {
	const states: Pick<HistoryDay, "source" | "worn">[] = [
		{ source: "manual", worn: true },
		{ source: "manual", worn: false },
		{ source: "assumed", worn: true },
		{ source: "unknown", worn: null },
	];
	return {
		version: 1,
		month,
		today,
		timeZone: "America/New_York",
		automation: {
			version: 1,
			enabled: true,
			weekdays: [0, 2, 4],
			startsOn: "2020-01-01",
		},
		days: monthDates(month).map((localDate, index) => ({
			localDate,
			...(localDate < today
				? states[index % 4]!
				: { source: "unknown" as const, worn: null }),
		})),
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
const monthsFor = (today = TODAY) => {
	const range = wearReportRange(today);
	return reportMonths(range.from, range.through);
};
const completeReport = () =>
	loadWearReport(
		async (month) => history(month),
		TODAY.slice(0, 7),
		() => true,
	);

for (const [today, from, count] of [
	["2024-02-29", "2023-03-01", 366],
	["2025-02-28", "2024-02-29", 366],
	["2025-03-01", "2024-03-02", 365],
	["2024-12-31", "2024-01-01", 366],
	["2025-12-31", "2025-01-01", 365],
	["2025-01-01", "2024-01-02", 366],
	[TODAY, "2024-01-16", 366],
] as const) {
	test(`rolling inclusive year ending ${today}: ${from}, ${count} days`, async () => {
		assert.deepEqual(wearReportRange(today), { from, through: today });
		const calls: string[] = [];
		const report = await loadWearReport(
			async (month) => {
				calls.push(month);
				return history(month, today);
			},
			today.slice(0, 7),
			() => true,
		);
		const expected = reportMonths(from, today)
			.flatMap(monthDates)
			.filter((date) => date >= from && date <= today);
		assert.equal(report.days.length, count);
		assert.deepEqual(
			report.days.map((day) => day.localDate),
			expected,
		);
		assert.equal(report.days[0]?.localDate, from);
		assert.equal(report.days.at(-1)?.localDate, today);
		assert.equal(new Set(calls).size, calls.length);
		assert.ok(calls.length <= 13);
		assert.deepEqual([...calls].sort(), reportMonths(from, today));
		assert.ok(report.days.every((day) => day.localDate <= today));
		assert.equal(
			Object.values(report.totals).reduce((sum, value) => sum + value, 0),
			count,
		);
		assert.equal(report.timeZone, "America/New_York");
	});
}

test("range validation and thirteen calendar-month ceiling", () => {
	for (const today of [
		"2023-02-29",
		"2024-02-30",
		"2024-1-01",
		"0001-12-31",
		"2024-01-01T00:00:00Z",
	])
		assert.throws(() => wearReportRange(today));
	assert.equal(reportMonths("2024-01-16", "2025-01-15").length, 13);
	assert.throws(
		() => reportMonths("2024-01-01", "2025-02-01"),
		/at most twelve months/,
	);
	for (const [from, through] of [
		["2025-01-02", "2025-01-01"],
		["2024-02-30", TODAY],
		["2024-01-01", "bad"],
	])
		assert.throws(() => reportMonths(from!, through!));
});

test("four statuses stay separate: unknown is never confirmed no-wear", () => {
	const days: HistoryDay[] = [
		{ localDate: "2024-01-01", source: "manual", worn: true },
		{ localDate: "2024-01-02", source: "manual", worn: false },
		{ localDate: "2024-01-03", source: "assumed", worn: true },
		{ localDate: "2024-01-04", source: "unknown", worn: null },
		{ localDate: "2024-01-05", source: "unknown", worn: null },
	];
	assert.deepEqual(wearTotals(days), {
		confirmedWear: 1,
		confirmedNoWear: 1,
		assumedWear: 1,
		unknown: 2,
	});
	assert.deepEqual(days.map(reportDayStatus), [
		"Confirmed worn",
		"Confirmed not worn",
		"Assumed worn - not confirmed",
		"Unknown - not logged",
		"Unknown - not logged",
	]);
	assert.deepEqual(wearTotals([]), {
		confirmedWear: 0,
		confirmedNoWear: 0,
		assumedWear: 0,
		unknown: 0,
	});
});

const corruptions: [string, (dto: WearHistory) => unknown][] = [
	["malformed DTO", () => ({ version: 1 })],
	["missing day", (dto) => ({ ...dto, days: dto.days.slice(1) })],
	[
		"duplicate date",
		(dto) => ({
			...dto,
			days: dto.days.map((day, i) => (i === 1 ? dto.days[0] : day)),
		}),
	],
	[
		"invalid calendar date",
		(dto) => ({
			...dto,
			days: dto.days.map((day, i) =>
				i === 0 ? { ...day, localDate: "2024-02-30" } : day,
			),
		}),
	],
	[
		"timestamp instead of calendar date",
		(dto) => ({ ...dto, today: `${dto.today}T00:00:00Z` }),
	],
	["wrong month", () => history("2024-03")],
	["calendar today changed", (dto) => ({ ...dto, today: "2025-01-16" })],
	["timezone changed", (dto) => ({ ...dto, timeZone: "UTC" })],
	["invalid timezone", (dto) => ({ ...dto, timeZone: "Not/A_Zone" })],
	[
		"automation changed",
		(dto) => ({ ...dto, automation: { ...dto.automation, weekdays: [1] } }),
	],
	[
		"automation effective date changed",
		(dto) => ({
			...dto,
			automation: { ...dto.automation, startsOn: "2021-01-01" },
		}),
	],
	[
		"unknown marked false",
		(dto) => ({
			...dto,
			days: dto.days.map((day, i) =>
				i === 0 ? { ...day, source: "unknown", worn: false } : day,
			),
		}),
	],
];
for (const [name, corrupt] of corruptions) {
	test(`${name} aborts the whole report, without continuing or fabricating unknown days`, async () => {
		const calls: string[] = [];
		await assert.rejects(
			loadWearReport(
				async (month) => {
					calls.push(month);
					return (
						month === "2024-02" ? corrupt(history(month)) : history(month)
					) as WearHistory;
				},
				"2025-01",
				() => true,
			),
		);
		assert.deepEqual(calls, ["2025-01", "2024-01", "2024-02"]);
	});
}

test("failed month rejects instead of returning an unknown fallback or retrying", async () => {
	const calls: string[] = [];
	const failure = new Error("synthetic month unavailable");
	await assert.rejects(
		loadWearReport(
			async (month) => {
				calls.push(month);
				if (month === "2024-06") throw failure;
				return history(month);
			},
			"2025-01",
			() => true,
		),
		(error) => error === failure,
	);
	assert.deepEqual(calls, ["2025-01", ...monthsFor().slice(0, 6)]);
});

test("invalid initial month and invalid session never call the reader", async () => {
	let reads = 0;
	const read = async (month: string) => {
		reads++;
		return history(month);
	};
	await assert.rejects(
		loadWearReport(read, "2025-13", () => true),
		/valid account calendar month/,
	);
	await assert.rejects(
		loadWearReport(read, "2025-01", () => false),
		/session changed/,
	);
	assert.equal(reads, 0);
});

test("controller mount/dispose/remount supports Strict Mode and never publishes stale reads", async () => {
	const old = deferred<WearHistory>();
	let calls = 0;
	let notifications = 0;
	const controller = createWearReportController(
		async (month) => (++calls === 1 ? old.promise : history(month)),
		() => OWNER,
		async () => {},
	);
	const unsubscribe = controller.subscribe(() => {
		notifications++;
	});
	assert.equal(await controller.load("2025-01"), false);
	controller.mount();
	const stale = controller.load("2025-01");
	assert.equal(controller.getState().loading, true);
	controller.dispose();
	assert.deepEqual(controller.getState(), EMPTY);
	assert.equal(await controller.load("2025-01"), false);
	controller.mount();
	assert.equal(await controller.load("2025-01"), true);
	const fresh = controller.getState().report;
	const before = notifications;
	old.resolve(history("2025-01"));
	assert.equal(await stale, false);
	assert.equal(controller.getState().report, fresh);
	assert.equal(notifications, before);
	unsubscribe();
	controller.dispose();
	assert.equal(notifications, before);
	assert.deepEqual(controller.getState(), EMPTY);
});

test("a throwing observer cannot break a report read or leave its lock held", async () => {
	const controller = createWearReportController(
		async (month) => history(month),
		() => OWNER,
		async () => {},
	);
	controller.subscribe(() => {
		throw new Error("synthetic observer failure");
	});
	controller.mount();
	assert.equal(await controller.load("2025-01"), true);
	assert.equal(controller.getState().loading, false);
	assert.equal(await controller.exportPdf(), true);
	assert.equal(controller.getState().exporting, false);
});

test("read lock is synchronous: double-click load and cross-operation export cannot start work", async () => {
	const gate = deferred<WearHistory>();
	let reads = 0;
	let shares = 0;
	const controller = createWearReportController(
		async (month) => (++reads === 1 ? gate.promise : history(month)),
		() => OWNER,
		async () => {
			shares++;
		},
	);
	controller.mount();
	const first = controller.load("2025-01");
	assert.equal(await controller.load("2025-01"), false);
	assert.equal(await controller.exportPdf(), false);
	assert.equal(reads, 1);
	gate.resolve(history("2025-01"));
	assert.equal(await first, true);
	assert.equal(reads, 13);
	assert.equal(shares, 0);
});

for (const transition of [
	"token rotation",
	"owner change",
	"logout",
	"ABA",
] as const) {
	test(`session ${transition} synchronously clears report and invalidates old in-flight generation`, async () => {
		let session: WearHistorySession = { ...OWNER };
		const gate = deferred<WearHistory>();
		let block = false;
		let shares = 0;
		const controller = createWearReportController(
			async (month) => (block ? gate.promise : history(month)),
			() => session,
			async () => {
				shares++;
			},
		);
		controller.mount();
		assert.equal(await controller.load("2025-01"), true);
		block = true;
		const pending = controller.exportPdf();
		assert.equal(controller.getState().exporting, true);
		session =
			transition === "logout"
				? null
				: transition === "token rotation"
					? { ...OWNER, token: "rotated-token" }
					: { owner: "other-owner", token: "other-token" };
		controller.syncSession();
		assert.deepEqual(controller.getState(), EMPTY);
		if (transition === "ABA") {
			session = { ...OWNER };
			controller.syncSession();
		}
		// A new generation must not inherit the old generation's lock.
		if (session) {
			block = false;
			assert.equal(await controller.load("2025-01"), true);
		}
		const before = controller.getState();
		gate.resolve(history("2025-01"));
		assert.equal(await pending, false);
		assert.deepEqual(controller.getState(), before);
		assert.equal(shares, 0);
	});
}

test("getState detects same-owner token rotation without a pending promise settling", async () => {
	let session: WearHistorySession = { ...OWNER };
	const controller = createWearReportController(
		async (month) => history(month),
		() => session,
		async () => {},
	);
	controller.mount();
	assert.equal(await controller.load("2025-01"), true);
	session = { ...OWNER, token: "rotated" };
	assert.deepEqual(controller.getState(), EMPTY);
	session = null;
	assert.equal(await controller.load("2025-01"), false);
});

test("stale reader rejection after owner change does not leak an error into the new session", async () => {
	let session = { ...OWNER };
	const gate = deferred<WearHistory>();
	let reads = 0;
	const controller = createWearReportController(
		async (month) => (++reads === 1 ? gate.promise : history(month)),
		() => session,
		async () => {},
	);
	controller.mount();
	const pending = controller.load("2025-01");
	session = { owner: "new-owner", token: "new-token" };
	controller.syncSession();
	assert.equal(await controller.load("2025-01"), true);
	const fresh = controller.getState();
	gate.reject(new Error("private old-owner failure"));
	assert.equal(await pending, false);
	assert.deepEqual(controller.getState(), fresh);
});

test("export refreshes every month, exports fresh data, and synchronously locks read/export through sharing", async () => {
	const calls: string[] = [];
	const sharing = deferred<void>();
	const shareStarted = deferred<void>();
	let fresh = false;
	let shares = 0;
	let exported: WearReport | undefined;
	const controller = createWearReportController(
		async (month) => {
			calls.push(month);
			const dto = history(month);
			if (fresh)
				dto.days = dto.days.map((day) => ({
					...day,
					source: "manual",
					worn: false,
				}));
			return dto;
		},
		() => OWNER,
		async (report, current) => {
			shares++;
			exported = report;
			assert.equal(current(), true);
			shareStarted.resolve();
			await sharing.promise;
		},
	);
	controller.mount();
	assert.equal(await controller.load("2025-01"), true);
	const previous = controller.getState().report;
	calls.length = 0;
	fresh = true;
	const pending = controller.exportPdf();
	assert.equal(await controller.exportPdf(), false);
	assert.equal(await controller.load("2025-01"), false);
	await shareStarted.promise;
	assert.deepEqual(calls, [
		"2025-01",
		...monthsFor().filter((month) => month !== "2025-01"),
	]);
	assert.notEqual(exported, previous);
	assert.equal(exported?.totals.confirmedNoWear, 366);
	assert.equal(exported?.totals.unknown, 0);
	assert.equal(controller.getState().exporting, true);
	assert.equal(await controller.exportPdf(), false);
	assert.equal(await controller.load("2025-01"), false);
	assert.equal(shares, 1);
	sharing.resolve();
	assert.equal(await pending, true);
	assert.equal(controller.getState().exporting, false);
	assert.equal(await controller.load("2025-01"), true);
});

test("partial export refresh failure NEVER shares the cached or incomplete report; retry reloads the whole year", async () => {
	const calls: string[] = [];
	let fail = false;
	let shares = 0;
	const controller = createWearReportController(
		async (month) => {
			calls.push(month);
			if (fail && month === "2024-06") throw new Error("refresh failed");
			return history(month);
		},
		() => OWNER,
		async () => {
			shares++;
		},
	);
	controller.mount();
	assert.equal(await controller.load("2025-01"), true);
	const previous = controller.getState().report;
	fail = true;
	calls.length = 0;
	assert.equal(await controller.exportPdf(), false);
	assert.equal(shares, 0);
	assert.equal(controller.getState().report, previous);
	assert.equal(controller.getState().exporting, false);
	assert.match(controller.getState().error, /refresh failed/);
	assert.deepEqual(calls, ["2025-01", ...monthsFor().slice(0, 6)]);
	fail = false;
	calls.length = 0;
	assert.equal(await controller.exportPdf(), true);
	assert.equal(calls.length, 13);
	assert.equal(shares, 1);
	assert.equal(controller.getState().error, "");
});

function sharingHarness() {
	const events: string[] = [];
	const bytes = new Uint8Array([1, 2, 3]);
	const file = {
		uri: "synthetic-cache://report.pdf",
		async write(value: Uint8Array) {
			assert.equal(value, bytes);
			events.push("write");
		},
		remove() {
			events.push("remove");
		},
	};
	const io: ReportSharingIO = {
		async available() {
			events.push("available");
			return true;
		},
		pdf() {
			events.push("pdf");
			return bytes;
		},
		create() {
			events.push("create");
			return file;
		},
		async share(uri) {
			assert.equal(uri, file.uri);
			events.push("share");
		},
	};
	return { events, file, io };
}

test("sharing unavailable: no PDF, file, write, share or cleanup; lock is released", async () => {
	const report = await completeReport();
	const { io, events } = sharingHarness();
	io.available = async () => {
		events.push("unavailable");
		return false;
	};
	const share = createReportSharing(io);
	await assert.rejects(
		share(report, () => true),
		/not available/,
	);
	assert.deepEqual(events, ["unavailable"]);
	io.available = async () => true;
	await share(report, () => true);
	assert.deepEqual(events.slice(1), [
		"pdf",
		"create",
		"write",
		"share",
		"remove",
	]);
});

for (const outcome of ["success", "cancellation", "failure"] as const) {
	test(`sharing ${outcome} always removes its temporary file after the share settles`, async () => {
		const report = await completeReport();
		const { io, events } = sharingHarness();
		const gate = deferred<void>();
		const started = deferred<void>();
		const failure = new Error(
			outcome === "cancellation" ? "User cancelled sharing" : "share failed",
		);
		io.share = async () => {
			events.push("share");
			started.resolve();
			await gate.promise;
		};
		const share = createReportSharing(io);
		const pending = share(report, () => true);
		const checked =
			outcome === "success"
				? pending
				: assert.rejects(pending, (error) => error === failure);
		await started.promise;
		assert.deepEqual(events, ["available", "pdf", "create", "write", "share"]);
		if (outcome === "success") gate.resolve();
		else gate.reject(failure);
		await checked;
		assert.deepEqual(events, [
			"available",
			"pdf",
			"create",
			"write",
			"share",
			"remove",
		]);
		io.share = async () => {
			events.push("share-again");
		};
		await share(report, () => true);
		assert.deepEqual(events.slice(-2), ["share-again", "remove"]);
	});
}

test("partial file write failure cleans up and never opens sharing", async () => {
	const report = await completeReport();
	const { io, events, file } = sharingHarness();
	const failure = new Error("partial write failed");
	file.write = async () => {
		events.push("partial-write");
		throw failure;
	};
	const share = createReportSharing(io);
	await assert.rejects(
		share(report, () => true),
		(error) => error === failure,
	);
	assert.deepEqual(events, [
		"available",
		"pdf",
		"create",
		"partial-write",
		"remove",
	]);
});

test("session rotation during write stops sharing and deletes the file", async () => {
	const report = await completeReport();
	const { io, events, file } = sharingHarness();
	const gate = deferred<void>();
	const started = deferred<void>();
	let current = true;
	file.write = async () => {
		events.push("write");
		started.resolve();
		await gate.promise;
	};
	const share = createReportSharing(io);
	const pending = share(report, () => current);
	await started.promise;
	current = false;
	gate.resolve();
	await assert.rejects(pending, /session changed/);
	assert.deepEqual(events, ["available", "pdf", "create", "write", "remove"]);
});

test("sharing checks session before IO and after availability and PDF generation", async () => {
	const report = await completeReport();
	for (const stage of ["before", "available", "pdf"]) {
		const { io, events } = sharingHarness();
		let current = stage !== "before";
		if (stage === "available")
			io.available = async () => {
				events.push("available");
				current = false;
				return true;
			};
		if (stage === "pdf")
			io.pdf = () => {
				events.push("pdf");
				current = false;
				return new Uint8Array();
			};
		await assert.rejects(
			createReportSharing(io)(report, () => current),
			/session changed/,
		);
		assert.deepEqual(
			events,
			stage === "before"
				? []
				: stage === "available"
					? ["available"]
					: ["available", "pdf"],
		);
	}
});

test("one sharing service has a global synchronous lock across reports and owners, including availability", async () => {
	const report = await completeReport();
	const { io, events } = sharingHarness();
	const gate = deferred<boolean>();
	io.available = async () => {
		events.push("available");
		return gate.promise;
	};
	const share = createReportSharing(io);
	const pending = share(report, () => true);
	await assert.rejects(
		share({ ...report, timeZone: "UTC" }, () => true),
		/Finish sharing/,
	);
	assert.deepEqual(events, ["available"]);
	gate.resolve(true);
	await pending;
	await share(report, () => true);
	assert.equal(events.filter((event) => event === "share").length, 2);
	assert.equal(events.filter((event) => event === "remove").length, 2);
});

test("cleanup throwing still unlocks sharing for the next attempt", async () => {
	const report = await completeReport();
	const { io, events, file } = sharingHarness();
	const failure = new Error("cleanup failed");
	file.remove = () => {
		events.push("remove-throws");
		throw failure;
	};
	const share = createReportSharing(io);
	await assert.rejects(
		share(report, () => true),
		(error) => error === failure,
	);
	file.remove = () => {
		events.push("remove");
	};
	await share(report, () => true);
	assert.deepEqual(events, [
		"available",
		"pdf",
		"create",
		"write",
		"share",
		"remove-throws",
		"available",
		"pdf",
		"create",
		"write",
		"share",
		"remove",
	]);
});
