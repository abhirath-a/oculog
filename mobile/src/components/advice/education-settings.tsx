import { useState } from "react";
import { providerReason } from "../../lib/advice-chat-api";
import type { createEducationController } from "../../lib/education-controller";
import {
	NativeDisclosure,
	NativeStack,
	PagePicker,
	PageText,
} from "../native-page";
import { Button, Toggle } from "./advice-controls";
import { SourceLink } from "./source-link";

type Control = ReturnType<typeof createEducationController>;
export function EducationSettings({
	control,
	state,
	onLinkError,
}: {
	control: Control;
	state: ReturnType<Control["getState"]>;
	onLinkError(): void;
}) {
	const status = state.status;
	const [expanded, setExpanded] = useState(true);
	return (
		<NativeStack>
			<PageText>{`${state.enabled ? "AI replies" : "Local source excerpts"} · ${state.language === "es" ? "Spanish" : "English"} · Gemini ${state.enabled ? "enabled" : "off"}`}</PageText>
			<PageText tone="secondary">
				General contact-lens information, with public CDC, FDA and NEI sources
				when relevant. AI replies can be wrong; not medical advice.
			</PageText>
			{!!state.error && <PageText tone="danger">{state.error}</PageText>}
			{status && !status.provider.available && (
				<PageText>{providerReason(status.provider.reason)}</PageText>
			)}
			{status?.provider.available && !state.enabled && (
				<PageText>
					Gemini is configured but off on this screen. Review the disclosure and
					grant consent below to enable future AI replies.
				</PageText>
			)}
			<NativeDisclosure
				label="Language and optional Gemini settings"
				expanded={expanded}
				onExpandedChange={setExpanded}
			>
				<NativeStack>
					<PagePicker
						label="Language for future questions"
						value={state.language}
						options={[
							{ value: "en", label: "English" },
							{ value: "es", label: "Español" },
						]}
						onChange={(value) =>
							control.setLanguage(value === "es" ? "es" : "en")
						}
					/>
					<PageText>
						This is not diagnosis, treatment, product selection or AI triage.
						Photos are never used here.
					</PageText>
					<PageText>
						After fresh consent, Gemini receives only your current question and
						relevant public source passages. Earlier messages stay local;
						account details, lens records and photos are not sent. The question
						itself can contain sensitive information: do not include identifiers
						or personal medical histories. Include needed context in each
						question.
					</PageText>
					<PageText tone="secondary">
						English and Spanish questions are supported. Optional AI replies can
						explain general lens questions beyond the local source collection.
						Citations identify relevant public passages, not proof that every
						claim is correct. The interface is not fully translated or
						clinically validated.
					</PageText>
					{state.loading && (
						<PageText>
							Checking optional Gemini availability… Source search and fixed
							safety do not depend on this check.
						</PageText>
					)}
					{status && (
						<NativeStack>
							{!status.provider.available && (
								<PageText>{`${!status.provider.configured ? "Gemini is not configured on the server. You can still search real source excerpts without AI or external-provider consent." : "Gemini is currently unavailable. Source-excerpt search remains available."}${status.provider.reason ? ` Server reason: ${status.provider.reason}.` : ""}`}</PageText>
							)}
							<PageText>{status.disclosure.text}</PageText>
							<PageText tone="secondary">
								Paid Gemini processing may retain limited safety/abuse logs;
								this is not a zero-retention service. Withdrawal affects future
								requests and cannot recall material already transmitted. The
								application has no monthly spending limit. Provider charges may
								continue; the operator controls Google billing.
							</PageText>
							<SourceLink
								title="Gemini paid-service terms"
								url={status.disclosure.terms_url}
								onError={onLinkError}
							/>
							<PageText tone="secondary">{`Disclosure version: ${status.disclosure.version}. Adult acknowledgment is not age verification. Source-excerpt search requires no external-provider consent; optional Gemini is adults-only.`}</PageText>
							<Toggle
								label="I acknowledge that I am 18 or older"
								value={state.adultAck}
								disabled={state.busy || state.enabled}
								onChange={control.setAdultAck}
							/>
							<Toggle
								label="I consent to send my current question and public source passages to Gemini"
								value={state.externalConsent}
								disabled={state.busy || state.enabled}
								onChange={control.setExternalConsent}
							/>
							<Button
								title="Grant consent and enable Gemini for future questions"
								secondary
								disabled={
									state.busy ||
									state.enabled ||
									!state.adultAck ||
									!state.externalConsent ||
									!status.provider.available
								}
								onPress={() => {
									void control.grant();
								}}
							/>
						</NativeStack>
					)}
					<Button
						title="Turn off Gemini and clear chat"
						secondary
						onPress={() => {
							void control.withdraw();
						}}
					/>
					<Button
						title="Refresh AI availability"
						secondary
						disabled={state.loading || state.busy}
						onPress={() => {
							void control.load();
						}}
					/>
				</NativeStack>
			</NativeDisclosure>
		</NativeStack>
	);
}
