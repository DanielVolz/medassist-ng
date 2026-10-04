import { useMemo } from "react";
import type { useDoses } from "../hooks/useDoses";
import type { Settings } from "../hooks/useSettings";
import { getMedDisplayName, type Medication, type StockThresholds } from "../types";
import { mergePersonTags } from "../utils/person-tags";
import { buildSchedulePreview, calculateCoverage, computeMissedPastDoseIds } from "../utils/schedule";

type DoseInfo = {
	id: string;
	timeStr: string;
	when: number;
	usage: number;
	intakeUnit?: "ml" | "tsp" | "tbsp" | null;
	takenBy: string[];
	intakeRemindersEnabled: boolean;
};

export type DayMedEntry = {
	medName: string;
	total: number;
	doses: DoseInfo[];
	lastWhen: number;
};

type AppScheduleOptions = {
	meds: Medication[];
	systemLocale: string;
	settings: Settings;
	doses: Pick<ReturnType<typeof useDoses>, "takenDoses" | "takenDoseTimestamps" | "dismissedDoses">;
	scheduleDays: number;
};

/** Derived schedule/stock data only; loading and UI preferences stay with the caller. */
export function useAppSchedule({ meds, systemLocale, settings, doses, scheduleDays }: AppScheduleOptions) {
	const activeMeds = useMemo(() => meds.filter((med) => !med.isObsolete), [meds]);
	const schedule = useMemo(() => buildSchedulePreview(activeMeds, systemLocale, true), [activeMeds, systemLocale]);
	const coverage = useMemo(
		() =>
			calculateCoverage(
				activeMeds,
				schedule.events,
				systemLocale,
				settings.reminderDaysBefore,
				settings.stockCalculationMode,
				doses.takenDoses,
				doses.takenDoseTimestamps
			),
		[
			activeMeds,
			schedule.events,
			systemLocale,
			settings.reminderDaysBefore,
			settings.stockCalculationMode,
			doses.takenDoses,
			doses.takenDoseTimestamps,
		]
	);
	const depletionByMed = useMemo(
		() => Object.fromEntries(coverage.all.map((c) => [c.name, c.depletionTime])),
		[coverage.all]
	);
	const coverageByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c])), [coverage.all]);
	const outOfStockMedicationIds = useMemo(
		() =>
			new Set(
				activeMeds.filter((med) => (coverageByMed[getMedDisplayName(med)]?.medsLeft ?? 1) <= 0).map((med) => med.id)
			),
		[activeMeds, coverageByMed]
	);
	const effectiveTakenDoses = useMemo(
		() =>
			new Set(
				Array.from(doses.takenDoses).filter((doseId) => {
					const medId = Number.parseInt(doseId.split("-")[0] ?? "", 10);
					return Number.isNaN(medId) || !outOfStockMedicationIds.has(medId);
				})
			),
		[doses.takenDoses, outOfStockMedicationIds]
	);
	const stockThresholds: StockThresholds = useMemo(
		() => ({
			lowStockDays: settings.lowStockDays,
			normalStockDays: settings.normalStockDays,
			highStockDays: settings.highStockDays,
			criticalStockDays: settings.reminderDaysBefore,
			expiryWarningDays: settings.expiryWarningDays,
		}),
		[
			settings.lowStockDays,
			settings.normalStockDays,
			settings.highStockDays,
			settings.reminderDaysBefore,
			settings.expiryWarningDays,
		]
	);
	const existingPeople = useMemo(() => mergePersonTags(meds.flatMap((med) => med.takenBy || [])), [meds]);
	const groupedSchedule = useMemo(() => {
		const days = new Map<string, { dateStr: string; date: Date; isPast: boolean; meds: Map<string, DayMedEntry> }>();
		// Bound old events so they cannot consume the today/future display budget.
		const pastCutoff = new Date();
		pastCutoff.setDate(pastCutoff.getDate() - scheduleDays);
		pastCutoff.setHours(0, 0, 0, 0);
		const pastCutoffMs = pastCutoff.getTime();
		schedule.events
			.filter((e) => !e.isPast || e.when >= pastCutoffMs)
			.forEach((event) => {
				const day = days.get(event.dateStr) ?? {
					dateStr: event.dateStr,
					date: new Date(event.when),
					isPast: event.isPast,
					meds: new Map(),
				};
				const medEntry = day.meds.get(event.medName) ?? {
					medName: event.medName,
					total: 0,
					doses: [],
					lastWhen: event.when,
				};
				medEntry.total += event.usage;
				medEntry.doses.push({
					id: event.id,
					timeStr: event.timeStr,
					when: event.when,
					usage: event.usage,
					intakeUnit: event.intakeUnit ?? null,
					takenBy: event.takenBy ? [event.takenBy] : [],
					intakeRemindersEnabled: event.intakeRemindersEnabled,
				});
				medEntry.lastWhen = Math.max(medEntry.lastWhen, event.when);
				day.meds.set(event.medName, medEntry);
				days.set(event.dateStr, day);
			});
		return Array.from(days.values()).map((d) => ({
			dateStr: d.dateStr,
			date: d.date,
			isPast: d.isPast,
			meds: Array.from(d.meds.values()),
		}));
	}, [schedule.events, scheduleDays]);
	const pastDays = useMemo(() => groupedSchedule.filter((d) => d.isPast), [groupedSchedule]);
	const todayDay = useMemo(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return (
			groupedSchedule.find((d) => {
				const dayDate = new Date(d.date);
				dayDate.setHours(0, 0, 0, 0);
				return dayDate.getTime() === today.getTime();
			}) || null
		);
	}, [groupedSchedule]);
	const futureDays = useMemo(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return groupedSchedule
			.filter((d) => {
				if (d.isPast) return false;
				const dayDate = new Date(d.date);
				dayDate.setHours(0, 0, 0, 0);
				return dayDate.getTime() > today.getTime();
			})
			.slice(0, scheduleDays);
	}, [groupedSchedule, scheduleDays]);
	const missedPastDoseIds = useMemo(
		() => computeMissedPastDoseIds(pastDays, activeMeds, effectiveTakenDoses, doses.dismissedDoses),
		[pastDays, activeMeds, effectiveTakenDoses, doses.dismissedDoses]
	);
	return {
		activeMeds,
		schedule,
		coverage,
		depletionByMed,
		coverageByMed,
		stockThresholds,
		existingPeople,
		groupedSchedule,
		pastDays,
		todayDay,
		futureDays,
		missedPastDoseIds,
	};
}
