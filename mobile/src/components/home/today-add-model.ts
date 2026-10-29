import { positiveInteger } from "../../lib/simple-controller";

/** Presentation feedback only. The owner validates again before confirmation/write. */
export function todayQuantityError(value: string): string {
	try {
		positiveInteger(value);
		return "";
	} catch (error) {
		return error instanceof Error ? error.message : "Check the quantity.";
	}
}
