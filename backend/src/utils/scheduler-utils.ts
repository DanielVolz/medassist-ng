/**
 * Shared utility functions for scheduler services.
 * Exported separately to allow testing without side effects.
 */

import { getDateLocale, type Language } from "../i18n/translations.js";
import { isLiquidContainerPackageType, isTubePackageType } from "./package-profiles.js";

export const CANONICAL_WEEKDAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type Weekday = (typeof CANONICAL_WEEKDAY_ORDER)[number];
export type IntakeScheduleMode = "interval" | "weekdays";

type ScheduleLike = {
	every: number;
	start: string;
	scheduleMode?: IntakeScheduleMode;
	weekdays?: Weekday[];
};

// Legacy type - individual blister schedule (DEPRECATED: use Intake instead)
export type Blister = {
	usage: number;
	every: number;
	start: string;
	scheduleMode?: IntakeScheduleMode;
	weekdays?: Weekday[];
};

// New unified intake type with per-intake takenBy
export type Intake = {
	usage: number;
	every: number;
	start: string;
	scheduleMode?: IntakeScheduleMode;
	weekdays?: Weekday[];
	intakeUnit?: "ml" | "tsp" | "tbsp" | null;
	takenBy: string | null; // Person taking this specific intake (null = use medication-level takenBy)
	intakeRemindersEnabled: boolean;
};

const isValidIntakeUnit = (value: unknown): value is "ml" | "tsp" | "tbsp" =>
	value === "ml" || value === "tsp" || value === "tbsp";

const weekdayToJavascriptDay: Record<Weekday, number> = {
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
	sun: 0,
};

function isWeekday(value: unknown): value is Weekday {
	return typeof value === "string" && CANONICAL_WEEKDAY_ORDER.includes(value as Weekday);
}

function normalizeScheduleMode(value: unknown): IntakeScheduleMode {
	return value === "weekdays" ? "weekdays" : "interval";
}

function toDateOnly(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function getDateOnlyTimestamp(date: Date): number {
	return toDateOnly(date).getTime();
}

export function getWeekdayFromDate(date: Date): Weekday {
	const weekday = CANONICAL_WEEKDAY_ORDER.find((entry) => weekdayToJavascriptDay[entry] === date.getDay());
	return weekday ?? "mon";
}

export function getWeekdayFromStart(start: string): Weekday {
	const startDate = parseLocalDateTime(start);
	if (Number.isNaN(startDate.getTime())) {
		return "mon";
	}
	return getWeekdayFromDate(startDate);
}

export function normalizeWeekdays(value: unknown, start: string): Weekday[] {
	if (!Array.isArray(value)) {
		return [getWeekdayFromStart(start)];
	}

	const uniqueWeekdays = new Set<Weekday>();
	for (const weekday of value) {
		if (isWeekday(weekday)) {
			uniqueWeekdays.add(weekday);
		}
	}

	const normalized = CANONICAL_WEEKDAY_ORDER.filter((weekday) => uniqueWeekdays.has(weekday));
	return normalized.length > 0 ? normalized : [getWeekdayFromStart(start)];
}

function createOccurrenceAtDate(date: Date, startDate: Date): number {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		startDate.getHours(),
		startDate.getMinutes(),
		startDate.getSeconds(),
		startDate.getMilliseconds()
	).getTime();
}

function getNormalizedWeekdays(schedule: ScheduleLike): Weekday[] {
	if (schedule.scheduleMode !== "weekdays") {
		return [];
	}

	if (schedule.weekdays && schedule.weekdays.length > 0) {
		return schedule.weekdays;
	}

	return [getWeekdayFromStart(schedule.start)];
}

export function getAverageOccurrencesPerDay(
	schedule: Pick<ScheduleLike, "every" | "start" | "scheduleMode" | "weekdays">
): number {
	if (schedule.scheduleMode === "weekdays") {
		return getNormalizedWeekdays(schedule).length / 7;
	}

	return 1 / Math.max(1, schedule.every);
}

