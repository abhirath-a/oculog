import type { WearReport } from "./report";

export type ReportFile = {
	uri: string;
	write(bytes: Uint8Array): Promise<void>;
	remove(): void;
};
export type ReportSharingIO = {
	available(): Promise<boolean>;
	create(report: WearReport): ReportFile;
	pdf(report: WearReport): Uint8Array;
	share(uri: string): Promise<void>;
};

/** Explicit, device-local sharing only. Owns exactly one temporary file, including partial writes. */
export function createReportSharing(io: ReportSharingIO) {
	let busy = false;
	return async (report: WearReport, current: () => boolean) => {
		const check = () => {
			if (!current())
				throw new Error(
					"Your session changed. Reopen wear logs before exporting.",
				);
		};
		check();
		if (busy) throw new Error("Finish sharing the existing report first.");
		busy = true;
		let file: ReportFile | undefined;
		try {
			const available = await io.available();
			check();
			if (!available)
				throw new Error("File sharing is not available on this device.");
			const bytes = io.pdf(report);
			check();
			file = io.create(report);
			await file.write(bytes);
			check();
			await io.share(file.uri);
		} finally {
			try {
				file?.remove();
			} finally {
				busy = false;
			}
		}
	};
}
