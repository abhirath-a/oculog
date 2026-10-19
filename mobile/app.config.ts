import type { ConfigContext, ExpoConfig } from "expo/config";
/** Public build configuration only. Email action links are not supported. */
export default function configure({ config }: ConfigContext): ExpoConfig {
	const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
	return {
		...config,
		name: config.name || "Oculog",
		slug: config.slug || "oculog",
		extra: { ...config.extra, ...(projectId ? { eas: { projectId } } : {}) },
	};
}
