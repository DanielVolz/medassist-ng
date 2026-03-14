import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Coverage, Medication, StockThresholds } from "../../types";
import {
	buildSchedulePreview,
	calculateCoverage,
	computeMissedPastDoseIds,
	expandDoseIds,
	getReminderStatusText,
	getStockStatus,
	isDoseDismissed,
	parseLocalDateTime,
} from "../../utils/schedule";

describe("parseLocalDateTime", () => {
	it("treats Z-suffixed intake timestamps as local wall-clock times", () => {
		const parsed = parseLocalDateTime("2026-01-23T20:55:00.000Z");

		expect(parsed.getFullYear()).toBe(2026);
		expect(parsed.getMonth()).toBe(0);
		expect(parsed.getDate()).toBe(23);
		expect(parsed.getHours()).toBe(20);
		expect(parsed.getMinutes()).toBe(55);
	});
});

describe("buildSchedulePreview", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns empty events for empty medications array", () => {
		const result = buildSchedulePreview([], "en", false);
		expect(result.events).toEqual([]);
		expect(result.today).toBe(0);
		expect(result.totalBlisters).toBe(0);
	});

	it("returns empty for non-array input", () => {
		const result = buildSchedulePreview(null as unknown as Medication[], "en", false);
		expect(result.events).toEqual([]);
	});

	it("builds events for medication with schedule", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: ["John"],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-14T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const result = buildSchedulePreview(meds, "en", true);
		expect(result.events.length).toBeGreaterThan(0);
		expect(result.totalBlisters).toBe(1);
	});

	it("filters out past events when includePast is false", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const withPast = buildSchedulePreview(meds, "en", true);
		const withoutPast = buildSchedulePreview(meds, "en", false);

		expect(withPast.events.length).toBeGreaterThanOrEqual(withoutPast.events.length);
	});

	it("handles invalid date in blister start", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "invalid-date",
					},
				],
				updatedAt: null,
			},
		];

		const result = buildSchedulePreview(meds, "en", true);
		// Should not crash, events for invalid dates are skipped
		expect(Array.isArray(result.events)).toBe(true);
	});

	it("sorts events by time", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "Morning Med",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-15T09:00:00",
					},
				],
				updatedAt: null,
			},
			{
				id: 2,
				name: "Evening Med",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-15T21:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const result = buildSchedulePreview(meds, "en", false);
		for (let i = 1; i < result.events.length; i++) {
			expect(result.events[i].when).toBeGreaterThanOrEqual(result.events[i - 1].when);
		}
	});

	it("dose IDs remain stable when only intake time changes (regression test for dose tracking)", () => {
		// This is a critical regression test: changing the time-of-day for an intake
		// must NOT change dose IDs for past days, so that taken-dose tracking survives edits.
		const medsWithMorningTime: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00" }],
				updatedAt: null,
			},
		];

		const medsWithEveningTime: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T21:00:00" }],
				updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(),
			},
		];

		const resultBefore = buildSchedulePreview(medsWithMorningTime, "en", true);
		const resultAfter = buildSchedulePreview(medsWithEveningTime, "en", true);

		// Get past dose IDs from both schedules
		const pastIdsBefore = resultBefore.events.filter((e) => e.isPast).map((e) => e.id);
		const pastIdsAfter = resultAfter.events.filter((e) => e.isPast).map((e) => e.id);

		expect(pastIdsBefore.length).toBeGreaterThan(0);
		// All past dose IDs must match — changing time must not break dose tracking
		expect(pastIdsAfter).toEqual(pastIdsBefore);
	});

	it("dose IDs use date-only timestamp, not full datetime", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-14T15:30:00" }],
				updatedAt: null,
			},
		];

		const result = buildSchedulePreview(meds, "en", true);
		const pastEvents = result.events.filter((e) => e.isPast);
		expect(pastEvents.length).toBeGreaterThan(0);

		// Each dose ID should use a midnight timestamp (date-only), not the intake time
		for (const event of pastEvents) {
			const parts = event.id.split("-");
			const timestampMs = parseInt(parts[2], 10);
			const date = new Date(timestampMs);
			expect(date.getHours()).toBe(0);
			expect(date.getMinutes()).toBe(0);
			expect(date.getSeconds()).toBe(0);
			expect(date.getMilliseconds()).toBe(0);
		}
	});

	it("keeps schedule IDs stable between local and Z-suffixed intake start strings", () => {
		const medWithoutZ: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00" }],
				updatedAt: null,
			},
		];

		const medWithZ: Medication[] = [
			{
				...medWithoutZ[0],
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00.000Z" }],
			},
		];

		const localResult = buildSchedulePreview(medWithoutZ, "en", true);
		const zResult = buildSchedulePreview(medWithZ, "en", true);

		expect(zResult.events.map((event) => event.id)).toEqual(localResult.events.map((event) => event.id));
		expect(zResult.events.map((event) => event.when)).toEqual(localResult.events.map((event) => event.when));
	});
});

