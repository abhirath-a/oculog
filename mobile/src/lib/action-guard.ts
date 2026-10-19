export type ActionSession = { owner: string | undefined; token: string };
/** A delayed action must never publish failures into a different session. */
export function reportActionFailure(
	error: unknown,
	requested: ActionSession,
	current: ActionSession,
	connectionFailed: () => void,
	showError: () => void,
) {
	if (requested.owner !== current.owner || requested.token !== current.token)
		return false;
	if ((error as { status?: number }).status === 0) connectionFailed();
	showError();
	return true;
}
