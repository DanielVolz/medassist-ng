import type { doseTracking, medications } from "../db/schema.js";
import { isAmountBasedPackageType } from "../utils/package-profiles.js";
import {
	getTodayInTimezone,
	type Intake,
	normalizeIntakeUsageForStock,
	parseIntakesJson,
	parseLocalDateTime,
} from "../utils/scheduler-utils.js";

const MS_PER_DAY = 86_400_000;
const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

type MedicationRow = typeof medications.$inferSelect;
type DoseRow = typeof doseTracking.$inferSelect;

export type SharedMedicationOverviewItem = {
	name: string;
	genericName: string | null;
	imageUrl: string | null;
	packageType: string;
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	totalPills: number | null;
	looseTablets: number;
	currentStock: number | null;
	capacity: number | null;
	daysLeft: number | null;
	nextIntakeDate: string | null;
	depletionDate: string | null;
	priority: "normal" | "high" | null;
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
		if (intake.every <= 0) return sum;
		const normalizedUsage = normalizeIntakeUsageForStock(intake, medication.medicationForm, medication.packageType);
		return sum + normalizedUsage / intake.every;
	}, 0);
}

function computeNextIntakeDate(intakes: Intake[], todayDateOnly: string): string | null {
	const today = parseDateOnly(todayDateOnly);
	let nextDate: Date | null = null;

	for (const intake of intakes) {
		if (intake.every <= 0) continue;

		const startDate = parseLocalDateTime(intake.start);
		const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), 0, 0, 0, 0);

		let candidate = startDateOnly;
		if (candidate.getTime() < today.getTime()) {
			const elapsedDays = Math.floor((today.getTime() - candidate.getTime()) / MS_PER_DAY);
			const intervals = Math.ceil(elapsedDays / intake.every);
			candidate = new Date(candidate.getTime() + intervals * intake.every * MS_PER_DAY);
		}

		if (!nextDate || candidate.getTime() < nextDate.getTime()) {
			nextDate = candidate;
		}
	}

	return nextDate ? toDateOnlyString(nextDate) : null;
}

function computeTakenAmount(
	medication: MedicationRow,
	intakes: Intake[],
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

		const match = doseIdPattern.exec(dose.doseId);
		if (!match) continue;

		const intakeIndex = Number.parseInt(match[2], 10);
		const doseDateOnlyMs = Number.parseInt(match[3], 10);
		if (Number.isNaN(intakeIndex) || Number.isNaN(doseDateOnlyMs)) continue;
		if (doseDateOnlyMs < correctionDateOnlyMs) continue;

		const intake = intakes[intakeIndex];
		if (!intake) continue;

		takenAmount += normalizeIntakeUsageForStock(intake, medication.medicationForm, medication.packageType);
	}

	return takenAmount;
}

function toNullableDate(value: string | null): string | null {
	if (!value) return null;
	return value.trim() ? value : null;
}

export function buildSharedMedicationOverview(options: {
	medications: MedicationRow[];
	doses: DoseRow[];
	thresholdDays: number;
	shareStockStatus: boolean;
}): SharedMedicationOverviewItem[] {
	const { medications: medicationRows, doses, thresholdDays, shareStockStatus } = options;

	const dosesByMedication = new Map<number, DoseRow[]>();
	for (const dose of doses) {
		const match = doseIdPattern.exec(dose.doseId);
		if (!match) continue;

		const medicationId = Number.parseInt(match[1], 10);
		if (Number.isNaN(medicationId)) continue;

		const existing = dosesByMedication.get(medicationId) ?? [];
		existing.push(dose);
		dosesByMedication.set(medicationId, existing);
	}

	const todayDateOnly = getTodayInTimezone();
	const todayDate = parseDateOnly(todayDateOnly);

	return medicationRows.map((medication) => {
		const intakes = parseIntakesJson(
			medication.intakesJson,
			{
				usageJson: medication.usageJson,
				everyJson: medication.everyJson,
				startJson: medication.startJson,
			},
			medication.intakeRemindersEnabled ?? false
		);

		const capacity = computeCapacity(medication);
		const dailyDoseRate = computeDailyDoseRate(intakes, medication);
		const takenAmount = computeTakenAmount(medication, intakes, dosesByMedication);
		const rawCurrentStock = capacity + (medication.stockAdjustment ?? 0) - takenAmount;
		const currentStock = Math.max(0, Math.floor(rawCurrentStock));
		const daysLeft = dailyDoseRate > 0 ? Math.floor(currentStock / dailyDoseRate) : null;
		const depletionDate =
			daysLeft === null ? null : toDateOnlyString(new Date(todayDate.getTime() + daysLeft * MS_PER_DAY));
		const priority: "normal" | "high" = daysLeft !== null && daysLeft <= thresholdDays ? "high" : "normal";

		return {
			name: medication.name,
			genericName: medication.genericName,
			imageUrl: medication.imageUrl,
			packageType: medication.packageType,
			packCount: medication.packCount,
			blistersPerPack: medication.blistersPerPack,
			pillsPerBlister: medication.pillsPerBlister,
			totalPills: medication.totalPills,
			looseTablets: medication.looseTablets,
			currentStock: shareStockStatus ? currentStock : null,
			capacity: shareStockStatus ? capacity : null,
			daysLeft: shareStockStatus ? daysLeft : null,
			nextIntakeDate: computeNextIntakeDate(intakes, todayDateOnly),
			depletionDate: shareStockStatus ? depletionDate : null,
			priority: shareStockStatus ? priority : null,
			expiryDate: toNullableDate(medication.expiryDate),
			medicationStartDate: toNullableDate(medication.medicationStartDate),
			prescriptionEnabled: medication.prescriptionEnabled ?? false,
			prescriptionRemainingRefills: medication.prescriptionRemainingRefills,
		};
	});
}