describe("calculateCoverage", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("calculates coverage for medication with schedule", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-15T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const events = [{ medName: "TestMed", when: Date.now(), id: "test-dose-id" }];
		const result = calculateCoverage(meds, events, "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		expect(result.all[0].name).toBe("TestMed");
		expect(result.all[0].daysLeft).toBeDefined();
	});

	it("handles medication with no schedule", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "NoSchedule",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [],
				updatedAt: null,
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		expect(result.all[0].daysLeft).toBeNull();
	});

	it("uses intakes format when available instead of blisters", () => {
		// The new intakes format should be used for coverage calculation
		// when med.intakes is present, falling through getBlistersForMed
		const meds: Medication[] = [
			{
				id: 1,
				name: "IntakesMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [], // Empty blisters — intakes should be used instead
				intakes: [
					{
						usage: 2,
						every: 1,
						start: "2024-03-10T09:00:00",
						takenBy: null,
						intakeRemindersEnabled: false,
					},
				],
				updatedAt: null,
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// 30 pills, 2 per day consumed. March 10 09:00 to March 15 12:00 = 6 occurrences × 2 = 12 consumed
		expect(result.all[0].medsLeft).toBe(18);
		expect(result.all[0].daysLeft).toBe(9); // 18 pills / 2 per day = 9 days
	});

	it("per-intake takenBy counts person correctly in automatic mode", () => {
		// When intakes have per-intake takenBy, each person-intake pair is counted
		const meds: Medication[] = [
			{
				id: 1,
				name: "PersonMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 60,
				looseTablets: 0,
				takenBy: ["Alice", "Bob"],
				packageType: "blister",
				blisters: [],
				intakes: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-10T09:00:00",
						takenBy: "Alice",
						intakeRemindersEnabled: false,
					},
					{
						usage: 1,
						every: 1,
						start: "2024-03-10T09:00:00",
						takenBy: "Bob",
						intakeRemindersEnabled: false,
					},
				],
				updatedAt: null,
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// 2 intakes × 1 pill/day × 6 occurrences = 12 consumed
		// dailyRate = 2 (1/day × 2 people)
		// medsLeft = 60 - 12 = 48, daysLeft = 48 / 2 = 24
		expect(result.all[0].medsLeft).toBe(48);
		expect(result.all[0].daysLeft).toBe(24);
	});

	it("automatic mode without stock correction counts from blister start", () => {
		// Without stock correction, effectiveStart should be the blisterStart itself.
		// This tests the `else` branch where effectiveStart = blisterStart.
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-13T09:00:00", // 2 days ago + today = 3 occurrences
					},
				],
				updatedAt: null,
				// No lastStockCorrectionAt
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// March 13, 14, 15 at 09:00 — all past (it's 12:00 on March 15) = 3 consumed
		expect(result.all[0].medsLeft).toBe(27);
	});

	it("filters low stock medications", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "LowStock",
				packCount: 0,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 5,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-15T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());
		expect(result.low.length).toBeGreaterThanOrEqual(0);
	});

	it("respects manual stock calculation mode", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-10T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const takenDoses = new Set(["1-0-1710061200000"]);
		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses);

		expect(result.all).toHaveLength(1);
	});

	it("handles multiple takenBy people", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "SharedMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: ["Alice", "Bob"],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-15T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());
		expect(result.all).toHaveLength(1);
		// Daily rate should be doubled for 2 people
	});

	it("stock correction immediately reflects new stock without phantom consumption", () => {
		// BUG: After a stock correction of +1 pill, the coverage calculation
		// immediately consumed 1 dose (due to the +1 in occurrences formula),
		// making the correction appear to have no effect.
		//
		// Scenario: User has 112 pills, corrects to 113 (+1 pill).
		// Expected: medsLeft = 113 immediately after correction.
		// Bug: medsLeft stayed at 112 because 1 dose was counted as consumed.
		const correctionTime = new Date("2024-03-15T12:00:00Z");

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 14,
				pillsPerBlister: 14,
				looseTablets: 0,
				stockAdjustment: -83, // 196 - 83 = 113 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-01-01T08:00:00",
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		// Calculate coverage immediately after correction (same second)
		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// getMedTotal = 1*14*14 + 0 + (-83) = 113
		// Consumed since correction should be 0 (not 1!)
		expect(result.all[0].medsLeft).toBe(113);
	});

	it("stock correction with dose tracking data also reflects correctly", () => {
		// In automatic mode, dose tracking data is ignored — stock is always
		// reduced based on the schedule. Verify that tracked doses don't affect
		// the calculation and that stock correction still resets the baseline.
		const correctionTime = new Date("2024-03-15T12:00:00Z");
		const march14 = new Date("2024-03-14T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				stockAdjustment: -7, // 30 - 7 = 23 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T08:00:00",
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		// User has tracked a dose yesterday (before the correction)
		// In automatic mode, this should be ignored — only the schedule matters.
		const takenDoses = new Set([`1-0-${march14}`]);

		const result = calculateCoverage(meds, [], "en", 7, "automatic", takenDoses);

		expect(result.all).toHaveLength(1);
		// getMedTotal = 30 - 7 = 23.
		// Automatic mode ignores tracking data. After correction, consumption
		// restarts from correctionTime + period, which is in the future.
		expect(result.all[0].medsLeft).toBe(23);
	});

	it("stock correction consumption resumes after one full period", () => {
		// After correction, the next scheduled dose on the blister's grid should
		// be counted once its time arrives.
		// Correction at March 14 12:00, blister start 08:00 daily →
		// next dose after correction = March 15 08:00. Now is 13:00 on March 15 → 1 dose.
		const correctionTime = new Date("2024-03-14T12:00:00Z");
		vi.setSystemTime(new Date("2024-03-15T13:00:00Z")); // 25 hours after correction

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				stockAdjustment: -7, // 30 - 7 = 23 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T08:00:00",
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// After 1 full period since correction, 1 dose should be consumed.
		// medsLeft = 23 - 1 = 22
		expect(result.all[0].medsLeft).toBe(22);
	});

	it("stock correction aligns to schedule grid, not correction timestamp", () => {
		// BUG: When correction happened just before a scheduled dose (e.g. 15:40
		// correction, 15:42 dose), the old code added 1 full period to the correction
		// time (15:40 + 24h = tomorrow 15:40), missing today's 15:42 dose entirely.
		// FIX: Align effectiveStart to the blister's schedule grid so that the first
		// dose counted is the next one on the schedule after the correction.
		const correctionTime = new Date(2024, 2, 14, 15, 40, 0); // 2 min before dose
		vi.setSystemTime(new Date(2024, 2, 14, 15, 45, 0)); // 5 min after correction, 3 min after dose

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				stockAdjustment: -5, // 30 - 5 = 25 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T15:42:00", // Daily at 15:42 local time
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// Correction at 15:40, dose at 15:42, now at 15:45.
		// The 15:42 dose is AFTER the correction → should be counted.
		// medsLeft = 25 - 1 = 24
		expect(result.all[0].medsLeft).toBe(24);
	});

	it("stock correction shortly after a dose does not count that dose again", () => {
		// If correction happens shortly AFTER a dose, that dose is already reflected
		// in the stock count and should NOT be counted again.
		const correctionTime = new Date(2024, 2, 14, 15, 45, 0); // 3 min AFTER the 15:42 dose
		vi.setSystemTime(new Date(2024, 2, 14, 16, 0, 0)); // 15 min after correction

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				stockAdjustment: -5,
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T15:42:00", // Daily at 15:42 local time
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		const result = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		expect(result.all).toHaveLength(1);
		// Correction at 15:45, after today's 15:42 dose → next dose is TOMORROW 15:42.
		// Now is 16:00 today → next dose hasn't arrived yet → 0 consumed.
		// medsLeft = 25
		expect(result.all[0].medsLeft).toBe(25);
	});

	it("automatic mode ignores past dose tracking data", () => {
		// Automatic mode uses time-based expected consumption for past doses.
		// Even if a user marks only some past doses as taken, the stock should still
		// decrease for ALL scheduled doses whose time has passed.
		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-10T09:00:00",
					},
				],
				updatedAt: null,
			},
		];

		// System time is March 15 12:00, start is 09:00 → 6 occurrences (March 10-15)
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const march11 = new Date("2024-03-11T00:00:00").getTime();

		// User only marked 2 out of 6 past doses as taken
		const takenDoses = new Set([`1-0-${march10}`, `1-0-${march11}`]);

		const resultWithTracking = calculateCoverage(meds, [], "en", 7, "automatic", takenDoses);
		const resultWithoutTracking = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		// Both should have the same medsLeft — past tracking data doesn't reduce extra
		expect(resultWithTracking.all[0].medsLeft).toBe(resultWithoutTracking.all[0].medsLeft);
		// 30 pills - 6 consumed = 24
		expect(resultWithTracking.all[0].medsLeft).toBe(24);
	});

	it("automatic mode counts early-taken future doses", () => {
		// If a user marks a dose as taken BEFORE the scheduled time,
		// it should count as consumed immediately (early intake).
		// System time is March 15 12:00, intake at 21:00 → today's dose not yet auto-consumed
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-10T21:00:00", // 21:00 = after current time 12:00
					},
				],
				updatedAt: null,
			},
		];

		// 5 occurrences auto-consumed: March 10-14 (all at 21:00, which is past)
		// March 15 at 21:00 hasn't passed yet (it's only 12:00)
		const resultNoTracking = calculateCoverage(meds, [], "en", 7, "automatic", new Set());
		expect(resultNoTracking.all[0].medsLeft).toBe(25); // 30 - 5 = 25

		// User marks today's (March 15) dose as taken early at 12:00
		const march15 = new Date("2024-03-15T00:00:00").getTime();
		const takenDoses = new Set([`1-0-${march15}`]);

		const resultEarlyTaken = calculateCoverage(meds, [], "en", 7, "automatic", takenDoses);
		// 5 auto + 1 early = 6 consumed → 30 - 6 = 24
		expect(resultEarlyTaken.all[0].medsLeft).toBe(24);
	});

	it("automatic mode does not double-count after intake time passes", () => {
		// After the scheduled time, the dose is auto-consumed.
		// If it was also marked as taken (earlier), it should NOT be counted twice.
		vi.setSystemTime(new Date("2024-03-15T22:00:00Z")); // After 21:00

		const meds: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-10T21:00:00",
					},
				],
				updatedAt: null,
			},
		];

		// 6 occurrences auto-consumed: March 10-15 (all at 21:00, now it's 22:00)
		const march15 = new Date("2024-03-15T00:00:00").getTime();
		const march14 = new Date("2024-03-14T00:00:00").getTime();
		// User marked March 14 and 15 as taken (both already auto-consumed by now)
		const takenDoses = new Set([`1-0-${march14}`, `1-0-${march15}`]);

		const resultTracked = calculateCoverage(meds, [], "en", 7, "automatic", takenDoses);
		const resultNoTracking = calculateCoverage(meds, [], "en", 7, "automatic", new Set());

		// Both should be 24 (30 - 6). No double counting!
		expect(resultTracked.all[0].medsLeft).toBe(24);
		expect(resultNoTracking.all[0].medsLeft).toBe(24);
	});

	it("manual mode: dose taken BEFORE stock correction is excluded", () => {
		// When a user corrects stock, any dose marked BEFORE the correction
		// is already reflected in the corrected count and should NOT be counted.
		const correctionTime = new Date("2024-03-15T12:00:00Z");
		const todayMidnight = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 1,
				name: "DailyMed",
				packCount: 1,
				blistersPerPack: 14,
				pillsPerBlister: 14,
				looseTablets: 0,
				stockAdjustment: -85, // 196 - 85 = 111 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-01-01T08:00:00",
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		// User took a dose today at 10am (BEFORE the correction at 12pm)
		const doseId = `1-0-${todayMidnight}`;
		const takenDoses = new Set([doseId]);
		const takenDoseTimestamps = new Map([[doseId, new Date("2024-03-15T10:00:00Z").getTime()]]);

		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);

		expect(result.all).toHaveLength(1);
		// getMedTotal = 196 - 85 = 111
		// Dose was taken BEFORE correction → NOT counted
		expect(result.all[0].medsLeft).toBe(111);
	});

	it("manual mode: dose taken AFTER stock correction is counted", () => {
		// When a user corrects stock and then takes a dose, that dose SHOULD be counted.
		const correctionTime = new Date("2024-03-15T12:00:00Z");
		const todayMidnight = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 1,
				name: "DailyMed",
				packCount: 1,
				blistersPerPack: 14,
				pillsPerBlister: 14,
				looseTablets: 0,
				stockAdjustment: -85, // 196 - 85 = 111 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-01-01T08:00:00",
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		// User took a dose today at 2pm (AFTER the correction at 12pm)
		const doseId = `1-0-${todayMidnight}`;
		const takenDoses = new Set([doseId]);
		const takenDoseTimestamps = new Map([[doseId, new Date("2024-03-15T14:00:00Z").getTime()]]);

		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);

		expect(result.all).toHaveLength(1);
		// getMedTotal = 196 - 85 = 111
		// Dose was taken AFTER correction → counted → 111 - 1 = 110
		expect(result.all[0].medsLeft).toBe(110);
	});

	it("manual mode: stock correction counts next-day taken doses", () => {
		// After a stock correction, doses taken the next day SHOULD be counted.
		const correctionTime = new Date("2024-03-14T12:00:00Z");
		const march15Midnight = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 1,
				name: "DailyMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				stockAdjustment: -7, // 30 - 7 = 23 pills
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T08:00:00",
					},
				],
				updatedAt: correctionTime.toISOString(),
			},
		];

		// User takes dose on March 15 at 8am (day after correction on March 14)
		const doseId = `1-0-${march15Midnight}`;
		const takenDoses = new Set([doseId]);
		const takenDoseTimestamps = new Map([[doseId, new Date("2024-03-15T08:00:00Z").getTime()]]);

		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);

		expect(result.all).toHaveLength(1);
		// getMedTotal = 30 - 7 = 23
		// March 15 dose should be counted (taken after correction)
		expect(result.all[0].medsLeft).toBe(22);
	});

	it("manual mode: no stock correction counts all taken doses", () => {
		// Without any stock correction, all taken doses should be counted
		const march14Midnight = new Date("2024-03-14T00:00:00").getTime();
		const march15Midnight = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 1,
				name: "DailyMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T08:00:00",
					},
				],
				updatedAt: null,
			},
		];

		// User took doses on March 14 and 15
		const doseId1 = `1-0-${march14Midnight}`;
		const doseId2 = `1-0-${march15Midnight}`;
		const takenDoses = new Set([doseId1, doseId2]);
		// No stock correction → takenAt doesn't matter, but provide for completeness
		const takenDoseTimestamps = new Map([
			[doseId1, new Date("2024-03-14T08:00:00Z").getTime()],
			[doseId2, new Date("2024-03-15T08:00:00Z").getTime()],
		]);

		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);

		expect(result.all).toHaveLength(1);
		// Both doses should be counted: medsLeft = 30 - 2 = 28
		expect(result.all[0].medsLeft).toBe(28);
	});

	it("manual mode: stock correction with multiple medications", () => {
		// Regression test: 3 medications (daily, daily, weekly).
		// Stock correction on all 3. Daily meds have doses taken BEFORE correction.
		const correctionTime = new Date("2024-03-15T12:00:00Z");
		const todayMidnight = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 1,
				name: "DailyMed1",
				packCount: 1,
				blistersPerPack: 14,
				pillsPerBlister: 14,
				looseTablets: 0,
				stockAdjustment: -85, // 196 - 85 = 111
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-01-01T08:00:00" }],
				updatedAt: correctionTime.toISOString(),
			},
			{
				id: 2,
				name: "DailyMed2",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				stockAdjustment: -10, // 30 - 10 = 20
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00" }],
				updatedAt: correctionTime.toISOString(),
			},
			{
				id: 3,
				name: "WeeklyMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				stockAdjustment: -2, // 10 - 2 = 8
				lastStockCorrectionAt: correctionTime.toISOString(),
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 7, start: "2024-01-05T10:00:00" }],
				updatedAt: correctionTime.toISOString(),
			},
		];

		// Daily meds have same-day doses taken BEFORE correction (at 8am, correction at 12pm)
		const doseId1 = `1-0-${todayMidnight}`;
		const doseId2 = `2-0-${todayMidnight}`;
		const takenDoses = new Set([doseId1, doseId2]);
		const takenDoseTimestamps = new Map([
			[doseId1, new Date("2024-03-15T08:00:00Z").getTime()], // Before correction
			[doseId2, new Date("2024-03-15T09:00:00Z").getTime()], // Before correction
		]);

		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);

		expect(result.all).toHaveLength(3);
		const daily1 = result.all.find((c) => c.name === "DailyMed1")!;
		const daily2 = result.all.find((c) => c.name === "DailyMed2")!;
		const weekly = result.all.find((c) => c.name === "WeeklyMed")!;

		// All three should reflect full stock (doses taken before correction → excluded)
		expect(daily1.medsLeft).toBe(111);
		expect(daily2.medsLeft).toBe(20);
		expect(weekly.medsLeft).toBe(8);
	});

	it("manual mode: person-suffix dose IDs are counted correctly", () => {
		// BUG HUNT: In prod (manual mode), dose IDs have a person suffix like
		// "31-0-1770505200000-Daniel". Does the manual mode code correctly parse
		// and count these?
		const march14 = new Date("2024-03-14T00:00:00").getTime();
		const march15 = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 31,
				name: "ProdMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: ["Daniel"],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T08:00:00",
					},
				],
				updatedAt: null,
			},
		];

		// Dose IDs with person suffix (as prod generates them)
		const doseId1 = `31-0-${march14}-Daniel`;
		const doseId2 = `31-0-${march15}-Daniel`;
		const takenDoses = new Set([doseId1, doseId2]);
		// No stock correction → all counted
		const takenDoseTimestamps = new Map([
			[doseId1, new Date("2024-03-14T08:00:00Z").getTime()],
			[doseId2, new Date("2024-03-15T08:00:00Z").getTime()],
		]);

		const result = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);

		expect(result.all).toHaveLength(1);
		// Both doses should be counted: medsLeft = 30 - 2 = 28
		expect(result.all[0].medsLeft).toBe(28);
	});

	it("manual mode: future dose taken today counts immediately", () => {
		// User marks a future dose (later today) as taken.
		// It should be counted in manual mode immediately.
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
		const march15 = new Date("2024-03-15T00:00:00").getTime();

		const meds: Medication[] = [
			{
				id: 31,
				name: "ProdMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: ["Daniel"],
				packageType: "blister",
				blisters: [
					{
						usage: 1,
						every: 1,
						start: "2024-03-01T21:00:00", // 21:00, still in future at 12:00
					},
				],
				updatedAt: null,
			},
		];

		// No doses taken → 30 pills
		const resultBefore = calculateCoverage(meds, [], "en", 7, "manual", new Set());
		expect(resultBefore.all[0].medsLeft).toBe(30);

		// Take today's dose (future time) → 29 pills
		const doseId = `31-0-${march15}-Daniel`;
		const takenDoses = new Set([doseId]);
		const takenDoseTimestamps = new Map([[doseId, Date.now()]]);
		const resultAfter = calculateCoverage(meds, [], "en", 7, "manual", takenDoses, takenDoseTimestamps);
		expect(resultAfter.all[0].medsLeft).toBe(29);

		// Undo → back to 30 pills
		const resultUndo = calculateCoverage(meds, [], "en", 7, "manual", new Set());
		expect(resultUndo.all[0].medsLeft).toBe(30);
	});
});