export function getMaxScheduledGapDays(
	schedule: Pick<ScheduleLike, "every" | "start" | "scheduleMode" | "weekdays">
): number {
	if (schedule.scheduleMode !== "weekdays") {
		return Math.max(1, schedule.every);
	}

	const weekdays = getNormalizedWeekdays(schedule).map((weekday) => CANONICAL_WEEKDAY_ORDER.indexOf(weekday));
	if (weekdays.length === 0) {
		return 7;
	}

	let maxGap = 0;
	for (let index = 0; index < weekdays.length; index++) {
		const current = weekdays[index];
		const next = weekdays[(index + 1) % weekdays.length];
		const gap = index === weekdays.length - 1 ? next + 7 - current : next - current;
		if (gap > maxGap) {
			maxGap = gap;
		}
	}

	return maxGap || 7;
}

export function getScheduleMatchWindowMs(
	schedule: Pick<ScheduleLike, "every" | "start" | "scheduleMode" | "weekdays">
): number {
	return (getMaxScheduledGapDays(schedule) * 86_400_000) / 2;
}

export function getNextScheduledOccurrenceTime(
	schedule: Pick<ScheduleLike, "every" | "start" | "scheduleMode" | "weekdays">,
	fromMs: number,
	inclusive: boolean = true
): number | null {
	const startDate = parseLocalDateTime(schedule.start);
	const startTime = startDate.getTime();
	if (Number.isNaN(startTime)) {
		return null;
	}

	const lowerBound = inclusive ? fromMs : fromMs + 1;
	if (schedule.scheduleMode !== "weekdays") {
		const period = Math.max(1, schedule.every) * 86_400_000;
		if (startTime >= lowerBound) {
			return startTime;
		}

		const intervals = Math.ceil((lowerBound - startTime) / period);
		return startTime + intervals * period;
	}

	const candidateStart = Math.max(lowerBound, startTime);
	const candidateDateOnly = toDateOnly(new Date(candidateStart));
	let nextOccurrence: number | null = null;

	for (const weekday of getNormalizedWeekdays(schedule)) {
		const candidateDate = new Date(candidateDateOnly);
		const offsetDays = (weekdayToJavascriptDay[weekday] - candidateDate.getDay() + 7) % 7;
		candidateDate.setDate(candidateDate.getDate() + offsetDays);

		let occurrenceMs = createOccurrenceAtDate(candidateDate, startDate);
		if (occurrenceMs < candidateStart) {
			candidateDate.setDate(candidateDate.getDate() + 7);
			occurrenceMs = createOccurrenceAtDate(candidateDate, startDate);
		}

		if (nextOccurrence === null || occurrenceMs < nextOccurrence) {
			nextOccurrence = occurrenceMs;
		}
	}

	return nextOccurrence;
}

export function forEachScheduledOccurrenceInRange(
	schedule: Pick<ScheduleLike, "every" | "start" | "scheduleMode" | "weekdays">,
	rangeStartMs: number,
	rangeEndMs: number,
	callback: (occurrenceMs: number) => void
): void {
	if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs < rangeStartMs) {
		return;
	}

	const startDate = parseLocalDateTime(schedule.start);
	const startTime = startDate.getTime();
	if (Number.isNaN(startTime) || rangeEndMs < startTime) {
		return;
	}

	if (schedule.scheduleMode !== "weekdays") {
		const period = Math.max(1, schedule.every) * 86_400_000;
		let occurrenceMs = startTime;
		if (occurrenceMs < rangeStartMs) {
			const intervals = Math.ceil((rangeStartMs - occurrenceMs) / period);
			occurrenceMs += intervals * period;
		}

		for (; occurrenceMs <= rangeEndMs; occurrenceMs += period) {
			if (occurrenceMs >= rangeStartMs) {
				callback(occurrenceMs);
			}
		}
		return;
	}

	const lowerBound = Math.max(rangeStartMs, startTime);
	const firstDateOnly = toDateOnly(new Date(lowerBound));

	for (const weekday of getNormalizedWeekdays(schedule)) {
		const occurrenceDate = new Date(firstDateOnly);
		const offsetDays = (weekdayToJavascriptDay[weekday] - occurrenceDate.getDay() + 7) % 7;
		occurrenceDate.setDate(occurrenceDate.getDate() + offsetDays);

		let occurrenceMs = createOccurrenceAtDate(occurrenceDate, startDate);
		if (occurrenceMs < lowerBound) {
			occurrenceDate.setDate(occurrenceDate.getDate() + 7);
			occurrenceMs = createOccurrenceAtDate(occurrenceDate, startDate);
		}

		while (occurrenceMs <= rangeEndMs) {
			callback(occurrenceMs);
			occurrenceDate.setDate(occurrenceDate.getDate() + 7);
			occurrenceMs = createOccurrenceAtDate(occurrenceDate, startDate);
		}
	}
}

