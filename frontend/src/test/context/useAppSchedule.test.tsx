import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppSchedule } from "../../context/useAppSchedule";
import type { Settings } from "../../hooks/useSettings";
import type { Medication } from "../../types";

const FIXED_NOW = new Date(2026, 4, 15, 12, 0, 0, 0);
const SYSTEM_LOCALE = "en-US";

function localDateTime(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function createMedication(): Medication {
	const start = new Date(FIXED_NOW);
	start.setDate(start.getDate() - 3);
	start.setHours(8, 0, 0, 0);
	const eveningStart = new Date(start);
	eveningStart.setHours(20);

	return {
		id: 11,
		name: "Aspirin",
		takenBy: ["Max"],
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 1000,
		looseTablets: 0,
		blisters: [],
		intakes: [
			{
				usage: 1,
				every: 1,
				start: localDateTime(start),
				takenBy: null,
				intakeRemindersEnabled: false,
			},
			{
				usage: 1,
				every: 1,
				start: localDateTime(eveningStart),
				takenBy: null,
				intakeRemindersEnabled: false,
			},
		],
		updatedAt: null,
	};
}

function createSettings(overrides: Partial<Settings> = {}): Settings {
	return {
		reminderDaysBefore: 7,
		stockCalculationMode: "manual",
		lowStockDays: 10,
		normalStockDays: 30,
		highStockDays: 60,
		expiryWarningDays: 30,
		reminderHour: 6,
		...overrides,
	} as Settings;
}

function createDoses(takenDoses: Set<string> = new Set(), dismissedDoses: Set<string> = new Set()) {
	return {
		takenDoses,
		takenDoseTimestamps: new Map<string, number>(),
		dismissedDoses,
	};
}

describe("useAppSchedule", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(FIXED_NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("groups local yesterday, today, and tomorrow and excludes taken or dismissed past doses", () => {
		const meds = [createMedication()];
		const { result, rerender } = renderHook(
			({ doses }) =>
				useAppSchedule({
					meds,
					systemLocale: SYSTEM_LOCALE,
					settings: createSettings(),
					doses,
					scheduleDays: 2,
				}),
			{ initialProps: { doses: createDoses() } }
		);

		expect(result.current.pastDays.map((day) => day.date.getDate())).toEqual([13, 14]);
		expect(result.current.todayDay?.date.getDate()).toBe(15);
		expect(result.current.todayDay?.meds[0].doses).toHaveLength(2);
		expect(result.current.futureDays.map((day) => day.date.getDate())).toEqual([16, 17]);

		const yesterday = result.current.pastDays.find((day) => day.date.getDate() === 14);
		const cutoffDay = result.current.pastDays.find((day) => day.date.getDate() === 13);
		expect(yesterday).toBeDefined();
		expect(cutoffDay).toBeDefined();
		const yesterdayDoseIds = yesterday?.meds[0].doses.map((dose) => dose.id) ?? [];
		const missedCutoffDayDoseIds = cutoffDay?.meds[0].doses.map((dose) => dose.id) ?? [];

		rerender({
			doses: createDoses(new Set([yesterdayDoseIds[0]]), new Set([yesterdayDoseIds[1]])),
		});

		expect(result.current.missedPastDoseIds).toEqual(missedCutoffDayDoseIds);
	});

	it("keeps derived references for unrelated settings changes and refreshes schedule bounds when requested", () => {
		const meds = [createMedication()];
		const settings = createSettings();
		const doses = createDoses();
		const { result, rerender } = renderHook(
			({ currentSettings, scheduleDays }) =>
				useAppSchedule({
					meds,
					systemLocale: SYSTEM_LOCALE,
					settings: currentSettings,
					doses,
					scheduleDays,
				}),
			{ initialProps: { currentSettings: settings, scheduleDays: 2 } }
		);

		const initial = result.current;
		rerender({ currentSettings: createSettings({ reminderHour: 7 }), scheduleDays: 2 });

		expect(result.current.schedule).toBe(initial.schedule);
		expect(result.current.coverage).toBe(initial.coverage);
		expect(result.current.groupedSchedule).toBe(initial.groupedSchedule);
		expect(result.current.pastDays).toBe(initial.pastDays);
		expect(result.current.futureDays).toBe(initial.futureDays);

		act(() => {
			rerender({ currentSettings: createSettings({ reminderHour: 7 }), scheduleDays: 3 });
		});

		expect(result.current.schedule).toBe(initial.schedule);
		expect(result.current.groupedSchedule).not.toBe(initial.groupedSchedule);
		expect(result.current.pastDays.map((day) => day.date.getDate())).toEqual([12, 13, 14]);
		expect(result.current.futureDays.map((day) => day.date.getDate())).toEqual([16, 17, 18]);
	});
});
