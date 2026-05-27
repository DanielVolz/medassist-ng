import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { doseTracking, medications, userSettings } from "../db/schema.js";
import { isAmountBasedPackageType, isTubePackageType, normalizePackageType } from "../utils/package-profiles.js";
import {
	countScheduledOccurrencesInRange,
	getDateOnlyTimestamp,
	getNextScheduledOccurrenceTime,
	normalizeIntakeUsageForStock,
	parseLocalDateTime,
	parseTakenByJson,
} from "../utils/scheduler-utils.js";
import { calculateUsageInRange, parseIntakesWithUnits } from "./medications-service.js";

export type PlannerDemandRow = {
	medicationId: number;
	medicationName: string;
	totalPills: number;
	currentPills: number;
	plannerUsage: number;
	blisterSize: number;
	blistersNeeded: number;
	fullBlisters: number;
	loosePills: number;
	enough: boolean;
	packageType: string;
};

type PlannerDemandOptions = {
	userId: number;
	startDate: Date;
	endDate: Date;
	includeUntilStart?: boolean;
	medicationIds?: number[];
	now?: Date;
};

export async function calculatePlannerDemandRows(options: PlannerDemandOptions): Promise<PlannerDemandRow[]> {
	const { userId, startDate, endDate, includeUntilStart = false, medicationIds, now = new Date() } = options;
	const uniqueMedicationIds = medicationIds ? [...new Set(medicationIds.filter((id) => Number.isInteger(id)))] : [];
	const medicationFilter =
		uniqueMedicationIds.length > 0
			? and(
					eq(medications.userId, userId),
					eq(medications.isObsolete, false),
					inArray(medications.id, uniqueMedicationIds)
				)
			: and(eq(medications.userId, userId), eq(medications.isObsolete, false));

	const rows = await db.select().from(medications).where(medicationFilter).orderBy(medications.id);

	const [settingsRow] = await db
		.select({ stockCalculationMode: userSettings.stockCalculationMode })
		.from(userSettings)
		.where(eq(userSettings.userId, userId));
	const stockCalculationMode = settingsRow?.stockCalculationMode === "manual" ? "manual" : "automatic";

	const takenDoses = await db
		.select()
		.from(doseTracking)
		.where(and(eq(doseTracking.userId, userId), eq(doseTracking.dismissed, false)));

	const takenDoseIdsByMed = new Map<number, Set<string>>();
	const takenDoseTimestamps = new Map<string, number>();
	takenDoses.forEach((dose) => {
		const parts = dose.doseId.split("-");
		if (parts.length < 3) return;
		const medId = parseInt(parts[0], 10);
		if (Number.isNaN(medId)) return;

		if (!takenDoseIdsByMed.has(medId)) {
			takenDoseIdsByMed.set(medId, new Set());
		}
		takenDoseIdsByMed.get(medId)!.add(dose.doseId);
		const rawTakenAt = Number(dose.takenAt);
		let takenAtMs: number;
		if (Number.isFinite(rawTakenAt)) {
			takenAtMs = rawTakenAt < 1_000_000_000_000 ? rawTakenAt * 1000 : rawTakenAt;
		} else {
			takenAtMs = new Date(dose.takenAt).getTime();
		}
		takenDoseTimestamps.set(dose.doseId, takenAtMs);
	});

	return rows.map((row) => {
		const intakes = parseIntakesWithUnits(
			row.intakesJson,
			{ usageJson: row.usageJson, everyJson: row.everyJson, startJson: row.startJson },
			row.intakeRemindersEnabled ?? false
		);
		const medForm = row.medicationForm ?? "tablet";
		const medicationTakenBy = parseTakenByJson(row.takenByJson);
		const blisters = intakes.map((intake) => ({
			usage: normalizeIntakeUsageForStock(intake, medForm, row.packageType),
			every: intake.every,
			start: intake.start,
			scheduleMode: intake.scheduleMode,
			weekdays: intake.weekdays,
		}));
		const plannerSchedules = blisters.map((blister, index) => {
			const intake = intakes[index];
			const peopleMultiplier = intake?.takenBy ? 1 : Math.max(1, medicationTakenBy.length || 1);
			return { ...blister, peopleMultiplier };
		});

		const pillsPerBlister = row.pillsPerBlister ?? 1;
		const packCount = row.packCount ?? 1;
		const blistersPerPack = row.blistersPerPack ?? 1;
		const looseTablets = row.looseTablets ?? 0;
		const stockAdjustment = row.stockAdjustment ?? 0;
		const packageType = normalizePackageType(row.packageType);
		const isTopical = medForm === "topical" || isTubePackageType(packageType);
		const originalTotalPills = isAmountBasedPackageType(packageType)
			? looseTablets + stockAdjustment
			: packCount * blistersPerPack * pillsPerBlister + looseTablets + stockAdjustment;

		const stockCorrectionCutoff = row.lastStockCorrectionAt ? new Date(row.lastStockCorrectionAt).getTime() : 0;
		const takenDoseIds = takenDoseIdsByMed.get(row.id) ?? new Set<string>();

		let consumedUntilNow = 0;
		if (isTopical) {
			consumedUntilNow = 0;
		} else if (stockCalculationMode === "automatic") {
			blisters.forEach((blister, blisterIdx) => {
				const blisterStart = parseLocalDateTime(blister.start).getTime();
				if (Number.isNaN(blisterStart)) return;

				const effectiveStart =
					stockCorrectionCutoff > 0 && stockCorrectionCutoff >= blisterStart
						? getNextScheduledOccurrenceTime(blister, stockCorrectionCutoff, false)
						: blisterStart;
				if (effectiveStart === null) return;

				const intake = intakes[blisterIdx];
				let peopleForThisIntake: Array<string | null>;
				if (intake?.takenBy) {
					peopleForThisIntake = [intake.takenBy];
				} else if (medicationTakenBy.length > 0) {
					peopleForThisIntake = medicationTakenBy;
				} else {
					peopleForThisIntake = [null];
				}

				let timeBasedConsumed = 0;
				let lastAutoConsumedDateMs = 0;

				if (effectiveStart <= now.getTime()) {
					const { count: occurrences, lastOccurrenceMs } = countScheduledOccurrencesInRange(
						blister,
						effectiveStart,
						now.getTime()
					);
					timeBasedConsumed = occurrences * blister.usage * peopleForThisIntake.length;

					if (lastOccurrenceMs !== null) {
						lastAutoConsumedDateMs = getDateOnlyTimestamp(new Date(lastOccurrenceMs));
					}
				}

				const stockCorrectionDateOnly =
					stockCorrectionCutoff > 0 ? getDateOnlyTimestamp(new Date(stockCorrectionCutoff)) : 0;
				const earlyCutoff = Math.max(lastAutoConsumedDateMs, stockCorrectionDateOnly);

				let earlyTakenConsumed = 0;
				for (const doseId of takenDoseIds) {
					const parts = doseId.split("-");
					if (parts.length < 3) continue;
					const bIdx = parseInt(parts[1], 10);
					const timestamp = parseInt(parts[2], 10);
					if (!Number.isNaN(bIdx) && !Number.isNaN(timestamp) && bIdx === blisterIdx && timestamp > earlyCutoff) {
						earlyTakenConsumed += blister.usage;
					}
				}

				consumedUntilNow += timeBasedConsumed + earlyTakenConsumed;
			});
		} else {
			blisters.forEach((blister, blisterIdx) => {
				const blisterStart = parseLocalDateTime(blister.start);
				const blisterStartDateOnly = new Date(
					blisterStart.getFullYear(),
					blisterStart.getMonth(),
					blisterStart.getDate()
				).getTime();
				if (Number.isNaN(blisterStartDateOnly)) return;

				for (const doseId of takenDoseIds) {
					const parts = doseId.split("-");
					if (parts.length < 3) continue;

					const parsedBlisterIdx = parseInt(parts[1], 10);
					const doseTimestamp = parseInt(parts[2], 10);
					if (Number.isNaN(parsedBlisterIdx) || Number.isNaN(doseTimestamp) || parsedBlisterIdx !== blisterIdx) {
						continue;
					}

					const takenAt = takenDoseTimestamps.get(doseId) ?? 0;
					const afterCorrectionOrNoCorrection = stockCorrectionCutoff === 0 || takenAt > stockCorrectionCutoff;

					if (doseTimestamp >= blisterStartDateOnly && afterCorrectionOrNoCorrection) {
						consumedUntilNow += blister.usage;
					}
				}
			});
		}

		const currentStock = isTopical ? originalTotalPills : Math.max(0, originalTotalPills - consumedUntilNow);
		const effectivePlannerStart = includeUntilStart ? now : startDate;
		const usageTotal = isTopical ? 0 : calculateUsageInRange(plannerSchedules, effectivePlannerStart, endDate);
		const blistersNeeded = pillsPerBlister > 0 ? Math.ceil(usageTotal / pillsPerBlister) : 0;
		const availableAfterPeriod = Math.max(0, currentStock - usageTotal);

		let fullBlisters: number;
		let loosePills: number;

		if (isAmountBasedPackageType(packageType)) {
			fullBlisters = 0;
			loosePills = availableAfterPeriod;
		} else {
			const totalConsumedByEnd = originalTotalPills - availableAfterPeriod;
			const looseConsumedByEnd = Math.min(totalConsumedByEnd, looseTablets);
			const loosePillsRemaining = Math.max(0, looseTablets - looseConsumedByEnd);
			const blisterPillsConsumed = totalConsumedByEnd - looseConsumedByEnd;
			const originalBlisterPills = originalTotalPills - looseTablets;
			const blisterPillsRemaining = Math.max(0, originalBlisterPills - blisterPillsConsumed);

			fullBlisters = pillsPerBlister > 0 ? Math.floor(blisterPillsRemaining / pillsPerBlister) : 0;
			const openBlisterPills = pillsPerBlister > 0 ? blisterPillsRemaining % pillsPerBlister : 0;
			loosePills = loosePillsRemaining + openBlisterPills;
		}

		return {
			medicationId: row.id,
			medicationName: row.name,
			totalPills: currentStock,
			currentPills: currentStock,
			plannerUsage: usageTotal,
			blisterSize: pillsPerBlister,
			blistersNeeded,
			fullBlisters,
			loosePills,
			enough: currentStock >= usageTotal,
			packageType,
		};
	});
}