export function countScheduledOccurrencesInRange(
	schedule: Pick<ScheduleLike, "every" | "start" | "scheduleMode" | "weekdays">,
	rangeStartMs: number,
	rangeEndMs: number
): { count: number; lastOccurrenceMs: number | null } {
	let count = 0;
	let lastOccurrenceMs: number | null = null;

	forEachScheduledOccurrenceInRange(schedule, rangeStartMs, rangeEndMs, (occurrenceMs) => {
		count += 1;
		if (lastOccurrenceMs === null || occurrenceMs > lastOccurrenceMs) {
			lastOccurrenceMs = occurrenceMs;
		}
	});

	return { count, lastOccurrenceMs };
}

export function normalizeIntake(
	value: {
		usage?: unknown;
		every?: unknown;
		start?: unknown;
		scheduleMode?: unknown;
		weekdays?: unknown;
		intakeUnit?: unknown;
		takenBy?: unknown;
		intakeRemindersEnabled?: unknown;
	},
	defaultIntakeRemindersEnabled: boolean = false
): Intake {
	const start = typeof value.start === "string" ? value.start : new Date().toISOString();
	const scheduleMode = normalizeScheduleMode(value.scheduleMode);
	let every = 1;
	if (scheduleMode !== "weekdays") {
		if (typeof value.every === "number" && Number.isFinite(value.every) && value.every >= 1) {
			every = value.every;
		}
	}

	return {
		usage: typeof value.usage === "number" && Number.isFinite(value.usage) ? value.usage : 0,
		every,
		start,
		scheduleMode,
		weekdays: scheduleMode === "weekdays" ? normalizeWeekdays(value.weekdays, start) : [],
		intakeUnit: isValidIntakeUnit(value.intakeUnit) ? value.intakeUnit : null,
		takenBy: typeof value.takenBy === "string" && value.takenBy.trim() ? value.takenBy.trim() : null,
		intakeRemindersEnabled:
			typeof value.intakeRemindersEnabled === "boolean" ? value.intakeRemindersEnabled : defaultIntakeRemindersEnabled,
	};
}

/**
 * Normalize intake usage for stock math.
 *
 * Stock semantics:
 * - tube: no automatic depletion (unknown per-application amount)
 * - liquid_container/liquid forms: convert tsp/tbsp to ml
 * - others: usage as-is
 */
export function normalizeIntakeUsageForStock(
	intake: Pick<Intake, "usage" | "intakeUnit">,
	medicationForm?: string | null,
	packageType?: string | null
): number {
	const usage = Number(intake.usage);
	if (!Number.isFinite(usage) || usage <= 0) return 0;
	if (isTubePackageType(packageType)) return 0;

	const isLiquidStock = isLiquidContainerPackageType(packageType) || medicationForm === "liquid";
	if (!isLiquidStock) return usage;

	if (intake.intakeUnit === "tsp") return usage * 5;
	if (intake.intakeUnit === "tbsp") return usage * 15;
	return usage;
}

// =============================================================================
// Timezone utilities
// =============================================================================

/** Get current timezone from TZ env variable or default to UTC */
export function getTimezone(): string {
	return process.env.TZ || "UTC";
}

