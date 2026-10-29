export type TopicNodeProps = {
	title: string;
	index: number;
	selected: boolean;
	onPress(): void;
};
export const topicSymbols = [
	"drop",
	"hand.raised",
	"eye",
	"sun.max",
	"moon",
	"case",
	"shield",
	"book",
] as const;
