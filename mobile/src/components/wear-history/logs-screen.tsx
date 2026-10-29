import { HStack } from "@expo/ui/swift-ui";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useStore } from "../../lib/store";
import { localMonth, weekdayMonday } from "../../lib/wear-history/model";
import { reportDayStatus, reportMonths } from "../../lib/wear-history/report";
import { createDeviceWearReportController } from "../../lib/wear-history/report-runtime";
import {
	NativePage,
	NativeRow,
	NativeSection,
	NativeText,
	PageToggle,
} from "../native-page";
import {
	dateLabel,
	monthLabel,
	ownsSession,
	sessionLease,
	useSessionLease,
	WEEKDAYS,
	WearAction,
} from "./native-support";

export default function WearLogsScreen({
	owner,
	insetMode = "stack",
}: {
	owner: string;
	insetMode?: "tabs" | "stack";
}) {
	const store = useStore();
	const lease = useSessionLease();
	if (!lease || !ownsSession(owner) || store.account?.id !== owner)
		return (
			<NativePage title="Wear logs" insetMode={insetMode}>
				<NativeSection title="Your history">
					<NativeRow>
						<NativeText>Loading your account…</NativeText>
					</NativeRow>
				</NativeSection>
			</NativePage>
		);
	return (
		<LogsContent
			key={`${owner}:${lease}`}
			owner={owner}
			lease={lease}
			initialMonth={store.state?.today.slice(0, 7) ?? localMonth()}
			insetMode={insetMode}
		/>
	);
}

function LogsContent({
	owner,
	lease,
	initialMonth,
	insetMode,
}: {
	owner: string;
	lease: string;
	initialMonth: string;
	insetMode: "tabs" | "stack";
}) {
	const router = useRouter();
	const controller = useMemo(() => createDeviceWearReportController(), []);
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getState,
		controller.getState,
	);
	const mounted = useRef(false);
	const alive = useRef(false);
	const [chosenMonth, setChosenMonth] = useState("");
	const [showOtherDays, setShowOtherDays] = useState(false);
	const monthRevision = useRef(0);
	const renderedRevision = monthRevision.current;
	const current = () =>
		mounted.current && sessionLease() === lease && ownsSession(owner);
	usePreventRemove(state.exporting, () => {});
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			mounted.current = false;
			controller.dispose();
		};
	}, [controller]);
	useFocusEffect(
		useCallback(() => {
			if (!alive.current || sessionLease() !== lease || !ownsSession(owner))
				return;
			mounted.current = true;
			controller.mount();
			void controller.load(initialMonth);
			return () => {
				mounted.current = false;
				controller.dispose();
			};
		}, [controller, initialMonth, owner, lease]),
	);
	const busy = state.loading || state.exporting;
	const report = state.report;
	const months = report ? reportMonths(report.from, report.through) : [];
	const month = months.includes(chosenMonth)
		? chosenMonth
		: (months.at(-1) ?? "");
	const index = months.indexOf(month);
	const days = (
		report?.days.filter(
			(day) =>
				day.localDate.startsWith(`${month}-`) &&
				(showOtherDays || day.worn === true),
		) ?? []
	).reverse();
	const navigateMonth = (offset: number) => {
		if (
			!current() ||
			busy ||
			controller.getState().report !== report ||
			monthRevision.current !== renderedRevision
		)
			return;
		const next = months[index + offset];
		if (next) {
			monthRevision.current++;
			setChosenMonth(next);
		}
	};
	return (
		<NativePage
			title="Wear logs"
			subtitle="Past 12 months"
			insetMode={insetMode}
		>
			<NativeSection title="Your year at a glance">
				<NativeRow>
					{report && (
						<>
							<NativeText>{`${dateLabel(report.from)} – ${dateLabel(report.through)}`}</NativeText>
							<NativeText>{`${report.totals.confirmedWear} confirmed worn\n${report.totals.confirmedNoWear} confirmed not worn\n${report.totals.assumedWear} assumed worn\n${report.totals.unknown} unknown`}</NativeText>
						</>
					)}
					{state.loading && (
						<NativeText>Loading your complete past year…</NativeText>
					)}
					{!!state.error && <NativeText tone="error">{state.error}</NativeText>}
					<WearAction
						label="Refresh logs"
						blocked={busy}
						onPress={() => {
							if (current()) void controller.load(initialMonth);
						}}
					/>
				</NativeRow>
			</NativeSection>
			<NativeSection title="PDF report">
				<NativeRow>
					<WearAction
						label={state.exporting ? "Preparing…" : "Export PDF"}
						accessibility="Export all wear logs for the past 12 months as a PDF"
						primary
						blocked={busy || !report}
						onPress={() => {
							if (current()) void controller.exportPdf();
						}}
					/>
					{state.exporting && (
						<NativeText>
							Refreshing the complete year before sharing. Please stay on this
							screen.
						</NativeText>
					)}
					<NativeText tone="secondary">
						The PDF contains personal wear history. Share it only with people or
						apps you trust. The app removes its temporary copy after sharing.
					</NativeText>
				</NativeRow>
			</NativeSection>
			{report && (
				<NativeSection title={monthLabel(month)}>
					<NativeRow>
						<HStack spacing={12}>
							<WearAction
								label="Earlier"
								accessibility="Earlier month of wear logs"
								blocked={busy || index <= 0}
								onPress={() => navigateMonth(-1)}
							/>
							<WearAction
								label="Later"
								accessibility="Later month of wear logs"
								blocked={busy || index >= months.length - 1}
								onPress={() => navigateMonth(1)}
							/>
						</HStack>
						<PageToggle
							label="Show no-wear and unknown days"
							value={showOtherDays}
							disabled={busy}
							onChange={(value) => {
								if (
									current() &&
									!busy &&
									controller.getState().report === report
								)
									setShowOtherDays(value);
							}}
						/>
					</NativeRow>
					{days.map((day) => (
						<NativeRow key={day.localDate}>
							<NativeText>{`${WEEKDAYS[weekdayMonday(day.localDate)]}, ${dateLabel(day.localDate)}`}</NativeText>
							<NativeText tone="secondary">{reportDayStatus(day)}</NativeText>
						</NativeRow>
					))}
					{!days.length && (
						<NativeRow>
							<NativeText>
								No worn dates in this part of the month. Turn on Show no-wear
								and unknown days to see every date.
							</NativeText>
						</NativeRow>
					)}
				</NativeSection>
			)}
			<NativeSection title="Manage your log">
				<NativeRow>
					<NativeText tone="secondary">
						Use the calendar to confirm, correct or clear an individual date.
						Viewing and exporting do not change your records, inventory or
						replacement dates.
					</NativeText>
					<WearAction
						label="Calendar"
						accessibility="Open wear calendar to edit entries"
						blocked={busy}
						onPress={() => {
							if (current()) router.navigate("/wear-history" as Href);
						}}
					/>
				</NativeRow>
			</NativeSection>
		</NativePage>
	);
}
