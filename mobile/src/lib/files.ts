import { Directory, File, Paths } from "expo-file-system";
import { PrivateArtifacts } from "./safety";

// Clean app-owned private artifacts, including temporary wear reports and older exports.
const artifacts = new PrivateArtifacts();
export async function cleanupPrivateFiles() {
	await artifacts.cleanup();
	for (const name of ["oculog-private", "oculog-wear-reports"]) {
		const directory = new Directory(Paths.cache, name);
		if (directory.exists) directory.delete();
	}
	for (const name of ["oculog-export.json", "oculog-export.zip"]) {
		const file = new File(Paths.cache, name);
		if (file.exists) file.delete();
	}
}
