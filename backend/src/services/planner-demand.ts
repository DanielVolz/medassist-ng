import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { doseTracking, medications, userSettings } from "../db/schema.js";
import { isAmountBasedPackageType, isTubePackageType, normalizePackageType } from "../utils/package-profiles.js";
import { normalizeIntakeUsageForStock, parseTakenByJson } from "../utils/scheduler-utils.js";
import { computeMedicationCurrentStock } from "./current-stock.js";
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

		const currentStock = isTopical
			? originalTotalPills
			: computeMedicationCurrentStock({
					medication: row,
					doses: takenDoses,
					stockCalculationMode,
					nowMs: now.getTime(),
				});
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
