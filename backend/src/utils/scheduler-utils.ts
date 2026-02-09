/**
 * Shared utility functions for scheduler services.
 * Exported separately to allow testing without side effects.
 */

import { getDateLocale, type Language } from "../i18n/translations.js";

// Legacy type - individual blister schedule (DEPRECATED: use Intake instead)
export type Blister = { usage: number; every: number; start: string };

// New unified intake type with per-intake takenBy
export type Intake = {
	usage: number;
	every: number;
	start: string;
	takenBy: string | null; // Person taking this specific intake (null = use medication-level takenBy)
	intakeRemindersEnabled: boolean;
};

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
	return next.getTime() - Date.now();
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
				return parsed.map((intake: any) => ({
					usage: typeof intake.usage === "number" ? intake.usage : 0,
					every: typeof intake.every === "number" ? intake.every : 1,
					start: typeof intake.start === "string" ? intake.start : new Date().toISOString(),
					takenBy: typeof intake.takenBy === "string" && intake.takenBy.trim() ? intake.takenBy.trim() : null,
					intakeRemindersEnabled:
						typeof intake.intakeRemindersEnabled === "boolean" ? intake.intakeRemindersEnabled : false,
				}));
			}
		} catch {
			// Fall through to legacy parsing
		}
	}

	// Fallback to legacy parallel arrays
	if (legacyRow) {
		const blisters = parseBlisters(legacyRow);
		return blisters.map((b) => ({
			usage: b.usage,
			every: b.every,
			start: b.start,
			takenBy: null, // Legacy format has no per-intake takenBy
			intakeRemindersEnabled: medicationIntakeRemindersEnabled ?? false,
		}));
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
	if (medicationTakenBy.includes(person)) return true;
	return intakes.some((intake) => intake.takenBy === person);
}

// =============================================================================
// Stock calculation utilities
// =============================================================================

/** Calculate daily usage from blisters */
export function calculateDailyUsage(blisters: Blister[]): number {
	return blisters.reduce((sum, s) => sum + s.usage / s.every, 0);
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
	medicationTakenBy: string[], // Medication-level takenBy as fallback
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
		const startTime = parseLocalDateTime(intake.start).getTime();
		const intervalMs = intake.every * 24 * 60 * 60 * 1000;

		if (intervalMs <= 0) continue;

		// Determine takenBy for this intake
		// If intake has its own takenBy, use it; otherwise null (no specific person)
		const effectiveTakenBy = intake.takenBy || null;

		// Find all occurrences that fall within today
		let currentTime = startTime;

		// If start is in the past, calculate the first occurrence on or after todayStart
		if (currentTime < todayStart.getTime()) {
			const elapsed = todayStart.getTime() - startTime;
			const intervals = Math.floor(elapsed / intervalMs);
			currentTime = startTime + intervals * intervalMs;
		}

		// Collect all intakes for today
		while (currentTime <= todayEnd.getTime()) {
			if (currentTime >= todayStart.getTime()) {
				const intakeDate = new Date(currentTime);
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
			}
			currentTime += intervalMs;
		}
	}

	return result;
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
	medicationTakenBy: string[], // Medication-level takenBy as fallback
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
		const startTime = parseLocalDateTime(intake.start).getTime();
		const intervalMs = intake.every * 24 * 60 * 60 * 1000;

		if (intervalMs <= 0) continue;

		// Determine takenBy for this intake
		const effectiveTakenBy = intake.takenBy || null;

		// Find the next scheduled intake time (could be today or in the future)
		let nextTime = startTime;

		// If start is in the past, calculate occurrences
		if (nextTime < now) {
			const elapsed = now - startTime;
			const intervals = Math.floor(elapsed / intervalMs);

			// Check the current occurrence (today's scheduled time, even if past)
			const currentOccurrence = startTime + intervals * intervalMs;
			// And the next occurrence
			const nextOccurrence = startTime + (intervals + 1) * intervalMs;

			// If today's occurrence notification time falls in current minute and intake hasn't happened
			const currentNotifyTime = currentOccurrence - minutesBefore * 60 * 1000;
			if (currentNotifyTime >= currentMinuteStart && currentOccurrence > now) {
				nextTime = currentOccurrence;
			} else if (currentNotifyTime < currentMinuteStart && currentOccurrence > now) {
				// CATCH-UP: The notify window was missed (e.g. due to system sleep/restart)
				// but the intake time is still in the future — include it so the advance
				// reminder can still be sent rather than falling into a dead zone.
				nextTime = currentOccurrence;
			} else {
				nextTime = nextOccurrence;
			}
		}

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
	notifiedMedications: string[];
	nextScheduledCheck: string | null;
	lastNotificationType: "stock" | "intake" | null;
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
