export async function verifySession(
	valid: () => boolean,
	refresh: () => Promise<void | boolean>,
	clear: () => Promise<void>,
) {
	if (!valid()) {
		await clear();
		return false;
	}
	try {
		const refreshed = await refresh();
		if (refreshed === false) return false;
		if (!valid()) {
			await clear();
			return false;
		}
		return true;
	} catch (error) {
		const status = (error as { status?: number }).status;
		if (status === 401 || status === 403) {
			await clear();
			return false;
		}
		throw error;
	}
}
/** Cleanup is idempotent; files created by in-flight deliveries are also invalidated. */
export class PrivateArtifacts {
	private generation = 0;
	private entries = new Map<string, () => void | Promise<void>>();
	epoch() {
		return this.generation;
	}
	current(epoch: number) {
		return epoch === this.generation;
	}
	track(key: string, remove: () => void | Promise<void>) {
		this.entries.set(key, remove);
	}
	async remove(key: string) {
		const remove = this.entries.get(key);
		if (!remove) return;
		await remove();
		this.entries.delete(key);
	}
	async cleanup() {
		this.generation++;
		const failures: unknown[] = [];
		await Promise.all(
			[...this.entries.keys()].map(async (key) => {
				try {
					await this.remove(key);
				} catch (error) {
					failures.push(error);
				}
			}),
		);
		if (failures.length)
			throw new Error(
				"Could not remove a private temporary file. Retry signing out to clean app-owned copies.",
			);
	}
}