/** Format a date in the configured timezone */
export function formatInTimezone(date: Date, tz?: string): string {
	return date.toLocaleString("de-DE", {
		timeZone: tz ?? getTimezone(),
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Get current hour in the configured timezone */
export function getCurrentHourInTimezone(tz?: string): number {
	const now = new Date();
	const timeStr = now.toLocaleString("en-US", {
		timeZone: tz ?? getTimezone(),
		hour: "numeric",
		hour12: false,
	});
	return parseInt(timeStr, 10);
}

/** Get today's date string in the configured timezone (YYYY-MM-DD) */
export function getTodayInTimezone(tz?: string): string {
	const now = new Date();
	const parts = now.toLocaleDateString("en-CA", { timeZone: tz ?? getTimezone() }).split("-");
	return parts.join("-"); // YYYY-MM-DD format
}

/** Calculate the next scheduled time for a given reminder hour */
export function getNextScheduledTime(reminderHour: number, tz?: string): Date {
	const now = new Date();
	const timezone = tz ?? getTimezone();

	// Get current time components in the target timezone
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});

	const parts = formatter.formatToParts(now);
	const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "0";

	const currentHour = parseInt(getPart("hour"), 10);
	const currentMinute = parseInt(getPart("minute"), 10);

	// Calculate if we need tomorrow
	const needTomorrow = currentHour > reminderHour || (currentHour === reminderHour && currentMinute > 0);

	// Handle month overflow simply by adding a day to now if needed
	let targetDate: Date;
	if (needTomorrow) {
		targetDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	} else {
		targetDate = new Date(now);
	}

	// Get the target date's date string in the timezone
	const targetFormatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const [targetYear, targetMonth, targetDay] = targetFormatter.format(targetDate).split("-").map(Number);

	// Now we need to find the UTC time that corresponds to reminderHour:00 on targetDate in the target timezone
	// Use a search approach: start with a guess and adjust
	const guessUtc = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, reminderHour, 0, 0, 0));

	// Check what hour this UTC time corresponds to in the target timezone
	const checkFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		hour12: false,
	});

	// Adjust based on the difference
	const guessHour = parseInt(checkFormatter.format(guessUtc), 10);
	const hourDiff = guessHour - reminderHour;

	// Apply correction (if guessHour is higher, we need to subtract time)
	const correctedUtc = new Date(guessUtc.getTime() - hourDiff * 60 * 60 * 1000);

	return correctedUtc;
}

/** Calculate milliseconds until next check at the given reminder hour */
export function getMsUntilNextCheck(reminderHour: number, tz?: string): number {
	const next = getNextScheduledTime(reminderHour, tz);
	const msUntilNext = next.getTime() - Date.now();
	if (msUntilNext <= 0) {
		return msUntilNext + 24 * 60 * 60 * 1000;
	}
	return msUntilNext;
}

// =============================================================================
// Blister/medication parsing utilities
// =============================================================================

/**
 * Parse an ISO datetime string to local timestamp.
 * Extracts date/time components directly from the string to avoid
 * timezone conversion issues with Z suffix.
 *
 * "2026-01-23T20:55:00" → treated as local time 20:55
 * "2026-01-23T20:55:00.000Z" → also treated as local time 20:55 (Z ignored)
 */
export function parseLocalDateTime(isoString: string): Date {
	// Extract components: YYYY-MM-DDTHH:MM:SS (ignore Z and milliseconds)
	const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/);
	if (!match) {
		// Fallback to Date parsing if format doesn't match
		return new Date(isoString);
	}

	const [, year, month, day, hour, minute, second] = match;
	// Create date using local time interpretation (no UTC conversion)
	return new Date(
		parseInt(year, 10),
		parseInt(month, 10) - 1, // Month is 0-indexed
		parseInt(day, 10),
		parseInt(hour, 10),
		parseInt(minute, 10),
		parseInt(second ?? "0", 10)
	);
}

/** Parse blister schedules from JSON columns (DEPRECATED: use parseIntakesJson instead) */
export function parseBlisters(row: { usageJson: string; everyJson: string; startJson: string }): Blister[] {
	try {
		const usage = JSON.parse(row.usageJson) as number[];
		const every = JSON.parse(row.everyJson) as number[];
		const start = JSON.parse(row.startJson) as string[];
		const len = Math.min(usage.length, every.length, start.length);
		const blisters: Blister[] = [];
		for (let i = 0; i < len; i++) {
			blisters.push({ usage: usage[i], every: every[i], start: start[i] });
		}
		return blisters;
	} catch {
		return [];
	}
}

