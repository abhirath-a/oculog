// Presentation only: format literal calendar components, never convert time zones.
function openedLabel(value: string) {
	return value.replace(
		/Opened on (\d{4})-(\d{2})-(\d{2})/i,
		(_, year, month, day) => {
			const name = [
				"Jan",
				"Feb",
				"Mar",
				"Apr",
				"May",
				"Jun",
				"Jul",
				"Aug",
				"Sep",
				"Oct",
				"Nov",
				"Dec",
			][Number(month) - 1];
			return name
				? `Opened ${Number(day)} ${name} ${year}`
				: `Opened ${year}-${month}-${day}`;
		},
	);
}

/** Reflow the saved summary, not the editor draft, into per-eye supporting lines. */
export function supportingLines(summary: string) {
	const [intervals = "Not set", dates = "No open lenses"] = summary.split("\n");
	const clause = (line: string, eye: string, shared: string) => {
		if (line.startsWith(`${shared} · `)) return line.slice(shared.length + 3);
		return (
			line
				.split("; ")
				.find((part) => part.startsWith(`${eye} · `))
				?.slice(eye.length + 3) ?? line
		);
	};
	return ["Left", "Right"].map((eye) => {
		const interval = clause(intervals, eye, "Both eyes");
		const opened = clause(dates, eye, "Both lenses");
		return `${eye}: ${interval === "Not set" ? "Interval not set" : interval} · ${opened === "No open lenses" ? "No open lens" : openedLabel(opened)}`;
	});
}