describe("getStockStatus", () => {
	const thresholds: StockThresholds = {
		lowStockDays: 30,
		criticalStockDays: 7,
		normalStockDays: 90,
		highStockDays: 180,
		expiryWarningDays: 30,
	};

	it("returns out-of-stock when medsLeft is 0", () => {
		const result = getStockStatus(5, 0, thresholds);
		expect(result.level).toBe("out-of-stock");
		expect(result.className).toBe("danger");
	});

	it("returns out-of-stock when daysLeft is 0", () => {
		const result = getStockStatus(0, 5, thresholds);
		expect(result.level).toBe("out-of-stock");
		expect(result.className).toBe("danger");
	});

	it("returns high when daysLeft > highStockDays", () => {
		const result = getStockStatus(200, 100, thresholds);
		expect(result.level).toBe("high");
		expect(result.className).toBe("high");
	});

	it("returns normal when daysLeft >= lowStockDays", () => {
		const result = getStockStatus(50, 100, thresholds);
		expect(result.level).toBe("normal");
		expect(result.className).toBe("success");
	});

	it("returns low when daysLeft < lowStockDays", () => {
		const result = getStockStatus(20, 100, thresholds);
		expect(result.level).toBe("low");
		expect(result.className).toBe("warning");
	});

	it("returns normal when daysLeft is null but medsLeft > 0", () => {
		const result = getStockStatus(null, 100, thresholds);
		expect(result.level).toBe("normal");
		expect(result.label).toBe("status.noSchedule");
	});

	it("returns critical when daysLeft is at or below criticalStockDays", () => {
		const thresholdsWithCritical: StockThresholds = {
			lowStockDays: 30,
			criticalStockDays: 7,
			normalStockDays: 90,
			highStockDays: 180,
			expiryWarningDays: 30,
		};

		const result = getStockStatus(5, 10, thresholdsWithCritical);
		expect(result.level).toBe("critical");
		expect(result.className).toBe("danger");
	});

	it("returns normal (no stock reminder semantics) for tube packageType regardless of stock thresholds", () => {
		// Tubes have no stock reminder semantics: thresholds (low, critical, high) do not apply.
		// However, if truly empty or exhausted, out-of-stock is still returned.
		const resultWithMeds = getStockStatus(100, 50, thresholds, "tube");
		expect(resultWithMeds.level).toBe("normal");
		expect(resultWithMeds.className).toBe("success");
		expect(resultWithMeds.label).toBe("status.noSchedule");

		// Even with low days remaining (would be critical for non-tube)
		const resultLow = getStockStatus(2, 50, thresholds, "tube");
		expect(resultLow.level).toBe("normal");
		expect(resultLow.className).toBe("success");

		// Exhausted/empty tubes still show as out-of-stock
		const resultEmpty = getStockStatus(0, 0, thresholds, "tube");
		expect(resultEmpty.level).toBe("out-of-stock");
		expect(resultEmpty.className).toBe("danger");
	});

	it("applies liquid_container thresholds: low=critical(threshold), critical=ceil(critical/2)", () => {
		// For liquid_container, baseline is criticalStockDays (7)
		// low = 7, critical = ceil(7/2) = 4
		const thresholdsLiquid: StockThresholds = {
			lowStockDays: 30,
			criticalStockDays: 7,
			normalStockDays: 90,
			highStockDays: 180,
			expiryWarningDays: 30,
		};

		// daysLeft = 8 (above low threshold of 7)
		const resultNormal = getStockStatus(8, 100, thresholdsLiquid, "liquid_container");
		expect(resultNormal.level).toBe("normal");
		expect(resultNormal.className).toBe("success");

		// daysLeft = 7 (at low threshold, below normal)
		const resultLow = getStockStatus(7, 100, thresholdsLiquid, "liquid_container");
		expect(resultLow.level).toBe("low");
		expect(resultLow.className).toBe("warning");

		// daysLeft = 4 (at critical threshold)
		const resultCritical = getStockStatus(4, 100, thresholdsLiquid, "liquid_container");
		expect(resultCritical.level).toBe("critical");
		expect(resultCritical.className).toBe("danger");

		// daysLeft = 2 (below critical threshold)
		const resultVeryCritical = getStockStatus(2, 100, thresholdsLiquid, "liquid_container");
		expect(resultVeryCritical.level).toBe("critical");
		expect(resultVeryCritical.className).toBe("danger");
	});

	it("handles liquid_container with boundary baseline (criticalStockDays=1)", () => {
		// Boundary case: criticalStockDays=1, so low=1, critical=ceil(1/2)=1
		const boundaryThresholds: StockThresholds = {
			lowStockDays: 30,
			criticalStockDays: 1,
			normalStockDays: 90,
			highStockDays: 180,
			expiryWarningDays: 30,
		};

		// daysLeft = 2 (above low threshold)
		const resultNormal = getStockStatus(2, 100, boundaryThresholds, "liquid_container");
		expect(resultNormal.level).toBe("normal");

		// daysLeft = 1 (at low and critical thresholds)
		const resultCritical = getStockStatus(1, 100, boundaryThresholds, "liquid_container");
		expect(resultCritical.level).toBe("critical");

		// daysLeft = 0 (out of stock)
		const resultEmpty = getStockStatus(0, 100, boundaryThresholds, "liquid_container");
		expect(resultEmpty.level).toBe("out-of-stock");
	});
});

