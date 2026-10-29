/** Success-only, best effort. Never let device settings or missing hardware fail a mutation. */
export async function notifySuccess(): Promise<void> {
	try {
		const { notificationAsync, NotificationFeedbackType } = await import(
			"expo-haptics"
		);
		await notificationAsync(NotificationFeedbackType.Success);
	} catch {
		// Haptics are optional feedback, not part of persistence.
	}
}
