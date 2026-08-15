import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { doseTracking, medications } from "../db/schema.js";
import { computeMedicationCurrentStock, computeMedicationCurrentStockRaw } from "../services/current-stock.js";
import { buildDoseId } from "../utils/dose-id.js";

type MedicationRow = typeof medications.$inferSelect;
type DoseRow = typeof doseTracking.$inferSelect;

function medication(overrides: Partial<MedicationRow> = {}): MedicationRow {
	return {
		id: 7,
		userId: 1,
		name: "Current stock medication",
		genericName: null,
		takenByJson: "[]",
		packageType: "blister",
		medicationForm: "tablet",
		pillForm: null,
		lifecycleCategory: "refill_when_empty",
		packageAmountValue: 0,
		packageAmountUnit: "ml",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		totalPills: null,
		looseTablets: 0,
		stockAdjustment: 0,
		scheduleStockRebaseMilli: 0,
		lastStockCorrectionAt: null,
		pillWeightMg: null,
		doseUnit: "mg",
		usageJson: "[]",
		everyJson: "[]",
		startJson: "[]",
		intakesJson: JSON.stringify([
			{ usage: 1, every: 1, start: "2026-03-10T08:00:00", takenBy: null, intakeRemindersEnabled: false },
		]),
		imageUrl: null,
		expiryDate: null,
		notes: null,
		intakeRemindersEnabled: false,
		medicationStartDate: "",
		medicationEndDate: null,
		autoMarkObsoleteAfterEndDate: true,
		isObsolete: false,
		obsoleteAt: null,
		prescriptionEnabled: false,
		prescriptionAuthorizedRefills: null,
		prescriptionRemainingRefills: null,
		prescriptionLowRefillThreshold: 1,
		prescriptionExpiryDate: null,
		dismissedUntil: null,
		updatedAt: new Date("2026-03-10T00:00:00.000Z"),
		...overrides,
	};
}

function dose(overrides: Partial<DoseRow> = {}): DoseRow {
	return {
		id: 1,
		userId: 1,
		doseId: buildDoseId(7, 0, new Date("2026-03-10T00:00:00.000Z").getTime()),
		takenAt: new Date("2026-03-10T08:05:00.000Z"),
		markedBy: null,
		takenSource: "manual",
		dismissed: false,
		...overrides,
	};
}

