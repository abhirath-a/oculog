import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { PrivateArtifacts } from "./safety";

// Keep cleanup of app-owned private files from older app versions, even though
// document downloads and exports are no longer active features.
const artifacts = new PrivateArtifacts();
export async function cleanupPrivateFiles() {
	await artifacts.cleanup();
	if (Platform.OS !== "web") {
		const directory = new Directory(Paths.cache, "oculog-private");
		if (directory.exists) directory.delete();
		for (const name of ["oculog-export.json", "oculog-export.zip"]) {
			const file = new File(Paths.cache, name);
			if (file.exists) file.delete();
		}
	}
}