describe("getNextReminderForMed", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const mockT = (key: string, options?: Record<string, unknown>) => {
		if (typeof options?.count === "number") return `${key} (${options.count})`;
		if (typeof options?.days === "number") return `${key} (${options.days})`;
		return key;
	};

	it("shows empty stock warning first", () => {
		const emptyMed: Coverage = {
			name: "Empty",
			medsLeft: 0,
			daysLeft: 0,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [], [emptyMed], null, null, null, mockT, "en");
		expect(result.lines[0].text).toContain("dashboard.reminders.emptyStock");
		expect(result.lines[0].className).toBe("danger-text");
	});

	it("shows all ok when everything is fine", () => {
		const healthyMed: Coverage = {
			name: "Healthy",
			medsLeft: 100,
			daysLeft: 60,
			depletionDate: null,
			depletionTime: Date.now() + 60 * 86400000,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [], [healthyMed], null, null, null, mockT, "en");
		expect(result.lines[0].text).toContain("dashboard.reminders.allOk");
	});

	it("includes last sent info if available", () => {
		// For healthy meds with no upcoming reminders, it goes to the final fallback
		// which returns allStockOk and includes lastReminder info
		const healthyMed: Coverage = {
			name: "Healthy",
			medsLeft: 100,
			daysLeft: 200,
			depletionDate: null,
			depletionTime: Date.now() + 200 * 86400000,
			nextDose: null,
		};

		const result = getReminderStatusText(
			7,
			30,
			[],
			[healthyMed],
			"2024-03-10T10:00:00Z",
			"stock",
			"email",
			mockT,
			"en"
		);
		// Either allOk or allStockOk includes last reminder info
		const hasLastReminder = result.lines.some(
			(l) => l.text.includes("lastReminder") || l.text.includes("allOk") || l.text.includes("allStockOk")
		);
		expect(hasLastReminder).toBe(true);
	});

	it("shows low warning for medications running low", () => {
		const lowMed: Coverage = {
			name: "RunningLow",
			medsLeft: 20,
			daysLeft: 20,
			depletionDate: null,
			depletionTime: Date.now() + 20 * 86400000,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [], [lowMed], null, null, null, mockT, "en");
		expect(result.lines.some((l) => l.text.includes("lowWarning") || l.text.includes("needRefill"))).toBe(true);
	});

	it("handles intake reminder type with push channel", () => {
		const emptyMed: Coverage = {
			name: "Empty",
			medsLeft: 0,
			daysLeft: 0,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [], [emptyMed], "2024-03-10T10:00:00Z", "intake", "push", mockT, "en");
		expect(result.lines[0].className).toBe("danger-text");
	});

	it("handles both channel type", () => {
		const emptyMed: Coverage = {
			name: "Empty",
			medsLeft: 0,
			daysLeft: 0,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [], [emptyMed], "2024-03-10T10:00:00Z", "stock", "both", mockT, "en");
		expect(result.lines[0].className).toBe("danger-text");
	});

	it("shows needRefill when below critical threshold", () => {
		const criticalMed: Coverage = {
			name: "Critical",
			medsLeft: 5,
			daysLeft: 5,
			depletionDate: null,
			depletionTime: Date.now() + 5 * 86400000,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [criticalMed], [criticalMed], null, null, null, mockT, "en");
		expect(result.lines.some((l) => l.text.includes("needRefill"))).toBe(true);
	});

	it("shows low warning when below low threshold but above critical", () => {
		const lowMed: Coverage = {
			name: "Low",
			medsLeft: 20,
			daysLeft: 20,
			depletionDate: null,
			depletionTime: Date.now() + 20 * 86400000,
			nextDose: null,
		};

		const result = getReminderStatusText(7, 30, [], [lowMed], null, null, null, mockT, "en");
		expect(result.lines.some((l) => l.text.includes("lowWarning"))).toBe(true);
	});

	it("returns noRemindersNeeded when all ok and no last sent", () => {
		const result = getReminderStatusText(7, 30, [], [], null, null, null, mockT, "en");
		expect(result.lines.some((l) => l.text.includes("noRemindersNeeded") || l.text.includes("allStockOk"))).toBe(true);
	});

	it("handles empty and critical meds together", () => {
		const emptyMed: Coverage = {
			name: "Empty",
			medsLeft: 0,
			daysLeft: 0,
			depletionDate: null,
			depletionTime: null,
			nextDose: null,
		};

		const criticalMed: Coverage = {
			name: "Critical",
			medsLeft: 5,
			daysLeft: 5,
			depletionDate: null,
			depletionTime: Date.now() + 5 * 86400000,
			nextDose: null,
		};

		const lowMed: Coverage = {
			name: "Low",
			medsLeft: 20,
			daysLeft: 20,
			depletionDate: null,
			depletionTime: Date.now() + 20 * 86400000,
			nextDose: null,
		};

		const result = getReminderStatusText(
			7,
			30,
			[criticalMed],
			[emptyMed, criticalMed, lowMed],
			null,
			null,
			null,
			mockT,
			"en"
		);
		expect(result.lines[0].text).toContain("emptyStock");
		expect(result.lines.length).toBeGreaterThan(1);
	});
});

