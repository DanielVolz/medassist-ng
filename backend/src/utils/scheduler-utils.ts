/**
 * Shared utility functions for scheduler services.
 * Exported separately to allow testing without side effects.
 */

import { getDateLocale, type Language } from "../i18n/translations.js";

export type Blister = { usage: number; every: number; start: string };

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
    minute: "2-digit"
  });
}

/** Get current hour in the configured timezone */
export function getCurrentHourInTimezone(tz?: string): number {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", { 
    timeZone: tz ?? getTimezone(), 
    hour: "numeric", 
    hour12: false 
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
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || "0";
  
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
    day: "2-digit"
  });
  const [targetYear, targetMonth, targetDay] = targetFormatter.format(targetDate).split("-").map(Number);
  
  // Now we need to find the UTC time that corresponds to reminderHour:00 on targetDate in the target timezone
  // Use a search approach: start with a guess and adjust
  const guessUtc = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, reminderHour, 0, 0, 0));
  
  // Check what hour this UTC time corresponds to in the target timezone
  const checkFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false
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

/** Parse blister schedules from JSON columns */
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
  usage: number;
  intakeTime: Date;
  intakeTimeStr: string;
  takenBy: string[];
  pillWeightMg: number | null;
};

/** 
 * Get upcoming intakes that fall within the reminder window.
 * Returns intakes that should be notified about right now.
 */
export function getUpcomingIntakes(
  medName: string, 
  blisters: Blister[], 
  minutesBefore: number, 
  takenBy: string[], 
  pillWeightMg: number | null, 
  locale: string,
  tz?: string,
  nowOverride?: number
): UpcomingIntake[] {
  const now = nowOverride ?? Date.now();
  const timezone = tz ?? getTimezone();
  
  // Window to detect if "now" is the right time to send reminder
  // We check if the notify time (intake - minutesBefore) falls within current minute ±1
  const windowStart = now - 2 * 60 * 1000; // 2 minutes ago (catch slightly late checks)
  const windowEnd = now + 1 * 60 * 1000; // 1 minute from now
  
  const upcoming: UpcomingIntake[] = [];
  
  for (const blister of blisters) {
    const startTime = new Date(blister.start).getTime();
    const intervalMs = blister.every * 24 * 60 * 60 * 1000;
    
    if (intervalMs <= 0) continue;
    
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
      
      // If today's occurrence is within the reminder window, use it
      // (intake hasn't happened yet, we should remind)
      const currentNotifyTime = currentOccurrence - minutesBefore * 60 * 1000;
      if (currentNotifyTime >= windowStart && currentOccurrence > now) {
        nextTime = currentOccurrence;
      } else {
        nextTime = nextOccurrence;
      }
    }
    
    // Calculate when we should notify for this intake
    const notifyTime = nextTime - minutesBefore * 60 * 1000;
    
    if (notifyTime >= windowStart && notifyTime <= windowEnd) {
      const intakeDate = new Date(nextTime);
      upcoming.push({
        medName,
        usage: blister.usage,
        intakeTime: intakeDate,
        intakeTimeStr: intakeDate.toLocaleTimeString(locale, { 
          hour: "2-digit", 
          minute: "2-digit",
          timeZone: timezone
        }),
        takenBy,
        pillWeightMg,
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

export type IntakeReminderState = {
  sentReminders: string[];
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
  return { sentReminders: [] };
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

/** Parse intake reminder state from JSON string */
export function parseIntakeReminderState(json: string): IntakeReminderState {
  try {
    const saved = JSON.parse(json);
    return {
      sentReminders: saved.sentReminders ?? [],
    };
  } catch {
    return createDefaultIntakeReminderState();
  }
}

/** Clean up old intake reminder entries (older than given milliseconds) */
export function cleanOldIntakeReminders(sentReminders: string[], maxAgeMs: number = 24 * 60 * 60 * 1000): string[] {
  const cutoff = Date.now() - maxAgeMs;
  return sentReminders.filter(key => {
    const timestamp = parseInt(key.split(":").pop() || "0", 10);
    return timestamp > cutoff;
  });
}
