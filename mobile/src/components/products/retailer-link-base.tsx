import { Linking } from "react-native";
import { isSafeAdviceURL } from "../../lib/advice-api";
import { NativeAction } from "../native-page";
export function RetailerLink({
	name,
	url,
	onError,
}: {
	name: string;
	url: string;
	onError(): void;
}) {
	if (!isSafeAdviceURL(url)) return null;
	return (
		<NativeAction
			label={`Search ${name} ↗`}
			onPress={() => {
				if (isSafeAdviceURL(url)) void Linking.openURL(url).catch(onError);
			}}
		/>
	);
}