describe("computeMedicationCurrentStock", () => {
	const originalTimezone = process.env.TZ;

	beforeEach(() => {
		process.env.TZ = "UTC";
	});

	afterEach(() => {
		if (originalTimezone === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = originalTimezone;
		}
	});

	it("uses package-specific capacity, applies corrections, and never returns negative stock", () => {
		expect(
			computeMedicationCurrentStock({
				medication: medication({
					packCount: 2,
					blistersPerPack: 3,
					pillsPerBlister: 4,
					looseTablets: 3,
					stockAdjustment: -2,
				}),
				doses: [],
				stockCalculationMode: "manual",
			})
		).toBe(25);

		expect(
			computeMedicationCurrentStock({
				medication: medication({ packageType: "bottle", looseTablets: 7, stockAdjustment: -3 }),
				doses: [],
				stockCalculationMode: "manual",
			})
		).toBe(4);

		expect(
			computeMedicationCurrentStock({
				medication: medication({ packCount: 0, looseTablets: 1, stockAdjustment: -4 }),
				doses: [],
				stockCalculationMode: "manual",
			})
		).toBe(0);
	});

	it("deducts automatic occurrences per medication recipient after a stock correction boundary", () => {
		const currentStock = computeMedicationCurrentStock({
			medication: medication({
				takenByJson: JSON.stringify(["Ava", "Ben"]),
				lastStockCorrectionAt: new Date("2026-03-11T12:00:00.000Z"),
			}),
			doses: [],
			stockCalculationMode: "automatic",
			nowMs: new Date("2026-03-13T09:00:00.000Z").getTime(),
		});

		expect(currentStock).toBe(6);
	});

	it("counts manual doses only for their intake, on or after its start date, and after corrections", () => {
		const march11 = new Date("2026-03-11T00:00:00.000Z").getTime();
		const march12 = new Date("2026-03-12T00:00:00.000Z").getTime();
		const correctionAt = new Date("2026-03-12T10:00:00.000Z");
		const currentStock = computeMedicationCurrentStock({
			medication: medication({
				packCount: 0,
				looseTablets: 5,
				lastStockCorrectionAt: correctionAt,
				intakesJson: JSON.stringify([
					{ usage: 1, every: 1, start: "2026-03-12T08:00:00", takenBy: null, intakeRemindersEnabled: false },
				]),
			}),
			doses: [
				dose({ doseId: buildDoseId(7, 0, march11), takenAt: new Date("2026-03-12T11:00:00.000Z") }),
				dose({ id: 2, doseId: buildDoseId(7, 0, march12), takenAt: correctionAt }),
				dose({ id: 3, doseId: buildDoseId(7, 0, march12), takenAt: new Date("2026-03-12T11:00:00.000Z") }),
				dose({ id: 4, doseId: buildDoseId(7, 1, march12), takenAt: new Date("2026-03-12T11:00:00.000Z") }),
				dose({ id: 5, doseId: buildDoseId(7, 0, march12), dismissed: true }),
			],
			stockCalculationMode: "manual",
		});

		expect(currentStock).toBe(4);
	});

	it("falls back to legacy schedules and ignores malformed schedule or dose data", () => {
		const nowMs = new Date("2026-03-10T09:00:00.000Z").getTime();
		const legacyStock = computeMedicationCurrentStock({
			medication: medication({
				packCount: 0,
				looseTablets: 5,
				intakesJson: "not-json",
				usageJson: "[2]",
				everyJson: "[1]",
				startJson: '["2026-03-10T08:00:00"]',
			}),
			doses: [dose({ doseId: "invalid-dose" })],
			stockCalculationMode: "automatic",
			nowMs,
		});
		const malformedScheduleStock = computeMedicationCurrentStock({
			medication: medication({
				packCount: 0,
				looseTablets: 5,
				intakesJson: JSON.stringify([{ usage: 2, every: 1, start: "invalid" }]),
			}),
			doses: [dose({ doseId: "invalid-dose" })],
			stockCalculationMode: "automatic",
			nowMs,
		});

		expect(legacyStock).toBe(3);
		expect(malformedScheduleStock).toBe(5);
	});

	it.each(["automatic", "manual"] as const)(
		"applies exact schedule rebases before rounding in %s mode",
		(stockCalculationMode) => {
			const rebasedMedication = medication({
				packCount: 0,
				looseTablets: 10,
				scheduleStockRebaseMilli: -1500,
				intakesJson: "[]",
				usageJson: "[]",
				everyJson: "[]",
				startJson: "[]",
			});
			const options = { medication: rebasedMedication, doses: [], stockCalculationMode };

			expect(computeMedicationCurrentStockRaw(options)).toBe(8.5);
			expect(computeMedicationCurrentStock(options)).toBe(8);
		}
	);

	it.each(["automatic", "manual"] as const)(
		"subtracts exact active as-needed milli effects and retains scheduled-dose identity in %s mode",
		(stockCalculationMode) => {
			const scheduledDose = dose({ doseId: buildDoseId(7, 0, new Date("2026-03-10T00:00:00.000Z").getTime()) });
			const anchor = dose({ id: 2, doseId: "as-needed:2dfe2cca-1b2e-4a2c-9c31-d5aa9f5b0dce" });
			const options = {
				medication: medication({ packCount: 0, looseTablets: 3 }),
				doses: [scheduledDose, anchor],
				stockCalculationMode,
				asNeededStockEffectMilli: 1500,
				nowMs: new Date("2026-03-10T12:00:00.000Z").getTime(),
			};
			expect(computeMedicationCurrentStockRaw(options)).toBe(0.5);
			expect(computeMedicationCurrentStock(options)).toBe(0);
			expect(computeMedicationCurrentStockRaw({ ...options, asNeededStockEffectMilli: 9_000 })).toBe(0);
		}
	);
});
