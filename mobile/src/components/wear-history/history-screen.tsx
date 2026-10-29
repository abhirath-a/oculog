import { DatePicker, Host, Toggle, VStack } from "@expo/ui/swift-ui";
import {
	datePickerStyle,
	disabled,
	environment,
} from "@expo/ui/swift-ui/modifiers";
import { type Href, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { useStore } from "../../lib/store";
import {
	type HistoryDay,
	localMonth,
	validMonth,
} from "../../lib/wear-history/model";
import {
	NativePage,
	NativeRow,
	NativeSection,
	NativeText,
} from "../native-page";
import {
	dateLabel,
	dayStatus,
	ownsSession,
	useSessionLease,
	useWearController,
	WearAction,
} from "./native-support";

export type WearHistoryScreenProps = { owner: string };

// Use UTC for the graphical calendar so a YYYY-MM-DD account date is
// never shifted by the phone's local time zone.
function calendarDate(iso: string): Date {
	return new Date(`${iso}T12:00:00.000Z`);
}
function calendarISO(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export default function WearHistoryScreen({ owner }: WearHistoryScreenProps) {
	const store = useStore();
	const lease = useSessionLease();
	const initialMonth = store.state?.today.slice(0, 7) ?? localMonth();
	if (
		!lease ||
		!ownsSession(owner) ||
		store.account?.id !== owner ||
		!initialMonth ||
		!validMonth(initialMonth)
	) {
		return (
			<NativePage title="Wear history" insetMode="stack">
				<NativeSection title="Wear calendar">
					<NativeRow>
						<NativeText>Loading your account calendar…</NativeText>
					</NativeRow>
				</NativeSection>
			</NativePage>
		);
	}
	return (
		<HistoryContent
			key={`${owner}:${lease}`}
			owner={owner}
			lease={lease}
			initialMonth={initialMonth}
		/>
	);
}

function HistoryContent({
	owner,
	lease,
	initialMonth,
}: WearHistoryScreenProps & { lease: string; initialMonth: string }) {
	const store = useStore();
	const router = useRouter();
	const { controller, state, generation, lock, current, currentMonth } =
		useWearController(owner, lease, initialMonth);
	const [selection, setSelection] = useState<{
		month: string;
		date: string;
	} | null>(null);
	const [notice, setNotice] = useState("");
	const selectionRevision = useRef(0);
	const renderedSelection = selectionRevision.current;
	const history = state.history?.month === state.month ? state.history : null;
	const selected =
		selection?.month === state.month
			? history?.days.find((day) => day.localDate === selection.date)
			: undefined;
	const blocked = state.busy || state.loading;
	const accountToday = history?.today ?? store.state?.today;
	const pickerDate =
		selection?.date ??
		(accountToday?.startsWith(`${state.month}-`)
			? accountToday
			: `${state.month}-01`);

	const selectISO = (iso: string) => {
		if (
			!currentMonth() ||
			blocked ||
			lock.current ||
			!history ||
			iso > history.today
		)
			return;
		const month = iso.slice(0, 7);
		selectionRevision.current++;
		setSelection({ month, date: iso });
		setNotice("");
		if (month !== state.month) void controller.load(month);
	};

	const save = (worn: boolean | null) => {
		if (
			!currentMonth() ||
			blocked ||
			lock.current ||
			selectionRevision.current !== renderedSelection ||
			!selected ||
			!history ||
			selected.localDate > history.today
		)
			return;
		lock.current = true;
		const ticket = generation.current;
		const date = selected.localDate;
		setNotice("");
		void controller
			.saveDay(date, worn)
			.then(async (acknowledged) => {
				if (!acknowledged || !current() || ticket !== generation.current)
					return;
				setNotice(
					`Saved ${dateLabel(date)}: ${
						worn === null
							? "unknown"
							: worn
								? "manually confirmed wear"
								: "manually confirmed no wear"
					}.`,
				);
				await store.reload();
			})
			.catch(() => {
				if (current() && ticket === generation.current)
					setNotice("Could not refresh your log. Reload before retrying.");
			})
			.finally(() => {
				if (ticket === generation.current) lock.current = false;
			});
	};

	const manualWear =
		history?.days.filter((day) => day.source === "manual" && day.worn).length ??
		0;
	const manualNoWear =
		history?.days.filter((day) => day.source === "manual" && !day.worn)
			.length ?? 0;
	const assumed =
		history?.days.filter((day) => day.source === "assumed").length ?? 0;

	return (
		<NativePage
			title="Wear history"
			subtitle="Your account calendar"
			insetMode="stack"
		>
			{history && (
				<NativeSection title="This month">
					<NativeRow>
						<NativeText>
							{`${manualWear} confirmed worn,\n${manualNoWear} confirmed not worn\n${assumed} assumed worn`}
						</NativeText>
					</NativeRow>
				</NativeSection>
			)}
			<NativeSection title="Wear logs & PDF">
				<NativeRow>
					<NativeText tone="secondary">
						Review when you wore contacts and export your complete past year,
						with confirmed, assumed and unknown days clearly labelled.
					</NativeText>
					<WearAction
						label="Logs & PDF"
						accessibility="View wear logs and export the past year as PDF"
						blocked={blocked}
						onPress={() => {
							if (currentMonth() && !lock.current)
								router.navigate("/logs" as Href);
						}}
					/>
				</NativeRow>
			</NativeSection>
			<NativeSection title="Calendar">
				<NativeRow>
					{state.loading && <NativeText>Loading calendar…</NativeText>}
					{!!state.error && <NativeText tone="error">{state.error}</NativeText>}
					{accountToday && (
						<DatePicker
							title="Select date"
							selection={calendarDate(pickerDate)}
							displayedComponents={["date"]}
							range={{
								start: calendarDate("0001-01-01"),
								end: calendarDate(accountToday),
							}}
							modifiers={[
								datePickerStyle("compact"),
								environment("timeZone", "UTC"),
								disabled(blocked),
							]}
							onDateChange={(date) => selectISO(calendarISO(date))}
						/>
					)}
				</NativeRow>

				<WearAction
					label="Refresh history"
					blocked={blocked}
					onPress={() => {
						if (currentMonth() && !lock.current)
							void controller.load(state.month);
					}}
				/>
			</NativeSection>

			{history && (
				<>
					<NativeSection
						title={selected ? dateLabel(selected.localDate) : "Selected day"}
					>
						<NativeRow>
							{selected ? (
								<>
									<NativeText>
										{new Date(selected.localDate).toDateString()}
									</NativeText>
									{selected.source === "assumed" && (
										<NativeText tone="secondary">
											Automatically assumed from your saved weekday settings.
										</NativeText>
									)}
									<Toggle
										isOn={selected.worn ?? false}
										onIsOnChange={save}
										label={`${dayStatus(selected)}`}
									/>

									<WearAction
										label="Clear to unknown"
										blocked={blocked}
										onPress={() => save(null)}
									/>
									{/* <NativeText tone="secondary"> */}
									{/*   Clearing a date keeps it unknown, even after automatic logging refreshes. */}
									{/*   None of these actions change inventory or replacement deadlines. */}
									{/* </NativeText> */}
								</>
							) : (
								<NativeText tone="secondary">
									Choose today or an earlier day in the calendar to see its
									status and edit it.
								</NativeText>
							)}
							{/* {state.busy && ( */}
							{/*   <NativeText> */}
							{/*     Saving change… Please stay on this screen. */}
							{/*   </NativeText> */}
							{/* )} */}
							{/* {!!notice && <NativeText>{notice}</NativeText>} */}
						</NativeRow>
					</NativeSection>
				</>
			)}

			<NativeSection title="Automatic logging">
				<NativeRow>
					<NativeText tone="secondary">
						Optionally mark completed weekdays as assumed worn. This is off
						until you enable it and save.
					</NativeText>
					<WearAction
						label="Automatic logging settings"
						blocked={blocked}
						onPress={() => {
							if (currentMonth() && !lock.current)
								router.push("/wear-automation" as Href);
						}}
					/>
				</NativeRow>
			</NativeSection>
		</NativePage>
	);
}