/**
 * Parse intakes from the new unified intakesJson format.
 * Falls back to legacy parallel arrays if intakesJson is empty.
 * @param intakesJson - The new unified JSON string
 * @param legacyRow - Optional legacy row with usageJson, everyJson, startJson for fallback
 * @param medicationIntakeRemindersEnabled - Medication-level intakeRemindersEnabled (fallback for legacy)
 */
export function parseIntakesJson(
	intakesJson: string | null | undefined,
	legacyRow?: { usageJson: string; everyJson: string; startJson: string },
	medicationIntakeRemindersEnabled?: boolean
): Intake[] {
	// Try new format first
	if (intakesJson) {
		try {
			const parsed = JSON.parse(intakesJson);
			if (Array.isArray(parsed) && parsed.length > 0) {
				return parsed.map((intake: Record<string, unknown>) => normalizeIntake(intake));
			}
		} catch {
			// Fall through to legacy parsing
		}
	}

	// Fallback to legacy parallel arrays
	if (legacyRow) {
		const blisters = parseBlisters(legacyRow);
		return blisters.map((b) =>
			normalizeIntake(
				{
					usage: b.usage,
					every: b.every,
					start: b.start,
					intakeUnit: null,
					takenBy: null,
				},
				medicationIntakeRemindersEnabled ?? false
			)
		);
	}

	return [];
}

/**
 * Convert intakes to legacy blister format (for backward compatibility)
 */
export function intakesToBlisters(intakes: Intake[]): Blister[] {
	return intakes.map((i) => ({ usage: i.usage, every: i.every, start: i.start }));
}

/** Parse takenByJson to array of strings */
export function parseTakenByJson(takenByJson: string | null | undefined): string[] {
	if (!takenByJson) return [];
	try {
		const parsed = JSON.parse(takenByJson);
		return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === "string" && s.trim()) : [];
	} catch {
		return [];
	}
}

/**
 * Get all unique takenBy values from both medication-level and intake-level.
 * Used for filtering and sharing functionality.
 */
export function getAllTakenByForMedication(medicationTakenBy: string[], intakes: Intake[]): string[] {
	const allPeople = new Set<string>(medicationTakenBy);
	for (const intake of intakes) {
		if (intake.takenBy) {
			allPeople.add(intake.takenBy);
		}
	}
	return Array.from(allPeople);
}

/**
 * Check if a person takes this medication (either via medication-level or intake-level takenBy).
 */
export function personTakesMedication(person: string, medicationTakenBy: string[], intakes: Intake[]): boolean {
	if (person === "all") return medicationTakenBy.length > 0 || intakes.some((intake) => intake.takenBy !== null);
	if (medicationTakenBy.includes(person)) return true;
	return intakes.some((intake) => intake.takenBy === person);
}

// =============================================================================
// Stock calculation utilities
// =============================================================================

/** Calculate daily usage from blisters */
export function calculateDailyUsage(blisters: Blister[]): number {
	return blisters.reduce((sum, blister) => sum + blister.usage * getAverageOccurrencesPerDay(blister), 0);
}

/** Calculate depletion information for a medication */
export function calculateDepletionInfo(
	med: { count: number; blisters: Blister[] },
	language: Language
): { daysLeft: number | null; depletionDate: string | null } {
	const dailyUsage = calculateDailyUsage(med.blisters);
	if (dailyUsage <= 0) return { daysLeft: null, depletionDate: null };

	const daysLeft = Math.floor(med.count / dailyUsage);
	const depletionMs = Date.now() + daysLeft * 86_400_000;
	const depletionDate = new Date(depletionMs).toLocaleDateString(getDateLocale(language), {
		weekday: "short",
		day: "2-digit",
		month: "short",
	});

	return { daysLeft, depletionDate };
}

// =============================================================================
// Intake reminder utilities
// =============================================================================

