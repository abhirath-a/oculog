// biome-ignore-all lint/a11y/useValidAriaRole: TodayText role is a typography token.
import { Column, Row } from "@expo/ui";
import { useState } from "react";
import type {
	SimpleEye,
	SimpleEyeState,
	SimpleState,
} from "../../../shared/simple-domain";
import type { Eye } from "../../lib/simple-controller";
import type { HomeContentProps } from "./model";
import {
	TodayAction,
	TodayDisclosure,
	TodayRow,
	TodaySection,
	TodayText,
} from "./today-design";
import { todayCalendarDate, todayLens, todayPresentation } from "./today-model";
import { useTodayWear } from "./today-wear";

export function EyeCard({
	settings,
	disabled,
	onReplace,
	primary = false,
	separated = false,
}: {
	settings: SimpleEyeState;
	disabled: boolean;
	onReplace: (eye: Eye) => void;
	primary?: boolean;
	separated?: boolean;
}) {
	const lens = todayLens(settings);
	return (
		<TodayRow separated={separated}>
			<TodayText role="secondary" tone="secondary">
				{lens.name}
			</TodayText>
			<TodayText role="headline">{lens.status}</TodayText>
			<TodayText role="secondary" tone="secondary">
				{lens.stock}
			</TodayText>
			{/* {lens.task && settings.spareCount > 0 && ( */}
			<TodayAction
				label={lens.action}
				danger
				selected
				disabled={disabled}
				onPress={() => {
					if (!disabled) onReplace(settings.eye);
				}}
			/>
			{/* )}  */}
		</TodayRow>
	);
}

export function DailyLogSection({
	state,
	disabled,
	onLog,
	eyes,
	onHistory,
}: {
	state: SimpleState;
	disabled: boolean;
	onLog: (worn: boolean) => void;
	eyes: SimpleEyeState[];
	onHistory?: () => void;
}) {
	const choice = useTodayWear(state, disabled, onLog);
	return (
		<TodaySection title="Did you wear contact lenses today?">
			<TodayRow>
				<Row style={{ width: "100%" }}>
					{[true, false].map((value) => (
						<Column
							key={String(value)}
							style={{
								width: "50%",
								paddingLeft: value ? 0 : 4,
								paddingRight: value ? 4 : 0,
							}}
						>
							<TodayAction
								label={value ? "Yes" : "No"}
								selected={choice.selected === value}
								disabled={choice.disabled}
								onPress={() => choice.choose(value)}
								danger={eyes.some((item) => todayLens(item).task)}
							/>
						</Column>
					))}
				</Row>
				{onHistory ? (
					<TodayAction
						label="Missed a day? Open calendar"
						disabled={disabled}
						onPress={() => {
							if (!disabled) onHistory();
						}}
					/>
				) : (
					<TodayText>missed a day?</TodayText>
				)}
				{/* <TodayText role="secondary" tone="secondary"> */}
				{/* </TodayText> */}
			</TodayRow>
		</TodaySection>
	);
}

/** Single scroll owner and vertically ordered grouped list on every platform. */
export default function HomeContent({
	state,
	disabled,
	onLog,
	onReplace,
	onSettings,
	onAdd,
	onHistory,
}: HomeContentProps) {
	const [details, setDetails] = useState(false);
	const model = todayPresentation(state);
	const add = (
		<TodayAction
			label="Add spares"
			emphasis={model.primary === "add" ? "primary" : "secondary"}
			disabled={disabled}
			onPress={() => {
				if (!disabled) onAdd();
			}}
		/>
	);
	return (
		<>
			<DailyLogSection
				state={state}
				disabled={disabled}
				onLog={onLog}
				eyes={model.eyes}
				onHistory={onHistory}
			/>
			<TodaySection title="Lenses">
				{model.eyes.map((settings, index) => (
					<EyeCard
						key={settings.eye}
						settings={settings}
						separated={index > 0}
						disabled={disabled}
						onReplace={onReplace}
						primary={model.primary === settings.eye}
					/>
				))}
				{(model.needsSetup || model.primary === "add") && (
					<TodayRow separated>
						{model.needsSetup && (
							<TodayAction
								label="Set up lenses"
								emphasis={model.primary === "setup" ? "primary" : "secondary"}
								disabled={disabled}
								onPress={() => {
									if (!disabled) onSettings();
								}}
							/>
						)}
						{model.primary === "add" && add}
					</TodayRow>
				)}
			</TodaySection>
			<TodaySection title="More">
				{model.primary !== "add" && <TodayRow separated>{add}</TodayRow>}
			</TodaySection>
		</>
	);
}
