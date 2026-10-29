/** Explicit UI-only fixtures requested for React Native. Not a live product catalogue. */
export type MockProduct = {
	id: string;
	name: string;
	category: string;
	description: string;
	pros: string[];
	cons: string[];
	retailers: { name: string; url: string }[];
};

export const productConsultationNotice =
	"Consult an eye doctor before choosing or using a product or acting on this information. Suitability depends on your eyes, lenses and care plan. These mock examples are not recommendations or endorsements.";

const examples: Omit<MockProduct, "retailers">[] = [
	{
		id: "mock-rewetting-drops",
		name: "Contact-lens rewetting drops",
		category: "Eye drops",
		description:
			"Example of drops specifically labelled for use with contact lenses. No brand or formulation is selected.",
		pros: [
			"A lens-compatible formulation may help with temporary dryness.",
			"Small bottles can be convenient to carry.",
		],
		cons: [
			"Not all eye drops are safe to use while wearing lenses.",
			"Ingredients and preservatives may irritate some eyes; persistent symptoms need assessment.",
		],
	},
	{
		id: "mock-multipurpose-solution",
		name: "Multipurpose lens solution",
		category: "Cleaning and disinfection",
		description:
			"Example of a care product for compatible reusable lenses, not daily disposable lenses.",
		pros: [
			"A compatible product combines several lens-care functions in one system.",
			"One bottle may simplify an agreed care routine.",
		],
		cons: [
			"Compatibility varies by lens type and product.",
			"Ingredients may cause sensitivity, and incorrect use can leave lenses inadequately disinfected.",
		],
	},
	{
		id: "mock-peroxide-system",
		name: "Hydrogen peroxide lens-care system",
		category: "Cleaning and disinfection",
		description:
			"Example of a specialised system requiring its supplied case and complete neutralisation.",
		pros: [
			"Some systems offer a preservative-free option after full neutralisation.",
			"May be an option when an eye doctor recommends a different care system.",
		],
		cons: [
			"Unneutralised solution can cause serious eye injury; it must never go directly into the eye.",
			"Requires the correct case and the full manufacturer-specified neutralisation process.",
		],
	},
	{
		id: "mock-sterile-saline",
		name: "Sterile saline for lens care",
		category: "Rinsing",
		description:
			"Example of a sterile lens-care saline product, only for uses specified by its label and your eye doctor.",
		pros: [
			"May provide a compatible rinsing option within a prescribed care routine.",
		],
		cons: [
			"Saline does not disinfect contact lenses and does not replace disinfecting solution.",
			"Opened products can become contaminated; packaging and expiry instructions matter.",
		],
	},
	{
		id: "mock-lens-case",
		name: "Compatible contact-lens case",
		category: "Accessories",
		description:
			"Example of a storage accessory matched to the prescribed lens-care system.",
		pros: [
			"Provides separate compartments for reusable lenses.",
			"A correctly matched case supports the intended care system.",
		],
		cons: [
			"Cases can become contaminated and need care and replacement as directed.",
			"A standard case cannot replace the special case supplied with a peroxide system.",
		],
	},
];

export const mockProducts: readonly MockProduct[] = examples.map((product) => ({
	...product,
	retailers: [
		{
			name: "Amazon (US)",
			url: `https://www.amazon.com/s?k=${encodeURIComponent(product.name)}`,
		},
		{
			name: "Target (US)",
			url: `https://www.target.com/s?searchTerm=${encodeURIComponent(product.name)}`,
		},
	],
}));
