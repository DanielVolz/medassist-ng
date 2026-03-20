import type { Blister, Intake, ScheduleMode, WeekdayCode } from "../types";

type MedicationScheduleSource = {
	intakes?: Intake[] | null;
	blisters: Blister[];
	intakeRemindersEnabled?: boolean;
};

type IntakeScheduleLike = {
	every?: number | string | null;
	scheduleMode?: ScheduleMode | null;
	weekdays?: ReadonlyArray<WeekdayCode> | null;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const WEEKDAY_CODES: WeekdayCode[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const WEEKDAY_LABELS: Record<WeekdayCode, { short: string; long: string; ics: string }> = {
	mon: { short: "form.blisters.weekdaysShort.mon", long: "form.blisters.weekdaysLong.mon", ics: "MO" },
	tue: { short: "form.blisters.weekdaysShort.tue", long: "form.blisters.weekdaysLong.tue", ics: "TU" },
	wed: { short: "form.blisters.weekdaysShort.wed", long: "form.blisters.weekdaysLong.wed", ics: "WE" },
	thu: { short: "form.blisters.weekdaysShort.thu", long: "form.blisters.weekdaysLong.thu", ics: "TH" },
	fri: { short: "form.blisters.weekdaysShort.fri", long: "form.blisters.weekdaysLong.fri", ics: "FR" },
	sat: { short: "form.blisters.weekdaysShort.sat", long: "form.blisters.weekdaysLong.sat", ics: "SA" },
	sun: { short: "form.blisters.weekdaysShort.sun", long: "form.blisters.weekdaysLong.sun", ics: "SU" },
};

export function normalizeWeekdays(weekdays?: ReadonlyArray<WeekdayCode> | null): WeekdayCode[] {
	if (!Array.isArray(weekdays) || weekdays.length === 0) return [];
	const normalizedSet = new Set<WeekdayCode>();
	for (const day of weekdays) {
		if (WEEKDAY_CODES.includes(day)) {
			normalizedSet.add(day);
		}
	}
	return WEEKDAY_CODES.filter((day) => normalizedSet.has(day));
}

export function hasSelectedWeekdays(weekdays?: ReadonlyArray<WeekdayCode> | null): boolean {
	return normalizeWeekdays(weekdays).length > 0;
}

export function getIntakeScheduleMode(schedule: IntakeScheduleLike): ScheduleMode {
	return schedule.scheduleMode === "weekdays" ? "weekdays" : "interval";
}

export function getNormalizedInterval(schedule: IntakeScheduleLike): number {
	const parsedEvery = Number(schedule.every);
	if (!Number.isFinite(parsedEvery) || parsedEvery <= 0) return 1;
	return Math.floor(parsedEvery);
}

export function getWeekdayCode(date: Date): WeekdayCode {
	return WEEKDAY_CODES[(date.getDay() + 6) % 7];
}

export function getWeekdayLabel(day: WeekdayCode, t: Translate, format: "short" | "long" = "short"): string {
	return t(WEEKDAY_LABELS[day][format]);
}

export function getWeekdayIcsCode(day: WeekdayCode): string {
	return WEEKDAY_LABELS[day].ics;
}

export function toggleWeekdaySelection(
	weekdays: ReadonlyArray<WeekdayCode> | null | undefined,
	day: WeekdayCode
): WeekdayCode[] {
	const normalized = normalizeWeekdays(weekdays);
	if (normalized.includes(day)) {
		return normalized.filter((entry) => entry !== day);
	}
	return normalizeWeekdays([...normalized, day]);
}

export function getMedicationIntakes(med: MedicationScheduleSource): Intake[] {
	if (med.intakes && med.intakes.length > 0) {
		return med.intakes;
	}
	return med.blisters.map((blister) => ({
		usage: blister.usage,
		every: blister.every,
		start: blister.start,
		scheduleMode: "interval",
		weekdays: [],
		intakeUnit: null,
		takenBy: null,
		intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
	}));
}

export function iterateIntakeOccurrences(
	intake: IntakeScheduleLike,
	start: Date,
	end: Date,
	callback: (occurrence: Date) => void
): void {
	if (start > end) return;

	if (getIntakeScheduleMode(intake) === "weekdays") {
		const weekdays = normalizeWeekdays(intake.weekdays);
		if (weekdays.length === 0) return;

		const cursor = new Date(start);
		while (cursor <= end) {
			if (weekdays.includes(getWeekdayCode(cursor))) {
				callback(new Date(cursor));
			}
			cursor.setDate(cursor.getDate() + 1);
		}
		return;
	}

	const interval = getNormalizedInterval(intake);
	const cursor = new Date(start);
	while (cursor <= end) {
		callback(new Date(cursor));
		cursor.setDate(cursor.getDate() + interval);
	}
}

export function getIntakeDailyRate(schedule: IntakeScheduleLike): number {
	if (getIntakeScheduleMode(schedule) === "weekdays") {
		return normalizeWeekdays(schedule.weekdays).length / 7;
	}
	return 1 / getNormalizedInterval(schedule);
}

export function getIntakeFrequencyText(schedule: IntakeScheduleLike, t: Translate): string {
	if (getIntakeScheduleMode(schedule) === "weekdays") {
		return normalizeWeekdays(schedule.weekdays)
			.map((day) => getWeekdayLabel(day, t, "short"))
			.join(", ");
	}

	const every = getNormalizedInterval(schedule);
	return every === 1 ? t("common.daily") : t("common.everyNDays", { count: every });
}
