/** Presentation only: no message, account or provider state. */
export function composerBounds(fontScale: number) {
	const scale =
		Number.isFinite(fontScale) && fontScale > 0 ? Math.max(1, fontScale) : 1;
	const min = Math.max(44, Math.ceil(22 * scale + 20));
	return {
		min,
		max: Math.max(min, Math.min(160, Math.ceil(22 * scale * 5 + 20))),
	};
}
export function measuredComposerHeight(
	height: number,
	bounds: { min: number; max: number },
) {
	return Number.isFinite(height) && height > 0
		? Math.max(bounds.min, Math.min(bounds.max, Math.ceil(height)))
		: bounds.min;
}
export function createChatScrollPolicy() {
	let following = true;
	return {
		shouldFollow: () => following,
		requestFollow() {
			following = true;
		},
		onScroll(offset: number, viewport: number, content: number) {
			if (
				[offset, viewport, content].every(Number.isFinite) &&
				viewport > 0 &&
				content >= 0
			)
				following = content - Math.max(0, offset) - viewport <= 64;
		},
	};
}
