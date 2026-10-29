import { Column, Host, Row } from "@expo/ui";
import { useState } from "react";
import { View } from "react-native";
import { TopicNode } from "./topic-node";

export type TopicMapProps = {
	rows: { id: string; title: string }[][];
	selectedID?: string;
	onSelect(id: string): void;
};

/** One measured native island, never native buttons directly inside RN rows. */
export function TopicMap({ rows, selectedID, onSelect }: TopicMapProps) {
	const [width, setWidth] = useState(0);
	const spacing = (index: number) =>
		index === 0 || index === rows.length - 1 ? 32 : 96;
	const rowWidth = (index: number) => {
		const count = rows[index]?.length ?? 0;
		return count * 56 + Math.max(0, count - 1) * spacing(index);
	};
	// Fixed-size button geometry; the actual parent still supplies Host width.
	const height = Math.max(0, rows.length * 56 + (rows.length - 1) * 14);
	if (!rows.length) return null;
	return (
		<View
			style={{
				width: Math.max(250, ...rows.map((_, index) => rowWidth(index))),
				height,
			}}
			onLayout={({ nativeEvent: { layout } }) => {
				if (Number.isFinite(layout.width) && layout.width > 0)
					setWidth((previous) =>
						previous === layout.width ? previous : layout.width,
					);
			}}
		>
			{width > 0 && (
				<Host style={{ width, height }}>
					<Column alignment="center" spacing={14} style={{ width, height }}>
						{rows.map((row, index) => (
							<Row
								key={row[0]?.id ?? `row-${index}`}
								alignment="center"
								spacing={spacing(index)}
								style={{ width: rowWidth(index), height: 56 }}
							>
								{row.map((lesson, column) => (
									<TopicNode
										key={lesson.id}
										title={lesson.title}
										index={index * 2 + column}
										selected={lesson.id === selectedID}
										onPress={() => onSelect(lesson.id)}
									/>
								))}
							</Row>
						))}
					</Column>
				</Host>
			)}
		</View>
	);
}
