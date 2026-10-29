import Settings from "../../components/settings/screen";
import { useStore } from "../../lib/store";

export default function SettingsRoute() {
	const store = useStore();
	return store.account ? <Settings key={store.account.id} /> : null;
}
