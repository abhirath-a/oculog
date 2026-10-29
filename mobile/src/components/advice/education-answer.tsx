// biome-ignore-all lint/suspicious/noArrayIndexKey: Validated paragraph order is immutable within a prepared answer.
import { useState } from "react";
import type { EducationAnswer as Answer } from "../../lib/education-api";
import { NativeDisclosure, NativeStack, PageText } from "../native-page";
import { SourceLink } from "./source-link";

export const educationModeLabel: Record<Answer["mode"], string> = {
	local_retrieval: "Source excerpts",
	generated: "AI-selected source excerpts",
	abstained: "No supported answer · abstention",
	safety: "Fixed safety guidance · not AI",
};
export function EducationAnswer({
	answer,
	onLinkError,
}: {
	answer: Answer;
	onLinkError(): void;
}) {
	const [showProvenance, setShowProvenance] = useState(false);
	const referenceNumbers = new Map(
		answer.sources.map((source, index) => [source.id, index + 1]),
	);
	return (
		<NativeStack>
			<PageText heading tone={answer.mode === "safety" ? "danger" : undefined}>
				{answer.title}
			</PageText>
			<PageText tone="secondary">{`${educationModeLabel[answer.mode]} · Response language: ${answer.language === "es" ? "Spanish" : "English"}`}</PageText>
			{answer.mode === "abstained" && (
				<NativeStack>
					<PageText>
						{answer.reason === "unsupported_general_topic"
							? "This question is outside the reviewed education topics. Gemini was not called. Choose a reviewed education topic to continue."
							: "No supported general-education answer is available. Choose a reviewed education topic to continue."}
					</PageText>
					<PageText>
						This does not assess your symptoms or rule out a problem.
					</PageText>
					{answer.reason && /^[a-z][a-z0-9_]{0,79}$/.test(answer.reason) && (
						<PageText tone="secondary">{`Response reason: ${answer.reason}`}</PageText>
					)}
				</NativeStack>
			)}
			{answer.mode === "generated" && (
				<PageText tone="secondary">
					Gemini selected original source excerpts, not a paraphrased answer.
					Check the originals below. Citation checks do not establish medical
					accuracy or suitability.
				</PageText>
			)}
			{answer.paragraphs.map((paragraph, index) => (
				<NativeStack key={`${answer.provenance.corpus_revision}-${index}`}>
					<PageText>{paragraph.text}</PageText>
					{!!paragraph.citations.length && (
						<PageText tone="secondary">{`References: ${paragraph.citations.map((id) => `[${referenceNumbers.get(id)}]`).join(", ")}`}</PageText>
					)}
				</NativeStack>
			))}
			{answer.sources.map((source, index) => (
				<NativeStack key={source.id}>
					<PageText tone="secondary">{`[${index + 1}] · ${source.authority} · ${source.language === "es" ? "Spanish" : "English"}`}</PageText>
					<SourceLink
						title={source.title}
						url={source.url}
						onError={onLinkError}
					/>
				</NativeStack>
			))}
			<NativeDisclosure
				label="View source excerpts and provenance"
				expanded={showProvenance}
				onExpandedChange={setShowProvenance}
			>
				<NativeStack>
					{answer.mode !== "abstained" &&
						answer.reason &&
						/^[a-z][a-z0-9_]{0,79}$/.test(answer.reason) && (
							<PageText tone="secondary">{`Response reason: ${answer.reason}`}</PageText>
						)}
					{answer.sources.map((source, index) => (
						<NativeStack key={source.id}>
							<PageText>{`[${index + 1}] · Chunk: ${source.id}`}</PageText>
							<PageText>{`Original source excerpt (${source.language === "es" ? "Spanish" : "English"})`}</PageText>
							<PageText>{source.excerpt}</PageText>
							<PageText tone="secondary">{`Document: ${source.document_id} · Retrieved: ${source.fetched_at} · Source modified: ${source.source_modified_at ?? "not supplied"}`}</PageText>
							<PageText tone="secondary">{`Passage SHA-256: ${source.content_sha256}`}</PageText>
						</NativeStack>
					))}
					<PageText tone="secondary">{`Corpus revision: ${answer.provenance.corpus_revision} · Retriever: ${answer.provenance.retriever_revision} · Prompt: ${answer.provenance.prompt_revision}${answer.provenance.model ? ` · Model: ${answer.provenance.model}` : " · No model used"}`}</PageText>
				</NativeStack>
			</NativeDisclosure>
		</NativeStack>
	);
}
