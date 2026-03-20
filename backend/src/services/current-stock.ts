import type { doseTracking, medications } from "../db/schema.js";
import { isAmountBasedPackageType } from "../utils/package-profiles.js";
import {
	countScheduledOccurrencesInRange,
	getDateOnlyTimestamp,
	getNextScheduledOccurrenceTime,
	normalizeIntakeUsageForStock,
	parseIntakesJson,
	parseLocalDateTime,
	parseTakenByJson,
} from "../utils/scheduler-utils.js";

type MedicationRow = typeof medications.$inferSelect;
type DoseRow = typeof doseTracking.$inferSelect;

const doseIdPattern = /^(\d+)-(\d+)-(\d+)(?:-(.+))?$/;

function getDoseTakenAtMs(dose: DoseRow): number {
	const rawTakenAt = Number(dose.takenAt);
	if (Number.isFinite(rawTakenAt)) {
		return rawTakenAt < 1_000_000_000_000 ? rawTakenAt * 1000 : rawTakenAt;
	}

	return new Date(dose.takenAt).getTime();
}

export function computeMedicationCurrentStock(options: {
	medication: MedicationRow;
	doses: DoseRow[];
	stockCalculationMode: "automatic" | "manual";
	nowMs?: number;
}): number {
	const { medication, doses, stockCalculationMode, nowMs = Date.now() } = options;

	const intakes = parseIntakesJson(
		medication.intakesJson,
		{
			usageJson: medication.usageJson,
			everyJson: medication.everyJson,
			startJson: medication.startJson,
		},
		medication.intakeRemindersEnabled ?? false
	);

	const baseStock = isAmountBasedPackageType(medication.packageType)
		? medication.looseTablets + (medication.stockAdjustment ?? 0)
		: medication.packCount * medication.blistersPerPack * medication.pillsPerBlister +
			medication.looseTablets +
			(medication.stockAdjustment ?? 0);

	const relevantDoses = doses.filter((dose) => !dose.dismissed);
	const stockCorrectionCutoff = medication.lastStockCorrectionAt
		? new Date(medication.lastStockCorrectionAt).getTime()
		: 0;
	let consumed = 0;

	if (stockCalculationMode === "automatic") {
		const medicationTakenBy = parseTakenByJson(medication.takenByJson);

		intakes.forEach((intake, intakeIndex) => {
			const usage = normalizeIntakeUsageForStock(intake, medication.medicationForm, medication.packageType);
			const intakeStart = parseLocalDateTime(intake.start).getTime();
			if (Number.isNaN(intakeStart)) return;

			const effectiveStart =
				stockCorrectionCutoff > 0 && stockCorrectionCutoff >= intakeStart
					? getNextScheduledOccurrenceTime(intake, stockCorrectionCutoff, false)
					: intakeStart;
			if (effectiveStart === null) return;

			let peopleForThisIntake: Array<string | null>;
			if (intake.takenBy) {
				peopleForThisIntake = [intake.takenBy];
			} else if (medicationTakenBy.length > 0) {
				peopleForThisIntake = medicationTakenBy;
			} else {
				peopleForThisIntake = [null];
			}

			let lastAutoConsumedDateMs = 0;
			if (effectiveStart <= nowMs) {
				const { count: occurrences, lastOccurrenceMs } = countScheduledOccurrencesInRange(
					intake,
					effectiveStart,
					nowMs
				);
				consumed += occurrences * usage * peopleForThisIntake.length;

				if (lastOccurrenceMs !== null) {
					lastAutoConsumedDateMs = getDateOnlyTimestamp(new Date(lastOccurrenceMs));
				}
			}

			const stockCorrectionDateOnly =
				stockCorrectionCutoff > 0 ? getDateOnlyTimestamp(new Date(stockCorrectionCutoff)) : 0;
			const earlyCutoff = Math.max(lastAutoConsumedDateMs, stockCorrectionDateOnly);

			for (const dose of relevantDoses) {
				const match = doseIdPattern.exec(dose.doseId);
				if (!match) continue;

				const parsedIntakeIndex = Number.parseInt(match[2], 10);
				const doseDateOnlyMs = Number.parseInt(match[3], 10);
				if (Number.isNaN(parsedIntakeIndex) || Number.isNaN(doseDateOnlyMs) || parsedIntakeIndex !== intakeIndex) {
					continue;
				}

				if (doseDateOnlyMs > earlyCutoff) {
					consumed += usage;
				}
			}
		});
	} else {
		intakes.forEach((intake, intakeIndex) => {
			const usage = normalizeIntakeUsageForStock(intake, medication.medicationForm, medication.packageType);
			const intakeStart = parseLocalDateTime(intake.start);
			const intakeStartDateOnly = new Date(
				intakeStart.getFullYear(),
				intakeStart.getMonth(),
				intakeStart.getDate()
			).getTime();
			if (Number.isNaN(intakeStartDateOnly)) return;

			for (const dose of relevantDoses) {
				const match = doseIdPattern.exec(dose.doseId);
				if (!match) continue;

				const parsedIntakeIndex = Number.parseInt(match[2], 10);
				const doseDateOnlyMs = Number.parseInt(match[3], 10);
				if (Number.isNaN(parsedIntakeIndex) || Number.isNaN(doseDateOnlyMs) || parsedIntakeIndex !== intakeIndex) {
					continue;
				}

				const takenAtMs = getDoseTakenAtMs(dose);
				const afterCorrectionOrNoCorrection = stockCorrectionCutoff === 0 || takenAtMs > stockCorrectionCutoff;
				if (doseDateOnlyMs >= intakeStartDateOnly && afterCorrectionOrNoCorrection) {
					consumed += usage;
				}
			}
		});
	}

	return Math.max(0, Math.floor(baseStock - consumed));
}
