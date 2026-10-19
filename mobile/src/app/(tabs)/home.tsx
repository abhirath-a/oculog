import SimpleHome from "../../components/simple-home";
import { useStore } from "../../lib/store";

export default function Home() {
	const store = useStore();
	return store.account ? <SimpleHome key={store.account.id} /> : null;
}
