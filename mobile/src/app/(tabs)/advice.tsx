import AdviceScreen from "../../components/advice/advice-screen";
import { useStore } from "../../lib/store";

export default function Advice() {
	const store = useStore();
	return store.account ? <AdviceScreen key={store.account.id} /> : null;
}
