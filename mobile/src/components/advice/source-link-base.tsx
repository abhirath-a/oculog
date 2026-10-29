import { Linking } from "react-native";
import { isSafeAdviceURL } from "../../lib/advice-api";
import { NativeAction } from "../native-page";
export function SourceLink({
	title,
	url,
	onError,
}: {
	title: string;
	url: string;
	onError(): void;
}) {
	if (!isSafeAdviceURL(url)) return null;
	return (
		<NativeAction
			label={`Source: ${title} ↗`}
			onPress={() => {
				if (isSafeAdviceURL(url)) void Linking.openURL(url).catch(onError);
			}}
		/>
	);
}
