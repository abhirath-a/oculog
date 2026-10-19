import assert from "node:assert/strict";
import { test } from "node:test";
import { PrivateArtifacts, verifySession } from "../../src/lib/safety";

test("expired foreground auth and 401/403 clear auth; connectivity errors do not", async () => {
	let cleared = 0,
		refreshes = 0;
	const clear = async () => {
		cleared++;
	};
	assert.equal(
		await verifySession(
			() => false,
			async () => {
				refreshes++;
			},
			clear,
		),
		false,
	);
	assert.equal(refreshes, 0);
	for (const status of [401, 403])
		assert.equal(
			await verifySession(
				() => true,
				async () => {
					throw { status };
				},
				clear,
			),
			false,
		);
	assert.equal(cleared, 3);
	await assert.rejects(
		verifySession(
			() => true,
			async () => {
				throw new Error("offline");
			},
			clear,
		),
	);
	assert.equal(cleared, 3);
	assert.equal(
		await verifySession(
			() => true,
			async () => false,
			clear,
		),
		false,
	);
	assert.equal(cleared, 3);
});
test("private sharing finally cleanup and logout invalidate in-flight documents", async () => {
	const files = new PrivateArtifacts();
	let deleted = 0;
	const epoch = files.epoch();
	files.track("export", () => {
		deleted++;
	});
	try {
		throw new Error("share cancelled");
	} catch {
	} finally {
		await files.remove("export");
	}
	assert.equal(deleted, 1);
	files.track("document", () => {
		deleted++;
	});
	await files.cleanup();
	assert.equal(deleted, 2);
	assert.equal(files.current(epoch), false);
	await files.cleanup();
	assert.equal(deleted, 2);
});
test("failed private file cleanup remains tracked for a retry", async () => {
	const files = new PrivateArtifacts();
	let fail = true;
	files.track("private", () => {
		if (fail) throw new Error("busy");
	});
	await assert.rejects(files.cleanup());
	fail = false;
	await files.cleanup();
});