export type UpcomingIntake = {
	medName: string;
	medicationId?: number;
	blisterIndex?: number;
	usage: number;
	intakeTime: Date;
	intakeTimeStr: string;
	takenBy: string | null; // Single person for this intake (null = no specific person)
	pillWeightMg: number | null;
	doseUnit?: string;
};

/**
 * Get all intakes for today (past and future) - used for repeat reminders.
 * Returns all intakes scheduled for today in user's timezone.
 * Now uses per-intake takenBy instead of medication-level.
 */
export function getTodaysIntakes(
	medName: string,
	intakes: Intake[],
	_medicationTakenBy: string[], // Medication-level takenBy as fallback
	pillWeightMg: number | null,
	locale: string,
	tz?: string,
	medicationId?: number,
	doseUnit?: string
): UpcomingIntake[] {
	const timezone = tz ?? getTimezone();
	const now = new Date();

	// Get start and end of today in user's timezone
	const todayStart = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
	todayStart.setHours(0, 0, 0, 0);

	const todayEnd = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
	todayEnd.setHours(23, 59, 59, 999);

	const result: UpcomingIntake[] = [];

	for (let blisterIdx = 0; blisterIdx < intakes.length; blisterIdx++) {
		const intake = intakes[blisterIdx];
		// Determine takenBy for this intake
		// If intake has its own takenBy, use it; otherwise null (no specific person)
		const effectiveTakenBy = intake.takenBy || null;

		forEachScheduledOccurrenceInRange(intake, todayStart.getTime(), todayEnd.getTime(), (occurrenceMs) => {
			const intakeDate = new Date(occurrenceMs);
			result.push({
				medName,
				medicationId,
				blisterIndex: blisterIdx,
				usage: intake.usage,
				intakeTime: intakeDate,
				intakeTimeStr: intakeDate.toLocaleTimeString(locale, {
					hour: "2-digit",
					minute: "2-digit",
					timeZone: timezone,
				}),
				takenBy: effectiveTakenBy,
				pillWeightMg,
				doseUnit,
			});
		});
	}

	return result.sort((left, right) => left.intakeTime.getTime() - right.intakeTime.getTime());
}

/**
 * Get upcoming intakes that fall within the reminder window.
 * Returns intakes that should be notified about right now.
 * Now uses per-intake takenBy instead of medication-level.
 */
export function getUpcomingIntakes(
	medName: string,
	intakes: Intake[],
	minutesBefore: number,
	_medicationTakenBy: string[], // Medication-level takenBy as fallback
	pillWeightMg: number | null,
	locale: string,
	tz?: string,
	nowOverride?: number,
	medicationId?: number,
	doseUnit?: string
): UpcomingIntake[] {
	const now = nowOverride ?? Date.now();
	const timezone = tz ?? getTimezone();

	// Get the current minute (truncated to minute boundary for precise matching)
	const currentMinuteStart = Math.floor(now / 60000) * 60000;
	const currentMinuteEnd = currentMinuteStart + 60000;

	const upcoming: UpcomingIntake[] = [];

	for (let blisterIdx = 0; blisterIdx < intakes.length; blisterIdx++) {
		const intake = intakes[blisterIdx];
		// Determine takenBy for this intake
		const effectiveTakenBy = intake.takenBy || null;

		const nextTime = getNextScheduledOccurrenceTime(intake, now, true);
		if (nextTime === null) continue;

		// Calculate when we should notify for this intake
		const notifyTime = nextTime - minutesBefore * 60 * 1000;

		// Match if:
		// 1. notifyTime falls within the current minute (normal case), OR
		// 2. notifyTime is in the past but intakeTime is still in the future (catch-up
		//    for missed advance reminder window — e.g. scheduler was down during the
		//    exact notification minute due to system sleep, restart, or heavy load)
		const isInCurrentMinute = notifyTime >= currentMinuteStart && notifyTime < currentMinuteEnd;
		const isMissedButStillUpcoming = notifyTime < currentMinuteStart && nextTime > now;

		if (isInCurrentMinute || isMissedButStillUpcoming) {
			const intakeDate = new Date(nextTime);
			upcoming.push({
				medName,
				medicationId,
				blisterIndex: blisterIdx,
				usage: intake.usage,
				intakeTime: intakeDate,
				intakeTimeStr: intakeDate.toLocaleTimeString(locale, {
					hour: "2-digit",
					minute: "2-digit",
					timeZone: timezone,
				}),
				takenBy: effectiveTakenBy,
				pillWeightMg,
				doseUnit,
			});
		}
	}

	return upcoming;
}

