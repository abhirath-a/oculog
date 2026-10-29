import { useState } from "react";
import {
	type MockProduct,
	mockProducts,
	productConsultationNotice,
} from "../../lib/product-mocks";
import {
	NativeDisclosure,
	NativePage,
	NativeRow,
	NativeSection,
	NativeStack,
	PageText,
} from "../native-page";
import { RetailerLink } from "./retailer-link";

export function ProductRow({
	product,
	separated = false,
}: {
	product: MockProduct;
	separated?: boolean;
}) {
	const [expanded, setExpanded] = useState(false);
	const [retailersExpanded, setRetailersExpanded] = useState(false);
	const [linkError, setLinkError] = useState(false);
	return (
		<NativeRow separated={separated}>
			<PageText heading>{product.name}</PageText>
			<PageText tone="secondary">{`Example · ${product.category}`}</PageText>
			<PageText>{product.description}</PageText>
			<PageText>{`Potential benefit: ${product.pros[0]}`}</PageText>
			{/* Essential peroxide/saline hazards stay visible even when details are closed. */}
			<PageText>{`Check: ${product.cons[0]}`}</PageText>
			<NativeDisclosure
				label="More benefits and checks"
				expanded={expanded}
				onExpandedChange={setExpanded}
			>
				<NativeStack>
					{!!product.pros.slice(1).length && (
						<NativeStack>
							<PageText heading>Potential benefits</PageText>
							{product.pros.slice(1).map((pro) => (
								<PageText key={pro}>{`• ${pro}`}</PageText>
							))}
						</NativeStack>
					)}
					<NativeStack>
						<PageText heading>Things to check</PageText>
						{product.cons.slice(1).map((con) => (
							<PageText key={con}>{`• ${con}`}</PageText>
						))}
					</NativeStack>
					<PageText>
						Consult your eye doctor before using this type of product or acting
						on this information.
					</PageText>
				</NativeStack>
			</NativeDisclosure>
			<NativeDisclosure
				label="Retailer searches"
				expanded={retailersExpanded}
				onExpandedChange={setRetailersExpanded}
			>
				<NativeStack>
					<PageText tone="secondary">
						Search Amazon and Target in the US for this example product type.
						These are not endorsements or verified listings, stock or prices.
						Check the product label, seller, price and availability. For nearby
						pickup, choose your store on the retailer website; this app does not
						use your location.
					</PageText>
					{product.retailers.map((retailer) => (
						<RetailerLink
							key={retailer.name}
							{...retailer}
							onError={() => setLinkError(true)}
						/>
					))}
					{linkError && (
						<PageText tone="danger">
							Could not open the retailer. Please try the link again.
						</PageText>
					)}
				</NativeStack>
			</NativeDisclosure>
		</NativeRow>
	);
}
export default function ProductsScreen({
	insetMode = "tabs",
}: {
	insetMode?: "tabs" | "stack";
}) {
	const [aboutExpanded, setAboutExpanded] = useState(false);
	return (
		<NativePage
			title="Products"
			insetMode={insetMode}
			subtitle="Example catalogue · not recommendations"
		>
			<NativeSection title="Before choosing">
				<NativeRow>
					<PageText>
						Consult an eye-care professional before choosing or using a product.
						Suitability depends on your eyes, lenses and care plan.
					</PageText>
					<PageText tone="secondary">
						Mock examples only · no real brands, prices, stock or verified
						product claims.
					</PageText>
					<NativeDisclosure
						label="About these examples"
						expanded={aboutExpanded}
						onExpandedChange={setAboutExpanded}
					>
						<NativeStack>
							<PageText>{productConsultationNotice}</PageText>
							<PageText tone="secondary">
								This preview uses mock data. It is not connected to the server
								catalogue and does not show real brands, prices, stock or
								verified product claims. Review and sentiment scraping is not
								integrated; these examples do not show real reviews or
								availability.
							</PageText>
						</NativeStack>
					</NativeDisclosure>
				</NativeRow>
			</NativeSection>
			<NativeSection title="Product types">
				{mockProducts.map((product, index) => (
					<ProductRow
						key={product.id}
						product={product}
						separated={index > 0}
					/>
				))}
			</NativeSection>
		</NativePage>
	);
}
