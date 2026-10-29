import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createPrescriptionRepository } from "./repository";

const options = {
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const prescriptionRepository = createPrescriptionRepository({
	async keyForOwner(owner) {
		return `oculog.prescription.v1.${await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, owner)}`;
	},
	getItem: (key) => SecureStore.getItemAsync(key, options),
	setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
	removeItem: (key) => SecureStore.deleteItemAsync(key, options),
});
