import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { doseTracking, medications } from "../db/schema.js";
import { buildSharedMedicationOverview } from "../services/coverage.js";

type MedicationRow = typeof medications.$inferSelect;
type DoseRow = typeof doseTracking.$inferSelect;

const fixedNow = new Date("2026-03-10T12:00:00.000Z");

function medication(overrides: Partial<MedicationRow> = {}): MedicationRow {
	return {
		id: 1,
		userId: 1,
		name: "Coverage medication",
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
			{
				usage: 1,
				every: 1,
				start: "2026-03-01T08:00:00.000Z",
				takenBy: null,
				intakeRemindersEnabled: false,
			},
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
		updatedAt: fixedNow,
		...overrides,
	};
}

function dose(overrides: Partial<DoseRow> = {}): DoseRow {
	return {
		id: 1,
		userId: 1,
		doseId: "1-0-1773139200000",
		takenAt: fixedNow,
		markedBy: null,
		takenSource: "manual",
		dismissed: false,
		...overrides,
	};
}

describe("buildSharedMedicationOverview", () => {
	const originalTimezone = process.env.TZ;

	beforeEach(() => {
		process.env.TZ = "UTC";
		vi.useFakeTimers();
		vi.setSystemTime(fixedNow);
	});

	afterEach(() => {
		vi.useRealTimers();
		if (originalTimezone === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = originalTimezone;
		}
	});

	it("uses blister capacity and stock corrections while counting only eligible doses", () => {
		const overview = buildSharedMedicationOverview({
			medications: [
				medication({
					stockAdjustment: -2,
					lastStockCorrectionAt: new Date("2026-03-10T00:00:00.000Z"),
					expiryDate: "   ",
					medicationStartDate: "  ",
				}),
			],
			doses: [
				dose({ doseId: "1-0-1773014400000" }),
				dose({ id: 2, doseId: "1-0-1773139200000" }),
				dose({ id: 3, doseId: "1-0-1773225600000" }),
				dose({ id: 4, doseId: "1-0-1773225600000", dismissed: true }),
				dose({ id: 5, doseId: "invalid-dose" }),
			],
			thresholdDays: 6,
		});

		expect(overview).toEqual([
			expect.objectContaining({
				capacity: 10,
				currentStock: 6,
				daysLeft: 6,
				nextIntakeDate: "2026-03-10",
				depletionDate: "2026-03-16",
				priority: "high",
				expiryDate: null,
				medicationStartDate: null,
			}),
		]);
	});

	it("uses only the supplied aggregate effect for shared stock without exposing an event or anchor", () => {
		const overview = buildSharedMedicationOverview({
			medications: [medication({ packCount: 0, looseTablets: 2 })],
			doses: [dose({ doseId: "as-needed:opaque-event-anchor" })],
			thresholdDays: 3,
			asNeededStockEffectsMilli: new Map([[1, 1500]]),
		});
		expect(overview).toEqual([expect.objectContaining({ currentStock: 0, daysLeft: 0 })]);
		expect(overview[0]).not.toHaveProperty("eventId");
	});

	it("scopes dose deductions to the shared recipient without compacting dose indexes", () => {
		const overview = buildSharedMedicationOverview({
			medications: [
				medication({
					takenByJson: JSON.stringify(["Ava", "Ben"]),
					intakesJson: JSON.stringify([
						{
							usage: 2,
							every: 1,
							start: "2026-03-01T08:00:00.000Z",
							takenBy: "Ben",
							intakeRemindersEnabled: false,
						},
						{
							usage: 1,
							every: 1,
							start: "2026-03-01T08:00:00.000Z",
							takenBy: "Ava",
							intakeRemindersEnabled: false,
						},
						{
							usage: 1,
							every: 1,
							start: "2026-03-01T08:00:00.000Z",
							takenBy: null,
							intakeRemindersEnabled: false,
						},
					]),
				}),
			],
			doses: [dose({ doseId: "1-0-1773139200000" }), dose({ id: 2, doseId: "1-1-1773139200000" })],
			thresholdDays: 3,
			shareTakenBy: "Ava",
		});

		expect(overview[0]).toMatchObject({
			currentStock: 9,
			daysLeft: 4,
			nextIntakeDate: "2026-03-10",
			priority: "normal",
		});
	});

	it("uses amount-based capacity and reports each stock priority", () => {
		const overview = buildSharedMedicationOverview({
			medications: [
				medication({ id: 1, name: "Normal", packageType: "bottle", totalPills: 20, looseTablets: 3 }),
				medication({ id: 2, name: "High", packCount: 1, blistersPerPack: 1, pillsPerBlister: 5 }),
				medication({ id: 3, name: "Empty", packCount: 0, blistersPerPack: 1, pillsPerBlister: 5 }),
			],
			doses: [],
			thresholdDays: 5,
		});

		expect(
			overview.map(({ name, capacity, currentStock, priority }) => ({ name, capacity, currentStock, priority }))
		).toEqual([
			{ name: "Normal", capacity: 20, currentStock: 20, priority: "normal" },
			{ name: "High", capacity: 5, currentStock: 5, priority: "high" },
			{ name: "Empty", capacity: 0, currentStock: 0, priority: "out-of-stock" },
		]);
	});
});
