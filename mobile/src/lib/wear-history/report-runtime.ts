import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { request, sessionStore } from "../api";
import type { WearHistorySession } from "./controller";
import { createWearReportController } from "./report-controller";
import { createWearReportPdf } from "./report-pdf";
import { createReportSharing } from "./report-sharing";
import { createWearHistoryTransport } from "./runtime";

const shareReport = createReportSharing({
	available: Sharing.isAvailableAsync,
	pdf: createWearReportPdf,
	create(report) {
		const directory = new Directory(Paths.cache, "oculog-wear-reports");
		directory.create({ idempotent: true, intermediates: true });
		// Only this feature's abandoned files (for example after process termination).
		for (const entry of directory.list()) {
			if (entry instanceof Directory && /^wear-[a-f0-9-]{36}$/.test(entry.name))
				entry.delete();
		}
		// Keep uniqueness private; give Save to Files a readable filename without a UUID.
		const temporary = new Directory(directory, `wear-${randomUUID()}`);
		const file = new File(
			temporary,
			`Oculog-wear-log-${report.from}-to-${report.through}.pdf`,
		);
		return {
			uri: file.uri,
			async write(bytes) {
				temporary.create();
				file.create();
				await file.write(bytes);
			},
			remove() {
				if (file.exists) file.delete();
				if (temporary.exists) temporary.delete();
			},
		};
	},
	share: (uri) =>
		Sharing.shareAsync(uri, {
			mimeType: "application/pdf",
			UTI: "com.adobe.pdf",
			dialogTitle: "Share wear log",
		}),
});

export function createDeviceWearReportController() {
	const currentSession = (): WearHistorySession => {
		const owner = sessionStore.account?.id;
		const token = sessionStore.token;
		return owner && token && sessionStore.isValid ? { owner, token } : null;
	};
	const runtime = createWearHistoryTransport(
		request,
		currentSession,
		randomUUID,
	);
	const controller = createWearReportController(
		runtime.transport.history,
		currentSession,
		shareReport,
	);
	let unsubscribe: (() => void) | undefined;
	return {
		...controller,
		mount() {
			unsubscribe ??= sessionStore.onChange(() => {
				runtime.syncSession();
				controller.syncSession();
			});
			controller.mount();
		},
		dispose() {
			unsubscribe?.();
			unsubscribe = undefined;
			controller.dispose();
		},
	};
}
