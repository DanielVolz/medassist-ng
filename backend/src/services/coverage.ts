import type { doseTracking, medications } from "../db/schema.js";
import { parseDoseId } from "../utils/dose-id.js";
import { isAmountBasedPackageType } from "../utils/package-profiles.js";
import {
	getAverageOccurrencesPerDay,
	getNextScheduledOccurrenceTime,
	getTodayInTimezone,
	type Intake,
	normalizeIntakeUsageForStock,
	normalizeMedicationSchedule,
	scopeIntakesToTakenBy,
} from "../utils/scheduler-utils.js";

type MedicationRow = typeof medications.$inferSelect;
type DoseRow = typeof doseTracking.$inferSelect;

export type SharedMedicationOverviewItem = {
	name: string;
	genericName: string | null;
	imageUrl: string | null;
	packageType: string;
	packCount: number;
	packageAmountValue: number | null;
	packageAmountUnit: "ml" | "g" | null;
	blistersPerPack: number;
	pillsPerBlister: number;
	totalPills: number | null;
	looseTablets: number;
	currentStock: number | null;
	capacity: number | null;
	daysLeft: number | null;
	nextIntakeDate: string | null;
	depletionDate: string | null;
	priority: "normal" | "high" | "out-of-stock" | null;
	expiryDate: string | null;
	medicationStartDate: string | null;
	prescriptionEnabled: boolean;
	prescriptionRemainingRefills: number | null;
};

function toDateOnlyString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseDateOnly(dateOnly: string): Date {
	const [year, month, day] = dateOnly.split("-").map((value) => Number.parseInt(value, 10));
	return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function computeCapacity(medication: MedicationRow): number {
	if (isAmountBasedPackageType(medication.packageType)) {
		return medication.totalPills ?? medication.looseTablets;
	}

	return medication.packCount * medication.blistersPerPack * medication.pillsPerBlister;
}

function computeDailyDoseRate(intakes: Intake[], medication: MedicationRow): number {
	return intakes.reduce((sum, intake) => {
		const normalizedUsage = normalizeIntakeUsageForStock(intake, medication.medicationForm, medication.packageType);
		return sum + normalizedUsage * getAverageOccurrencesPerDay(intake);
	}, 0);
}

function computeNextIntakeDate(intakes: Intake[], todayDateOnly: string): string | null {
	const today = parseDateOnly(todayDateOnly);
	let nextOccurrenceMs: number | null = null;

	for (const intake of intakes) {
		const occurrenceMs = getNextScheduledOccurrenceTime(intake, today.getTime(), true);
		if (occurrenceMs === null) {
			continue;
		}

		if (nextOccurrenceMs === null || occurrenceMs < nextOccurrenceMs) {
			nextOccurrenceMs = occurrenceMs;
		}
	}

	return nextOccurrenceMs === null ? null : toDateOnlyString(new Date(nextOccurrenceMs));
}

function computeTakenAmount(
	medication: MedicationRow,
	allIntakes: Intake[],
	applicableIntakes: Intake[],
	dosesByMedication: Map<number, DoseRow[]>
): number {
	const doseRows = dosesByMedication.get(medication.id) ?? [];
	if (doseRows.length === 0) return 0;

	const correctionDateOnlyMs = medication.lastStockCorrectionAt
		? new Date(
				medication.lastStockCorrectionAt.getFullYear(),
				medication.lastStockCorrectionAt.getMonth(),
				medication.lastStockCorrectionAt.getDate(),
				0,
				0,
				0,
				0
			).getTime()
		: 0;

	let takenAmount = 0;
	for (const dose of doseRows) {
		if (dose.dismissed) continue;

		const parsedDose = parseDoseId(dose.doseId);
		if (!parsedDose) continue;
		if (parsedDose.timestampMs < correctionDateOnlyMs) continue;

		const intake = allIntakes[parsedDose.intakeIndex];
		if (!intake || !applicableIntakes.includes(intake)) continue;

		takenAmount += normalizeIntakeUsageForStock(intake, medication.medicationForm, medication.packageType);
	}

	return takenAmount;
}

function toNullableDate(value: string | null): string | null {
	if (!value) return null;
	return value.trim() ? value : null;
}

function computeOverviewPriority(
	currentStock: number,
	daysLeft: number | null,
	thresholdDays: number
): "normal" | "high" | "out-of-stock" {
	if (currentStock <= 0 || daysLeft === 0) return "out-of-stock";
	if (daysLeft !== null && daysLeft <= thresholdDays) return "high";
	return "normal";
}

export function buildSharedMedicationOverview(options: {
	medications: MedicationRow[];
	doses: DoseRow[];
	thresholdDays: number;
	shareTakenBy?: string;
	asNeededStockEffectsMilli?: Map<number, number>;
}): SharedMedicationOverviewItem[] {
	const { medications: medicationRows, doses, thresholdDays, shareTakenBy, asNeededStockEffectsMilli } = options;

	const dosesByMedication = new Map<number, DoseRow[]>();
	for (const dose of doses) {
		const parsedDose = parseDoseId(dose.doseId);
		if (!parsedDose) continue;

		const existing = dosesByMedication.get(parsedDose.medicationId) ?? [];
		existing.push(dose);
		dosesByMedication.set(parsedDose.medicationId, existing);
	}

	const todayDateOnly = getTodayInTimezone();
	const todayDate = parseDateOnly(todayDateOnly);

	return medicationRows.map((medication) => {
		const schedule = normalizeMedicationSchedule(medication);
		const intakes =
			shareTakenBy == null ? schedule.intakes : scopeIntakesToTakenBy(schedule.intakes, schedule.takenBy, shareTakenBy);

		const capacity = computeCapacity(medication);
		const dailyDoseRate = computeDailyDoseRate(intakes, medication);
		const takenAmount = computeTakenAmount(medication, schedule.intakes, intakes, dosesByMedication);
		const rawCurrentStock =
			capacity +
			(medication.stockAdjustment ?? 0) -
			takenAmount -
			(asNeededStockEffectsMilli?.get(medication.id) ?? 0) / 1000;
		const currentStock = Math.max(0, Math.floor(rawCurrentStock));
		const daysLeft = dailyDoseRate > 0 ? Math.floor(currentStock / dailyDoseRate) : null;
		const depletionDate =
			daysLeft === null ? null : toDateOnlyString(new Date(todayDate.getTime() + daysLeft * 86_400_000));
		const priority = computeOverviewPriority(currentStock, daysLeft, thresholdDays);
		return {
			name: medication.name,
			genericName: medication.genericName,
			imageUrl: medication.imageUrl,
			packageType: medication.packageType,
			packCount: medication.packCount,
			packageAmountValue: medication.packageAmountValue,
			packageAmountUnit:
				medication.packageAmountUnit === "g" || medication.packageAmountUnit === "ml"
					? medication.packageAmountUnit
					: null,
			blistersPerPack: medication.blistersPerPack,
			pillsPerBlister: medication.pillsPerBlister,
			totalPills: medication.totalPills,
			looseTablets: medication.looseTablets,
			currentStock,
			capacity,
			daysLeft,
			nextIntakeDate: computeNextIntakeDate(intakes, todayDateOnly),
			depletionDate,
			priority,
			expiryDate: toNullableDate(medication.expiryDate),
			medicationStartDate: toNullableDate(medication.medicationStartDate),
			prescriptionEnabled: medication.prescriptionEnabled ?? false,
			prescriptionRemainingRefills: medication.prescriptionRemainingRefills,
		};
	});
}
