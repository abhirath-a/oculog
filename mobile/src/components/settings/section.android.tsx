import { FieldGroup } from "@expo/ui";
import { Column } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { Children, isValidElement, type ReactNode } from "react";
import { MaterialSection } from "./material-section.android";

/** Universal sections wrap each field in a ListItem headline slot. Compose
 * controls already own sizing and semantics; group them only once instead. */
export default function Section({
	children,
	title,
}: {
	children?: ReactNode;
	title?: string;
}) {
	const rows: ReactNode[] = [];
	const footers: ReactNode[] = [];
	Children.forEach(children, (child) => {
		if (
			isValidElement<{ children?: ReactNode }>(child) &&
			child.type === FieldGroup.SectionFooter
		)
			footers.push(child.props.children);
		else rows.push(child);
	});
	if (!title)
		return (
			<Column
				verticalArrangement={{ spacedBy: 8 }}
				modifiers={[fillMaxWidth()]}
			>
				{rows}
				{footers}
			</Column>
		);
	return (
		<MaterialSection title={title} footer={footers}>
			{rows}
		</MaterialSection>
	);
}