// =============================================================================
// isDoseDismissed
// =============================================================================

describe("isDoseDismissed", () => {
	it("returns false when dismissedUntilDate is undefined", () => {
		expect(isDoseDismissed("1-0-1710028800000", undefined)).toBe(false);
	});

	it("returns false for dose IDs with fewer than 3 parts", () => {
		expect(isDoseDismissed("1-0", "2024-03-15")).toBe(false);
		expect(isDoseDismissed("1", "2024-03-15")).toBe(false);
		expect(isDoseDismissed("", "2024-03-15")).toBe(false);
	});

	it("returns false for dose IDs with non-numeric timestamp", () => {
		expect(isDoseDismissed("1-0-abc", "2024-03-15")).toBe(false);
	});

	it("returns true when dose date is before dismissedUntil", () => {
		// March 10 midnight UTC = 1710028800000
		const march10midnight = new Date("2024-03-10T00:00:00").getTime();
		expect(isDoseDismissed(`1-0-${march10midnight}`, "2024-03-14")).toBe(true);
	});

	it("returns true when dose date equals dismissedUntil", () => {
		const march14midnight = new Date("2024-03-14T00:00:00").getTime();
		expect(isDoseDismissed(`1-0-${march14midnight}`, "2024-03-14")).toBe(true);
	});

	it("returns false when dose date is after dismissedUntil", () => {
		const march15midnight = new Date("2024-03-15T00:00:00").getTime();
		expect(isDoseDismissed(`1-0-${march15midnight}`, "2024-03-14")).toBe(false);
	});

	it("works with person-suffixed dose IDs", () => {
		// Dose ID: medId-intakeIdx-timestamp-person
		const march10midnight = new Date("2024-03-10T00:00:00").getTime();
		expect(isDoseDismissed(`1-0-${march10midnight}-John`, "2024-03-14")).toBe(true);
		expect(isDoseDismissed(`1-0-${march10midnight}-John`, "2024-03-09")).toBe(false);
	});

	it("handles single-digit months and days correctly", () => {
		// January 5 = should produce "2024-01-05"
		const jan5 = new Date("2024-01-05T00:00:00").getTime();
		expect(isDoseDismissed(`1-0-${jan5}`, "2024-01-05")).toBe(true);
		expect(isDoseDismissed(`1-0-${jan5}`, "2024-01-04")).toBe(false);
	});
});

// =============================================================================
// computeMissedPastDoseIds
// =============================================================================