// =============================================================================
// State file utilities
// =============================================================================

export type ReminderState = {
	lastAutoEmailSent: string | null;
	lastAutoEmailDate: string | null;
	lastStockSchedulerCheckDate: string | null;
	notifiedMedications: string[];
	nextScheduledCheck: string | null;
	lastNotificationType: "stock" | "intake" | "prescription" | null;
	lastNotificationChannel: "email" | "push" | "both" | null;
};

export type IntakeReminderEntry = {
	firstSentAt: number; // Timestamp when first reminder was sent
	lastSentAt: number; // Timestamp when last reminder was sent
	sendCount: number; // How many times NAGGING reminder was sent (not counting advance)
	advanceSent?: boolean; // Whether the advance reminder (15 min before) was sent
};

export type IntakeReminderState = {
	reminders: Record<string, IntakeReminderEntry>; // key -> entry
};

/** Create default reminder state */
export function createDefaultReminderState(): ReminderState {
	return {
		lastAutoEmailSent: null,
		lastAutoEmailDate: null,
		lastStockSchedulerCheckDate: null,
		notifiedMedications: [],
		nextScheduledCheck: null,
		lastNotificationType: null,
		lastNotificationChannel: null,
	};
}

/** Create default intake reminder state */
export function createDefaultIntakeReminderState(): IntakeReminderState {
	return { reminders: {} };
}

/** Parse reminder state from JSON string */
export function parseReminderState(json: string): ReminderState {
	try {
		const saved = JSON.parse(json);
		return {
			lastAutoEmailSent: saved.lastAutoEmailSent ?? null,
			lastAutoEmailDate: saved.lastAutoEmailDate ?? null,
			lastStockSchedulerCheckDate: saved.lastStockSchedulerCheckDate ?? null,
			notifiedMedications: saved.notifiedMedications ?? [],
			nextScheduledCheck: saved.nextScheduledCheck ?? null,
			lastNotificationType: saved.lastNotificationType ?? null,
			lastNotificationChannel: saved.lastNotificationChannel ?? null,
		};
	} catch {
		return createDefaultReminderState();
	}
}

/** Parse intake reminder state from JSON string (backward compatible) */
export function parseIntakeReminderState(json: string): IntakeReminderState {
	try {
		const saved = JSON.parse(json);

		// Backward compatibility: convert old array format to new map format
		if (Array.isArray(saved.sentReminders)) {
			const reminders: Record<string, IntakeReminderEntry> = {};
			const now = Date.now();
			for (const key of saved.sentReminders) {
				reminders[key] = {
					firstSentAt: now,
					lastSentAt: now,
					sendCount: 1,
				};
			}
			return { reminders };
		}

		// New format
		return {
			reminders: saved.reminders ?? {},
		};
	} catch {
		return createDefaultIntakeReminderState();
	}
}

/** Clean up old intake reminder entries (older than given milliseconds) */
/** Clean up old intake reminder entries (using timezone-aware day check) */
export function cleanOldIntakeReminders(
	reminders: Record<string, IntakeReminderEntry>,
	tz: string
): Record<string, IntakeReminderEntry> {
	// Get start of today in user's timezone
	const now = new Date();
	const todayStart = new Date(now.toLocaleString("en-US", { timeZone: tz }));
	todayStart.setHours(0, 0, 0, 0);
	const todayStartMs = todayStart.getTime();

	// Keep only reminders from today onwards (based on dose timestamp in key)
	const cleaned: Record<string, IntakeReminderEntry> = {};
	for (const [key, entry] of Object.entries(reminders)) {
		const timestamp = parseInt(key.split(":").pop() || "0", 10);
		if (timestamp >= todayStartMs) {
			cleaned[key] = entry;
		}
	}
	return cleaned;
}
