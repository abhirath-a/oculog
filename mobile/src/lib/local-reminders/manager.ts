import {
	buildReminderPlans,
	DAILY_NOTICE,
	defaultPreferences,
	FEATURE,
	KINDS,
	type ReminderManager,
	type ReminderPermission,
	type ReminderPlan,
	type ReminderPreferences,
	type ReminderSnapshot,
	type ReminderState,
	validatePreferences,
} from "./model";

export type ReminderData = {
	feature: typeof FEATURE;
	ownerHash: string;
	kind: string;
	planId: string;
	receiptKeys?: string[];
};
export type ScheduledReminder = {
	identifier: string;
	data: Record<string, unknown>;
};
export type StoredReminders = {
	preferences: ReminderPreferences;
	receipts: string[];
};
export interface ReminderDependencies {
	hash(owner: string): Promise<string>;
	storage: {
		load(hash: string): Promise<StoredReminders | null>;
		save(hash: string, value: StoredReminders): Promise<void>;
	};
	permission(request: boolean): Promise<ReminderPermission>;
	scheduled(): Promise<ScheduledReminder[]>;
	schedule(plan: ReminderPlan, data: ReminderData): Promise<string>;
	cancel(identifier: string): Promise<void>;
	now(): Date;
}
const EMPTY: ReminderSnapshot = {
	owner: null,
	sessionKey: null,
	state: null,
	prescription: null,
};
class StaleOperation extends Error {}
class NotificationCapacityError extends Error {}
function immutableState(value: ReminderState): ReminderState {
	for (const kind of KINDS) Object.freeze(value.preferences[kind]);
	Object.freeze(value.preferences);
	return Object.freeze(value);
}
export function isFeatureNotification(data: unknown): data is ReminderData {
	if (!data || typeof data !== "object") return false;
	const d = data as ReminderData;
	return (
		d.feature === FEATURE &&
		typeof d.ownerHash === "string" &&
		/^[a-f0-9]{64}$/.test(d.ownerHash) &&
		KINDS.includes(d.kind as "daily") &&
		typeof d.planId === "string" &&
		/^[a-f0-9]{64}$/.test(d.planId) &&
		(d.receiptKeys === undefined ||
			(Array.isArray(d.receiptKeys) &&
				d.receiptKeys.length <= 16 &&
				d.receiptKeys.every(
					(key) =>
						typeof key === "string" &&
						/^(daily|replacement|prescription)\.[a-f0-9]{64}$/.test(key),
				)))
	);
}
export function createReminderManager(
	deps: ReminderDependencies,
): ReminderManager & {
	routeForNotification(
		data: unknown,
	): Promise<"/prescriptions" | "/(tabs)/home" | null>;
	shouldPresentNotification(data: unknown): boolean;
	notificationContextReady(): boolean;
} {
	let snapshot = EMPTY;
	// Session fences protect explicit user intent; data fences protect derived plans.
	let generation = 0;
	let revision = 0;
	let disposed = false;
	let ownerHash: string | null = null;
	let loadedOwner: string | null = null;
	let receipts = new Set<string>();
	let state: ReminderState = immutableState({
		preferences: defaultPreferences(),
		loading: false,
		busy: false,
		permission: "undetermined",
		scheduledCount: 0,
		error: null,
		notice: DAILY_NOTICE,
	});
	const listeners = new Set<() => void>();
	let queue: Promise<void> = Promise.resolve();
	const receiptRepairs = new Map<string, Set<string>>();
	const emit = (patch: Partial<ReminderState>) => {
		state = immutableState({ ...state, ...patch });
		for (const listener of listeners) listener();
	};
	const guard = (ticket: number) => {
		if (disposed || generation !== ticket) throw new StaleOperation();
	};
	const enqueue = (
		operation: (ticket: number) => Promise<void>,
		ticket = generation,
	): Promise<void> => {
		const run = queue.then(async () => {
			try {
				guard(ticket);
				emit({ busy: true, error: null });
				await operation(ticket);
				guard(ticket);
			} catch (error) {
				if (
					!(error instanceof StaleOperation) &&
					!disposed &&
					ticket === generation
				)
					emit({
						scheduledCount: 0,
						error:
							error instanceof NotificationCapacityError
								? "Device notification capacity reached. No new reminders were added. Free notification capacity and retry."
								: "Reminders could not be updated. Some earlier alerts may still arrive. Check permission and retry.",
					});
			} finally {
				if (!disposed && ticket === generation)
					emit({ busy: false, loading: false });
			}
		});
		queue = run.catch(() => {});
		return run;
	};
	const initialize = async (ticket: number) => {
		if (!snapshot.owner || !snapshot.sessionKey) return;
		if (loadedOwner === snapshot.owner && ownerHash) return;
		const owner = snapshot.owner;
		emit({ loading: true });
		const hash = await deps.hash(owner);
		guard(ticket);
		const stored = await deps.storage.load(hash);
		guard(ticket);
		const preferences = stored
			? validatePreferences(stored.preferences)
			: defaultPreferences();
		if (
			stored &&
			(!Array.isArray(stored.receipts) ||
				stored.receipts.length > 16 ||
				stored.receipts.some((id) => typeof id !== "string" || id.length > 500))
		)
			throw new Error("Invalid reminder receipts.");
		ownerHash = hash;
		loadedOwner = owner;
		receipts = new Set(stored?.receipts ?? []);
		emit({ preferences, loading: false });
	};
	const persist = async (
		ticket: number,
		preferences: ReminderPreferences,
		savedReceipts: Set<string>,
	) => {
		guard(ticket);
		const hash = ownerHash;
		if (!hash) throw new StaleOperation();
		await deps.storage.save(hash, {
			preferences,
			receipts: [...savedReceipts],
		});
		guard(ticket);
	};
	const repairReceipts = async (ticket: number) => {
		// Captured-account cleanup is serialized even if its originating session ended.
		for (const [hash, removed] of receiptRepairs) {
			const stored = await deps.storage.load(hash);
			if (stored) {
				const preferences = validatePreferences(stored.preferences);
				if (
					!Array.isArray(stored.receipts) ||
					stored.receipts.length > 16 ||
					stored.receipts.some(
						(key) => typeof key !== "string" || key.length > 500,
					)
				)
					throw new Error("Invalid reminder receipts.");
				const remaining = stored.receipts.filter((key) => !removed.has(key));
				await deps.storage.save(hash, { preferences, receipts: remaining });
				if (generation === ticket && ownerHash === hash)
					receipts = new Set(remaining);
			}
			receiptRepairs.delete(hash);
		}
	};
	const cancelOwned = async (request: ScheduledReminder, ticket: number) => {
		await deps.cancel(request.identifier);
		const data = request.data;
		if (isFeatureNotification(data)) {
			const removed = receiptRepairs.get(data.ownerHash) ?? new Set<string>();
			removed.add(`${data.kind}.${data.planId}`);
			for (const key of data.receiptKeys ?? []) {
				if (/^(daily|replacement|prescription)\.[a-f0-9]{64}$/.test(key))
					removed.add(key);
			}
			receiptRepairs.set(data.ownerHash, removed);
		}
		guard(ticket);
	};
	const sessionGuard = guard;
	const reconcileInternal = async (ticket: number) => {
		const dataRevision = revision;
		const guard = (currentTicket: number) => {
			sessionGuard(currentTicket);
			if (revision !== dataRevision) throw new StaleOperation();
		};
		// Enumerate even when signed out: reap this feature's orphan schedules only.
		const pending = await deps.scheduled();
		guard(ticket);
		if (!snapshot.owner || !snapshot.sessionKey) {
			let failed = false;
			for (const request of pending) {
				if (request.data.feature !== FEATURE) continue;
				try {
					await cancelOwned(request, ticket);
				} catch {
					guard(ticket);
					failed = true;
				}
				guard(ticket);
			}
			await repairReceipts(ticket);
			guard(ticket);
			if (failed)
				throw new Error("Feature reminders could not all be cancelled.");
			emit({
				permission: "undetermined",
				scheduledCount: 0,
				notice: DAILY_NOTICE,
			});
			return;
		}
		await repairReceipts(ticket);
		guard(ticket);
		try {
			await initialize(ticket);
		} catch (error) {
			guard(ticket);
			// Unreadable preferences cannot authorize any feature schedule.
			for (const request of pending) {
				if (request.data.feature !== FEATURE) continue;
				await cancelOwned(request, ticket);
				guard(ticket);
			}
			await repairReceipts(ticket);
			guard(ticket);
			throw error;
		}
		guard(ticket);
		// Reap foreign-owner feature requests even if the permission read later fails.
		for (const request of pending) {
			if (
				request.data.feature !== FEATURE ||
				request.data.ownerHash === ownerHash
			)
				continue;
			await cancelOwned(request, ticket);
			guard(ticket);
		}
		await repairReceipts(ticket);
		guard(ticket);
		const permission = await deps.permission(false);
		guard(ticket);
		emit({ permission, scheduledCount: 0 });
		guard(ticket);
		const plans =
			permission === "granted"
				? buildReminderPlans(snapshot, state.preferences, deps.now())
				: [];
		// Native data contains opaque identities, never calendar dates or private values.
		const hashKeys = async (kind: string, keys: string[]) => {
			const result: string[] = [];
			for (const key of keys) {
				const hashed = await deps.hash(`${FEATURE}:coverage:${kind}:${key}`);
				guard(ticket);
				result.push(`${kind}.${hashed}`);
			}
			return result;
		};
		for (const plan of plans) {
			plan.id = await deps.hash(`${FEATURE}:${plan.id}`);
			guard(ticket);
			plan.receiptKeys = await hashKeys(plan.kind, plan.receiptKeys ?? []);
			guard(ticket);
			plan.retainReceiptKeys = await hashKeys(
				plan.kind,
				plan.retainReceiptKeys ?? [],
			);
			guard(ticket);
			const groups: string[][] = [];
			for (const group of plan.skipIfCovered ?? []) {
				groups.push(await hashKeys(plan.kind, group));
				guard(ticket);
			}
			plan.skipIfCovered = groups;
		}
		const desired = new Map(plans.map((plan) => [plan.id, plan]));
		const retained = new Map<string, ScheduledReminder>();
		for (const request of pending) {
			if (
				request.data.feature !== FEATURE ||
				request.data.ownerHash !== ownerHash
			)
				continue;
			const data = request.data;
			const keep =
				isFeatureNotification(data) &&
				snapshot.owner &&
				snapshot.sessionKey &&
				ownerHash &&
				data.ownerHash === ownerHash &&
				typeof data.planId === "string" &&
				desired.get(data.planId)?.kind === data.kind &&
				!retained.has(data.planId);
			if (keep) retained.set(data.planId as string, request);
			else {
				await cancelOwned(request, ticket);
				guard(ticket);
			}
		}
		await repairReceipts(ticket);
		guard(ticket);
		const unrelated = pending.filter(
			(request) => request.data.feature !== FEATURE,
		).length;
		const needed = plans.filter(
			(plan) =>
				!retained.has(plan.id) &&
				(plan.trigger.type === "daily" ||
					(!receipts.has(`${plan.kind}.${plan.id}`) &&
						!(
							plan.skipIfCovered?.length &&
							plan.skipIfCovered.every((group) =>
								group.some((key) => receipts.has(key)),
							)
						))),
		);
		if (unrelated + retained.size + needed.length > 64)
			throw new NotificationCapacityError();
		const desiredReceipts = new Set(
			plans.flatMap((plan) => [
				`${plan.kind}.${plan.id}`,
				...(plan.receiptKeys ?? []),
				...(plan.retainReceiptKeys ?? []),
				...(plan.skipIfCovered ?? []).flat(),
			]),
		);
		const nextReceipts = new Set(
			[...receipts].filter(
				(id) =>
					desiredReceipts.has(id) ||
					(id.startsWith("prescription.") &&
						!snapshot.prescription &&
						state.preferences.prescription.enabled) ||
					(id.startsWith("replacement.") &&
						!snapshot.state &&
						state.preferences.replacement.enabled),
			),
		);
		// Pending retained plans remain covered after a sibling plan was cancelled.
		for (const request of retained.values()) {
			if (!isFeatureNotification(request.data)) continue;
			nextReceipts.add(`${request.data.kind}.${request.data.planId}`);
			for (const key of request.data.receiptKeys ?? []) nextReceipts.add(key);
		}
		const originalReceipts = new Set(receipts);
		const capturedHash = ownerHash;
		const capturedPreferences = state.preferences;
		const created: string[] = [];
		try {
			// Prune receipts before scheduling, so no unfenced write follows a new daily request.
			if (ownerHash && snapshot.owner && snapshot.sessionKey) {
				await persist(ticket, state.preferences, nextReceipts);
				guard(ticket);
			}
			for (const plan of needed) {
				if (!ownerHash) throw new StaleOperation();
				const id = await deps.schedule(plan, {
					feature: FEATURE,
					ownerHash,
					kind: plan.kind,
					planId: plan.id,
					receiptKeys: plan.receiptKeys,
				});
				created.push(id);
				guard(ticket);
				if (plan.trigger.type === "date") {
					const hash = ownerHash;
					const preferences = state.preferences;
					const before = new Set(nextReceipts);
					nextReceipts.add(`${plan.kind}.${plan.id}`);
					for (const key of plan.receiptKeys ?? []) nextReceipts.add(key);
					try {
						await persist(ticket, preferences, nextReceipts);
						guard(ticket);
						receipts = new Set(nextReceipts);
					} catch (error) {
						if (
							error instanceof StaleOperation ||
							generation !== ticket ||
							disposed
						)
							throw error;
						await deps.cancel(id);
						// Repair only this operation's captured account envelope before the next queued task.
						await deps.storage.save(hash, {
							preferences,
							receipts: [...before],
						});
						guard(ticket);
						throw error;
					}
				}
				retained.set(plan.id, {
					identifier: id,
					data: {
						feature: FEATURE,
						ownerHash,
						kind: plan.kind,
						planId: plan.id,
						receiptKeys: plan.receiptKeys,
					},
				});
			}
			receipts = nextReceipts;
			emit({
				scheduledCount: retained.size,
				notice:
					permission === "denied"
						? "Notifications are disabled in iOS Settings. Your saved data is unchanged."
						: DAILY_NOTICE,
			});
		} catch (error) {
			if (
				error instanceof StaleOperation ||
				generation !== ticket ||
				disposed
			) {
				// Finish cleanup for the captured account before allowing a queued new account to run.
				let cleanupFailed = false;
				for (const id of created) {
					try {
						await deps.cancel(id);
					} catch {
						cleanupFailed = true;
					}
				}
				if (capturedHash && created.length) {
					try {
						await deps.storage.save(capturedHash, {
							preferences: capturedPreferences,
							receipts: [...originalReceipts],
						});
						if (!disposed && generation === ticket)
							receipts = new Set(originalReceipts);
					} catch {
						cleanupFailed = true;
					}
				}
				if (cleanupFailed && !disposed)
					emit({
						scheduledCount: 0,
						error:
							"A stale reminder could not be cleared. Retry reminder refresh.",
					});
			}
			throw error;
		}
	};
	const manager = {
		getState: (): ReminderState => state,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setSnapshot(value: ReminderSnapshot) {
			if (disposed) return;
			const ownerChanged = value.owner !== snapshot.owner;
			const sessionChanged =
				ownerChanged || value.sessionKey !== snapshot.sessionKey;
			if (sessionChanged) generation++;
			revision++;
			snapshot = {
				...value,
				state: value.state
					? {
							...value.state,
							eyes: value.state.eyes.map((eye) => ({ ...eye })),
							daily: { ...value.state.daily },
						}
					: null,
				prescription: value.prescription
					? {
							...value.prescription,
							right: { ...value.prescription.right },
							left: { ...value.prescription.left },
						}
					: null,
			};
			// Ordinary data refreshes retain initialized preferences and explicit actions.
			// A token change still reloads after any captured-account write finishes.
			if (sessionChanged) {
				loadedOwner = null;
				ownerHash = null;
				receipts = new Set();
			}
			emit({
				scheduledCount: 0,
				...(sessionChanged
					? {
							preferences: ownerChanged
								? defaultPreferences()
								: state.preferences,
							permission: "undetermined" as const,
							loading: !!value.owner && !!value.sessionKey,
							error: null,
						}
					: {}),
			});
			void enqueue(reconcileInternal);
		},
		load() {
			return enqueue(reconcileInternal);
		},
		reconcile() {
			return enqueue(reconcileInternal);
		},
		updatePreferences(value: ReminderPreferences) {
			// Validate and capture the action/account before joining the serialized queue.
			const preferences = validatePreferences(value);
			return enqueue(async (ticket) => {
				await initialize(ticket);
				guard(ticket);
				if (!snapshot.owner || !snapshot.sessionKey || !ownerHash) return;
				const enabling = KINDS.some(
					(kind) =>
						preferences[kind].enabled && !state.preferences[kind].enabled,
				);
				if (enabling) {
					const permission = await deps.permission(true);
					guard(ticket);
					emit({ permission });
				}
				await persist(ticket, preferences, receipts);
				guard(ticket);
				emit({ preferences });
				await reconcileInternal(ticket);
			});
		},
		notificationContextReady(): boolean {
			return (
				!disposed &&
				!!snapshot.owner &&
				!!snapshot.sessionKey &&
				!!ownerHash &&
				loadedOwner === snapshot.owner
			);
		},
		// Do not perform hash/storage I/O within Expo's foreground delivery deadline.
		shouldPresentNotification(data: unknown): boolean {
			// SimpleState has no account/freshness proof, so daily suppression is conservative.
			return (
				!disposed &&
				!!snapshot.owner &&
				!!snapshot.sessionKey &&
				!!ownerHash &&
				isFeatureNotification(data) &&
				data.ownerHash === ownerHash
			);
		},
		async routeForNotification(
			data: unknown,
		): Promise<"/prescriptions" | "/(tabs)/home" | null> {
			const ticket = generation;
			await Promise.resolve();
			if (
				ticket !== generation ||
				!manager.shouldPresentNotification(data) ||
				!isFeatureNotification(data)
			)
				return null;
			return data.kind === "prescription" ? "/prescriptions" : "/(tabs)/home";
		},
		dispose() {
			disposed = true;
			generation++;
			listeners.clear();
		},
	};
	return manager;
}