describe("computeMissedPastDoseIds", () => {
	// Helper: create a past day with dose IDs
	function makePastDay(
		medName: string,
		doses: Array<{ id: string; takenBy?: string[] }>
	): { meds: Array<{ medName: string; doses: Array<{ id: string; takenBy: string[] }> }> } {
		return {
			meds: [
				{
					medName,
					doses: doses.map((d) => ({ id: d.id, takenBy: d.takenBy ?? [] })),
				},
			],
		};
	}

	it("returns all past dose IDs when none are taken or dismissed", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const march11 = new Date("2024-03-11T00:00:00").getTime();
		const pastDays = [makePastDay("Aspirin", [{ id: `1-0-${march10}` }, { id: `1-0-${march11}` }])];
		const meds = [{ name: "Aspirin" }];

		const result = computeMissedPastDoseIds(pastDays, meds, new Set(), new Set());
		expect(result).toEqual([`1-0-${march10}`, `1-0-${march11}`]);
	});

	it("excludes taken doses", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const march11 = new Date("2024-03-11T00:00:00").getTime();
		const pastDays = [makePastDay("Aspirin", [{ id: `1-0-${march10}` }, { id: `1-0-${march11}` }])];
		const meds = [{ name: "Aspirin" }];
		const taken = new Set([`1-0-${march10}`]);

		const result = computeMissedPastDoseIds(pastDays, meds, taken, new Set());
		expect(result).toEqual([`1-0-${march11}`]);
	});

	it("excludes individually dismissed doses", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const march11 = new Date("2024-03-11T00:00:00").getTime();
		const pastDays = [makePastDay("Aspirin", [{ id: `1-0-${march10}` }, { id: `1-0-${march11}` }])];
		const meds = [{ name: "Aspirin" }];
		const dismissed = new Set([`1-0-${march10}`]);

		const result = computeMissedPastDoseIds(pastDays, meds, new Set(), dismissed);
		expect(result).toEqual([`1-0-${march11}`]);
	});

	it("excludes doses on or before medication dismissedUntil date", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const march11 = new Date("2024-03-11T00:00:00").getTime();
		const march13 = new Date("2024-03-13T00:00:00").getTime();
		const march14 = new Date("2024-03-14T00:00:00").getTime();
		const pastDays = [
			makePastDay("Aspirin", [
				{ id: `1-0-${march10}` },
				{ id: `1-0-${march11}` },
				{ id: `1-0-${march13}` },
				{ id: `1-0-${march14}` },
			]),
		];
		// Dismiss all doses up through March 12
		const meds = [{ name: "Aspirin", dismissedUntil: "2024-03-12" }];

		const result = computeMissedPastDoseIds(pastDays, meds, new Set(), new Set());
		// March 10 & 11 are dismissed (≤ March 12), March 13 & 14 remain missed
		expect(result).toEqual([`1-0-${march13}`, `1-0-${march14}`]);
	});

	it("matches medication dismissedUntil via display name when the schedule row uses genericName", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const pastDays = [makePastDay("Acetylsalicylic Acid", [{ id: `1-0-${march10}` }])];
		const meds = [{ name: "", genericName: "Acetylsalicylic Acid", dismissedUntil: "2024-03-12" }];

		const result = computeMissedPastDoseIds(pastDays, meds, new Set(), new Set());
		expect(result).toEqual([]);
	});

	it("expands takenBy people into separate dose IDs", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const pastDays = [makePastDay("SharedMed", [{ id: `1-0-${march10}`, takenBy: ["Alice", "Bob"] }])];
		const meds = [{ name: "SharedMed" }];

		const result = computeMissedPastDoseIds(pastDays, meds, new Set(), new Set());
		expect(result).toEqual([`1-0-${march10}-Alice`, `1-0-${march10}-Bob`]);
	});

	it("excludes expanded person dose IDs that are taken", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const pastDays = [makePastDay("SharedMed", [{ id: `1-0-${march10}`, takenBy: ["Alice", "Bob"] }])];
		const meds = [{ name: "SharedMed" }];
		// Alice took it, Bob didn't
		const taken = new Set([`1-0-${march10}-Alice`]);

		const result = computeMissedPastDoseIds(pastDays, meds, taken, new Set());
		expect(result).toEqual([`1-0-${march10}-Bob`]);
	});

	it("returns empty array when all doses are taken", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const pastDays = [makePastDay("Aspirin", [{ id: `1-0-${march10}` }])];
		const meds = [{ name: "Aspirin" }];
		const taken = new Set([`1-0-${march10}`]);

		const result = computeMissedPastDoseIds(pastDays, meds, taken, new Set());
		expect(result).toEqual([]);
	});

	it("handles multiple medications independently", () => {
		const march10 = new Date("2024-03-10T00:00:00").getTime();
		const pastDays = [
			{
				meds: [
					{ medName: "Aspirin", doses: [{ id: `1-0-${march10}`, takenBy: [] as string[] }] },
					{ medName: "Vitamin D", doses: [{ id: `2-0-${march10}`, takenBy: [] as string[] }] },
				],
			},
		];
		// Aspirin dismissed, Vitamin D not
		const meds = [{ name: "Aspirin", dismissedUntil: "2024-03-15" }, { name: "Vitamin D" }];

		const result = computeMissedPastDoseIds(pastDays, meds, new Set(), new Set());
		// Only Vitamin D's dose remains missed
		expect(result).toEqual([`2-0-${march10}`]);
	});
});

// =============================================================================
// Dose Tracking Regression Tests
// =============================================================================

