import {
	MAX_RECORD_BYTES,
	type Prescription,
	utf8Bytes,
	validatePrescription,
} from "./model";
export type PrescriptionRepository = {
	load(owner: string): Promise<Prescription | null>;
	save(owner: string, record: Prescription): Promise<void>;
	remove(owner: string): Promise<void>;
	subscribe(listener: () => void): () => void;
};
export type PrescriptionStorage = {
	keyForOwner(owner: string): Promise<string>;
	getItem(key: string): Promise<string | null>;
	setItem(key: string, value: string): Promise<void>;
	removeItem(key: string): Promise<void>;
};
export function createPrescriptionRepository(
	storage: PrescriptionStorage,
): PrescriptionRepository {
	let queue: Promise<unknown> = Promise.resolve();
	const listeners = new Set<() => void>();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const task = queue.then(work);
		queue = task.catch(() => {});
		return task;
	};
	const ownerKey = (owner: string) => {
		if (typeof owner !== "string" || !owner.trim() || owner.length > 1024)
			throw new Error("A signed-in account is required.");
		return storage.keyForOwner(owner);
	};
	const notify = () => {
		for (const listener of listeners) {
			try {
				listener();
			} catch {
				/* A subscriber cannot turn a committed write into a failure. */
			}
		}
	};
	return {
		load(owner) {
			return serial(async () => {
				const key = await ownerKey(owner);
				const raw = await storage.getItem(key);
				if (raw === null) return null;
				if (utf8Bytes(raw) >= MAX_RECORD_BYTES)
					throw new Error(
						"Stored prescription exceeds limits; it has not been deleted.",
					);
				try {
					return validatePrescription(JSON.parse(raw));
				} catch {
					throw new Error(
						"Stored prescription cannot be read. Retry or explicitly replace/delete it; it has not been deleted.",
					);
				}
			});
		},
		save(owner, record) {
			let raw: string;
			try {
				raw = JSON.stringify(validatePrescription(record));
			} catch (error) {
				return Promise.reject(error);
			}
			return serial(async () => {
				const key = await ownerKey(owner);
				await storage.setItem(key, raw);
				notify();
			});
		},
		remove(owner) {
			return serial(async () => {
				const key = await ownerKey(owner);
				await storage.removeItem(key);
				notify();
			});
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
