import ProductsScreen from "../components/products/products-screen";
import { useStore } from "../lib/store";

export default function Products() {
	const store = useStore();
	return store.account ? (
		<ProductsScreen key={store.account.id} insetMode="stack" />
	) : null;
}