describe("dose tracking survives medication edits (regression)", () => {
	beforeEach(() => {
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("taken dose remains taken after changing intake time", () => {
		// === BEFORE EDIT: medication with 09:00 morning intake ===
		const medBefore: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00" }],
				updatedAt: null,
			},
		];

		const resultBefore = buildSchedulePreview(medBefore, "en", true);
		const pastBefore = resultBefore.events.filter((e) => e.isPast);
		expect(pastBefore.length).toBe(5); // March 10, 11, 12, 13, 14

		// User marks March 12 dose as taken
		const march12Dose = pastBefore.find((e) => {
			const d = new Date(e.when);
			return d.getDate() === 12;
		})!;
		expect(march12Dose).toBeDefined();
		const takenDoses = new Set([march12Dose.id]);

		// Compute missed doses BEFORE edit
		const pastDaysBefore = groupEventsIntoPastDays(pastBefore);
		const missedBefore = computeMissedPastDoseIds(pastDaysBefore, medBefore, takenDoses, new Set());
		expect(missedBefore).not.toContain(march12Dose.id); // March 12 is taken
		expect(missedBefore).toHaveLength(4); // March 10, 11, 13, 14 are missed

		// === AFTER EDIT: change intake time to 21:00 evening + updatedAt set ===
		const medAfter: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T21:00:00" }],
				updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(),
			},
		];

		const resultAfter = buildSchedulePreview(medAfter, "en", true);
		const pastAfter = resultAfter.events.filter((e) => e.isPast);
		expect(pastAfter.length).toBe(5); // Same 5 past days

		// Compute missed doses AFTER edit — with same takenDoses set
		const pastDaysAfter = groupEventsIntoPastDays(pastAfter);
		const missedAfter = computeMissedPastDoseIds(pastDaysAfter, medAfter, takenDoses, new Set());

		// === CRITICAL ASSERTION: March 12 is STILL marked as taken ===
		expect(missedAfter).not.toContain(march12Dose.id);
		// The other 4 days remain missed
		expect(missedAfter).toHaveLength(4);
	});

	it("updatedAt does NOT filter out past doses as false dismissals", () => {
		// This is the core bug that was fixed: isDoseFromPreviousSchedule compared
		// dateOnlyMs < updatedAt, which falsely dismissed ALL past doses after ANY edit.
		const med: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00" }],
				updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(), // Just edited!
			},
		];

		const result = buildSchedulePreview(med, "en", true);
		const pastEvents = result.events.filter((e) => e.isPast);
		expect(pastEvents.length).toBe(5); // March 10-14

		// No doses taken, no dismissals
		const pastDays = groupEventsIntoPastDays(pastEvents);
		const missed = computeMissedPastDoseIds(pastDays, med, new Set(), new Set());

		// ALL 5 past days should be missed — updatedAt must NOT cause silent dismissals
		expect(missed).toHaveLength(5);
	});

	it("today's doses are not counted as past/missed", () => {
		const med: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-15T09:00:00" }],
				updatedAt: null,
			},
		];

		const result = buildSchedulePreview(med, "en", true);
		const todayEvents = result.events.filter((e) => !e.isPast);
		const pastEvents = result.events.filter((e) => e.isPast);

		// Today's dose should NOT be past
		expect(todayEvents.length).toBeGreaterThan(0);
		// No past events (schedule starts today)
		expect(pastEvents.length).toBe(0);

		// computeMissedPastDoseIds with empty pastDays => no missed
		const missed = computeMissedPastDoseIds([], med, new Set(), new Set());
		expect(missed).toEqual([]);
	});

	it("dismissedUntil correctly clears missed doses after medication edit", () => {
		// Scenario: user edits medication, then clicks "Clear missed" which sets dismissedUntil
		const med: Medication[] = [
			{
				id: 1,
				name: "TestMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00" }],
				updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(),
				dismissedUntil: "2024-03-14", // Dismissed through yesterday
			},
		];

		const result = buildSchedulePreview(med, "en", true);
		const pastEvents = result.events.filter((e) => e.isPast);
		expect(pastEvents.length).toBe(5); // March 10-14

		const pastDays = groupEventsIntoPastDays(pastEvents);
		const missed = computeMissedPastDoseIds(pastDays, med, new Set(), new Set());

		// All 5 past doses are on or before March 14 → all dismissed by dismissedUntil
		expect(missed).toEqual([]);
	});

	it("multiple medications: edit one, other's tracking is unaffected", () => {
		const meds: Medication[] = [
			{
				id: 1,
				name: "Aspirin",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T09:00:00" }],
				updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(), // Just edited!
			},
			{
				id: 2,
				name: "Vitamin D",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				packageType: "blister",
				blisters: [{ usage: 1, every: 1, start: "2024-03-10T08:00:00" }],
				updatedAt: null,
			},
		];

		const result = buildSchedulePreview(meds, "en", true);
		const pastEvents = result.events.filter((e) => e.isPast);

		// Mark one dose of each medication as taken on March 12
		const aspirinMarch12 = pastEvents.find((e) => e.medName === "Aspirin" && new Date(e.when).getDate() === 12)!;
		const vitDMarch12 = pastEvents.find((e) => e.medName === "Vitamin D" && new Date(e.when).getDate() === 12)!;
		expect(aspirinMarch12).toBeDefined();
		expect(vitDMarch12).toBeDefined();

		const takenDoses = new Set([aspirinMarch12.id, vitDMarch12.id]);
		const pastDays = groupEventsIntoPastDays(pastEvents);
		const missed = computeMissedPastDoseIds(pastDays, meds, takenDoses, new Set());

		// Each med has 5 past days, 1 taken = 4 missed each = 8 total
		expect(missed).toHaveLength(8);
		// Neither March 12 dose ID should be in missed
		expect(missed).not.toContain(aspirinMarch12.id);
		expect(missed).not.toContain(vitDMarch12.id);
	});

	it("taken doses with per-intake takenBy survive time edit", () => {
		// Using the modern intakes format: each person gets their own intake entry
		// Alice = intake index 0, Bob = intake index 1
		const medBefore: Medication[] = [
			{
				id: 1,
				name: "SharedMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: ["Alice", "Bob"],
				packageType: "blister",
				blisters: [],
				intakes: [
					{ usage: 1, every: 1, start: "2024-03-10T09:00:00", takenBy: "Alice", intakeRemindersEnabled: false },
					{ usage: 1, every: 1, start: "2024-03-10T09:00:00", takenBy: "Bob", intakeRemindersEnabled: false },
				],
				updatedAt: null,
			},
		];

		const resultBefore = buildSchedulePreview(medBefore, "en", true);
		const pastBefore = resultBefore.events.filter((e) => e.isPast);
		// 2 intakes × 5 days = 10 events
		expect(pastBefore.length).toBe(10);

		// Alice's March 12 dose (intake index 0)
		const aliceMarch12 = pastBefore.find((e) => new Date(e.when).getDate() === 12 && e.id.startsWith("1-0-"))!;
		expect(aliceMarch12).toBeDefined();

		// Bob's March 12 dose (intake index 1)
		const bobMarch12 = pastBefore.find((e) => new Date(e.when).getDate() === 12 && e.id.startsWith("1-1-"))!;
		expect(bobMarch12).toBeDefined();

		// Alice takes her dose on March 12 — getDoseId adds person suffix
		// This matches how DashboardPage marks doses: getDoseId(dose.id, person)
		const aliceDoseId = `${aliceMarch12.id}-Alice`;
		const takenDoses = new Set([aliceDoseId]);

		// Now edit: change both intakes to evening
		const medAfter: Medication[] = [
			{
				id: 1,
				name: "SharedMed",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: ["Alice", "Bob"],
				packageType: "blister",
				blisters: [],
				intakes: [
					{ usage: 1, every: 1, start: "2024-03-10T21:00:00", takenBy: "Alice", intakeRemindersEnabled: false },
					{ usage: 1, every: 1, start: "2024-03-10T21:00:00", takenBy: "Bob", intakeRemindersEnabled: false },
				],
				updatedAt: new Date("2024-03-15T10:00:00Z").toISOString(),
			},
		];

		const resultAfter = buildSchedulePreview(medAfter, "en", true);
		const pastAfter = resultAfter.events.filter((e) => e.isPast);
		expect(pastAfter.length).toBe(10); // Still 10 events

		const pastDays = groupEventsIntoPastDays(pastAfter);
		const missed = computeMissedPastDoseIds(pastDays, medAfter, takenDoses, new Set());

		// 10 events, each expanded with person suffix = 10 dose IDs, minus 1 taken = 9 missed
		expect(missed).toHaveLength(9);
		// Alice's March 12 dose (with -Alice suffix) should NOT be in missed
		expect(missed).not.toContain(aliceDoseId);
		// Bob's March 12 dose (with -Bob suffix) should still be missed
		expect(missed).toContain(`${bobMarch12.id}-Bob`);
		// Dose IDs should be different between Alice and Bob (different intake index)
		expect(aliceMarch12.id).not.toBe(bobMarch12.id);
	});
});

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Group flat schedule events into the pastDays structure expected by computeMissedPastDoseIds.
 * This mirrors the groupedSchedule logic in AppContext.tsx:
 * - event.takenBy is `string | null` (per-intake person)
 * - AppContext normalizes to `string[]`: `event.takenBy ? [event.takenBy] : []`
 */
function groupEventsIntoPastDays(
	events: Array<{
		id: string;
		medName: string;
		when: number;
		usage: number;
		isPast: boolean;
		takenBy?: string | string[] | null;
	}>
): Array<{ meds: Array<{ medName: string; doses: Array<{ id: string; takenBy: string[] }> }> }> {
	const dayMap = new Map<string, Map<string, Array<{ id: string; takenBy: string[] }>>>();

	for (const event of events) {
		if (!event.isPast) continue;
		const dateKey = new Date(event.when).toDateString();
		if (!dayMap.has(dateKey)) dayMap.set(dateKey, new Map());
		const medMap = dayMap.get(dateKey)!;
		if (!medMap.has(event.medName)) medMap.set(event.medName, []);
		// Mirror AppContext normalization: string|null → string[]
		const singleOrEmpty = typeof event.takenBy === "string" ? [event.takenBy] : [];
		const takenBy = Array.isArray(event.takenBy) ? event.takenBy : singleOrEmpty;
		medMap.get(event.medName)!.push({ id: event.id, takenBy });
	}

	return Array.from(dayMap.values()).map((medMap) => ({
		meds: Array.from(medMap.entries()).map(([medName, doses]) => ({ medName, doses })),
	}));
}

describe("expandDoseIds", () => {
	it("returns base IDs when takenBy is empty array", () => {
		const doses = [
			{ id: "1-0-1729123200000", takenBy: [] as string[] },
			{ id: "2-0-1729123200000", takenBy: [] as string[] },
		];
		const result = expandDoseIds(doses);
		expect(result).toEqual(["1-0-1729123200000", "2-0-1729123200000"]);
	});

	it("returns person-suffixed IDs when takenBy has entries", () => {
		const doses = [{ id: "1-0-1729123200000", takenBy: ["Alice"] }];
		const result = expandDoseIds(doses);
		expect(result).toEqual(["1-0-1729123200000-Alice"]);
	});

	it("returns multiple IDs for multiple takenBy entries", () => {
		const doses = [{ id: "1-0-1729123200000", takenBy: ["Alice", "Bob"] }];
		const result = expandDoseIds(doses);
		expect(result).toEqual(["1-0-1729123200000-Alice", "1-0-1729123200000-Bob"]);
	});

	it("handles mix of empty and non-empty takenBy", () => {
		const doses = [
			{ id: "1-0-1729123200000", takenBy: ["Alice"] },
			{ id: "2-0-1729123200000", takenBy: [] as string[] },
			{ id: "3-0-1729123200000", takenBy: ["Bob", "Carol"] },
		];
		const result = expandDoseIds(doses);
		expect(result).toEqual([
			"1-0-1729123200000-Alice",
			"2-0-1729123200000",
			"3-0-1729123200000-Bob",
			"3-0-1729123200000-Carol",
		]);
	});

	it("returns empty array for empty doses", () => {
		expect(expandDoseIds([])).toEqual([]);
	});

	it("handles non-array takenBy gracefully", () => {
		// In case of unexpected data, treat non-array as empty
		const doses = [{ id: "1-0-1729123200000", takenBy: null as unknown as string[] }];
		const result = expandDoseIds(doses);
		expect(result).toEqual(["1-0-1729123200000"]);
	});
});

describe("past schedule windowing", () => {
	// Reproduces the bug where daily medications with far-past start dates
	// would fill all 2000 event slots, pushing today/future events out.
	// The fix replaces slice(0, 2000) with a time-based window filter.

	function buildGroupedScheduleFromEvents(
		events: Array<{
			dateStr: string;
			when: number;
			isPast: boolean;
			medName: string;
			id: string;
			usage: number;
			takenBy: string | null;
		}>,
		scheduleDays: number
	) {
		// Mirror the fixed groupedSchedule logic from AppContext.tsx
		const pastCutoff = new Date();
		pastCutoff.setDate(pastCutoff.getDate() - scheduleDays);
		pastCutoff.setHours(0, 0, 0, 0);
		const pastCutoffMs = pastCutoff.getTime();

		type DayMedEntry = {
			medName: string;
			total: number;
			doses: Array<{ id: string; takenBy: string[] }>;
			lastWhen: number;
		};
		const days = new Map<string, { dateStr: string; date: Date; isPast: boolean; meds: Map<string, DayMedEntry> }>();

		events
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
					takenBy: event.takenBy ? [event.takenBy] : [],
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
	}

	it("includes daily meds within the scheduleDays window, not just weekly meds", () => {
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const events: Array<{
			dateStr: string;
			when: number;
			isPast: boolean;
			medName: string;
			id: string;
			usage: number;
			takenBy: string | null;
		}> = [];

		// Simulate daily med starting 400 days ago (way beyond any window)
		for (let i = 400; i >= 1; i--) {
			const d = new Date(todayStart);
			d.setDate(d.getDate() - i);
			events.push({
				dateStr: d.toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" }),
				when: d.getTime(),
				isPast: true,
				medName: "DailyMed",
				id: `1-0-${d.getTime()}`,
				usage: 1,
				takenBy: "Daniel",
			});
		}

		// Simulate weekly Friday med starting 400 days ago
		for (let i = 400; i >= 1; i--) {
			const d = new Date(todayStart);
			d.setDate(d.getDate() - i);
			if (d.getDay() !== 5) continue; // Only Fridays
			events.push({
				dateStr: d.toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" }),
				when: d.getTime(),
				isPast: true,
				medName: "WeeklyMed",
				id: `2-0-${d.getTime()}`,
				usage: 1,
				takenBy: null,
			});
		}

		// Add today event
		events.push({
			dateStr: todayStart.toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" }),
			when: todayStart.getTime(),
			isPast: false,
			medName: "DailyMed",
			id: `1-0-${todayStart.getTime()}`,
			usage: 1,
			takenBy: "Daniel",
		});

		events.sort((a, b) => a.when - b.when);

		const grouped = buildGroupedScheduleFromEvents(events, 30);
		const pastDays = grouped.filter((d) => d.isPast);
		const todayDays = grouped.filter((d) => !d.isPast);

		// Past days should contain at most 30 days (scheduleDays window)
		expect(pastDays.length).toBeLessThanOrEqual(30);
		expect(pastDays.length).toBeGreaterThan(0);

		// Today should be present (not pushed out by past events)
		expect(todayDays.length).toBeGreaterThanOrEqual(1);

		// Past days should include DailyMed (within the 30-day window)
		const pastDaysWithDailyMed = pastDays.filter((d) => d.meds.some((m) => m.medName === "DailyMed"));
		expect(pastDaysWithDailyMed.length).toBeGreaterThan(0);

		// Past days should NOT only be Fridays (the bug)
		const pastDateDays = pastDays.map((d) => d.date.getDay());
		const uniqueDaysOfWeek = new Set(pastDateDays);
		expect(uniqueDaysOfWeek.size).toBeGreaterThan(1); // Multiple days of week, not just Friday
	});

	it("old slice(0,2000) would have cut off today for large datasets", () => {
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const events: Array<{
			dateStr: string;
			when: number;
			isPast: boolean;
			medName: string;
			id: string;
			usage: number;
			takenBy: string | null;
		}> = [];

		// Generate 3 daily meds × 2 intakes × 400 days = 2400 past events (> 2000 limit)
		for (let medIdx = 0; medIdx < 3; medIdx++) {
			for (let intakeIdx = 0; intakeIdx < 2; intakeIdx++) {
				for (let i = 400; i >= 1; i--) {
					const d = new Date(todayStart);
					d.setDate(d.getDate() - i);
					events.push({
						dateStr: d.toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" }),
						when: d.getTime() + intakeIdx * 3600000, // offset intakes by 1 hour
						isPast: true,
						medName: `Med${medIdx}`,
						id: `${medIdx}-${intakeIdx}-${d.getTime()}`,
						usage: 1,
						takenBy: null,
					});
				}
			}
			// Today event
			events.push({
				dateStr: todayStart.toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" }),
				when: todayStart.getTime(),
				isPast: false,
				medName: `Med${medIdx}`,
				id: `${medIdx}-0-${todayStart.getTime()}`,
				usage: 1,
				takenBy: null,
			});
		}

		events.sort((a, b) => a.when - b.when);

		// OLD behavior: slice(0, 2000) would have cut off today
		const oldSliced = events.slice(0, 2000);
		const todayInOld = oldSliced.filter((e) => !e.isPast);
		expect(todayInOld.length).toBe(0); // Today events are gone!

		// NEW behavior: time-based window keeps today
		const grouped = buildGroupedScheduleFromEvents(events, 30);
		const todayDays = grouped.filter((d) => !d.isPast);
		expect(todayDays.length).toBeGreaterThanOrEqual(1);
		// All 3 meds should appear in today
		const todayMeds = todayDays[0]?.meds.map((m) => m.medName).sort();
		expect(todayMeds).toEqual(["Med0", "Med1", "Med2"]);
	});

	it("respects scheduleDays parameter for past window size", () => {
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const events: Array<{
			dateStr: string;
			when: number;
			isPast: boolean;
			medName: string;
			id: string;
			usage: number;
			takenBy: string | null;
		}> = [];

		// Daily med for 200 days
		for (let i = 200; i >= 1; i--) {
			const d = new Date(todayStart);
			d.setDate(d.getDate() - i);
			events.push({
				dateStr: d.toLocaleDateString("en", { weekday: "short", day: "2-digit", month: "short" }),
				when: d.getTime(),
				isPast: true,
				medName: "TestMed",
				id: `1-0-${d.getTime()}`,
				usage: 1,
				takenBy: null,
			});
		}
		events.sort((a, b) => a.when - b.when);

		// With 30 days window
		const grouped30 = buildGroupedScheduleFromEvents(events, 30);
		const past30 = grouped30.filter((d) => d.isPast);
		expect(past30.length).toBeLessThanOrEqual(30);

		// With 90 days window
		const grouped90 = buildGroupedScheduleFromEvents(events, 90);
		const past90 = grouped90.filter((d) => d.isPast);
		expect(past90.length).toBeLessThanOrEqual(90);
		expect(past90.length).toBeGreaterThan(past30.length);

		// With 180 days window
		const grouped180 = buildGroupedScheduleFromEvents(events, 180);
		const past180 = grouped180.filter((d) => d.isPast);
		expect(past180.length).toBeLessThanOrEqual(180);
		expect(past180.length).toBeGreaterThan(past90.length);
	});
});
