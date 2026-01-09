import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { resolve } from "path";
import { tmpdir } from "os";

// Import actual utility functions from scheduler-utils
import {
  getTimezone,
  formatInTimezone,
  getCurrentHourInTimezone,
  getTodayInTimezone,
  getNextScheduledTime,
  getMsUntilNextCheck,
  parseBlisters,
  parseTakenByJson,
  calculateDailyUsage,
  calculateDepletionInfo,
  getUpcomingIntakes,
  createDefaultReminderState,
  createDefaultIntakeReminderState,
  parseReminderState,
  parseIntakeReminderState,
  cleanOldIntakeReminders,
  type Blister,
  type ReminderState,
  type IntakeReminderState,
  type UpcomingIntake,
} from "../utils/scheduler-utils.js";

describe("Scheduler Utils - Timezone Functions", () => {
  let originalTz: string | undefined;

  beforeEach(() => {
    originalTz = process.env.TZ;
  });

  afterEach(() => {
    if (originalTz !== undefined) {
      process.env.TZ = originalTz;
    } else {
      delete process.env.TZ;
    }
  });

  describe("getTimezone", () => {
    it("should return TZ env variable when set", () => {
      process.env.TZ = "America/New_York";
      expect(getTimezone()).toBe("America/New_York");
    });

    it("should return UTC when TZ not set", () => {
      delete process.env.TZ;
      expect(getTimezone()).toBe("UTC");
    });

    it("should handle Europe/Berlin timezone", () => {
      process.env.TZ = "Europe/Berlin";
      expect(getTimezone()).toBe("Europe/Berlin");
    });
  });

  describe("formatInTimezone", () => {
    it("should format date in given timezone", () => {
      const date = new Date("2025-12-30T12:00:00.000Z");
      const formatted = formatInTimezone(date, "UTC");
      expect(formatted).toContain("30");
      expect(formatted).toContain("12");
    });

    it("should use process.env.TZ when no tz provided", () => {
      process.env.TZ = "UTC";
      const date = new Date("2025-12-30T15:30:00.000Z");
      const formatted = formatInTimezone(date);
      expect(formatted).toContain("15:30");
    });
  });

  describe("getCurrentHourInTimezone", () => {
    it("should return a valid hour (0-23)", () => {
      process.env.TZ = "UTC";
      const hour = getCurrentHourInTimezone();
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    });

    it("should respect timezone parameter", () => {
      const hourUtc = getCurrentHourInTimezone("UTC");
      expect(hourUtc).toBeGreaterThanOrEqual(0);
      expect(hourUtc).toBeLessThanOrEqual(23);
    });
  });

  describe("getTodayInTimezone", () => {
    it("should return date in YYYY-MM-DD format", () => {
      process.env.TZ = "UTC";
      const today = getTodayInTimezone();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("should return a valid date", () => {
      process.env.TZ = "UTC";
      const today = getTodayInTimezone();
      const date = new Date(today);
      expect(date.toString()).not.toBe("Invalid Date");
    });

    it("should respect timezone parameter", () => {
      const today = getTodayInTimezone("UTC");
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("getNextScheduledTime", () => {
    it("should return a Date object", () => {
      const next = getNextScheduledTime(6, "UTC");
      expect(next).toBeInstanceOf(Date);
    });

    it("should return a time in the future", () => {
      // Use hour 0 to minimize chance of being exactly at that hour
      const next = getNextScheduledTime(0, "UTC");
      expect(next.getTime()).toBeGreaterThan(Date.now() - 60 * 60 * 1000); // Within 1 hour of now or future
    });

    it("should schedule for the given hour", () => {
      const next = getNextScheduledTime(10, "UTC");
      const hourInUtc = parseInt(next.toLocaleString("en-US", { timeZone: "UTC", hour: "numeric", hour12: false }), 10);
      expect(hourInUtc).toBe(10);
    });
  });

  describe("getMsUntilNextCheck", () => {
    it("should return a positive number (or very small negative within tolerance)", () => {
      const ms = getMsUntilNextCheck(6, "UTC");
      // Could be slightly negative if we're right at the scheduled time
      expect(ms).toBeGreaterThan(-60000);
    });

    it("should be less than or equal to 24 hours", () => {
      const ms = getMsUntilNextCheck(6, "UTC");
      const maxMs = 24 * 60 * 60 * 1000 + 60000; // 24h + 1min tolerance
      expect(ms).toBeLessThanOrEqual(maxMs);
    });
  });
});

describe("Scheduler Utils - Blister Parsing", () => {
  describe("parseBlisters", () => {
    it("should parse valid blister JSON arrays", () => {
      const row = {
        usageJson: "[1, 2, 0.5]",
        everyJson: "[1, 2, 7]",
        startJson: '["2025-01-01T08:00", "2025-01-01T20:00", "2025-01-01T12:00"]',
      };

      const blisters = parseBlisters(row);
      
      expect(blisters).toHaveLength(3);
      expect(blisters[0]).toEqual({ usage: 1, every: 1, start: "2025-01-01T08:00" });
      expect(blisters[1]).toEqual({ usage: 2, every: 2, start: "2025-01-01T20:00" });
      expect(blisters[2]).toEqual({ usage: 0.5, every: 7, start: "2025-01-01T12:00" });
    });

    it("should handle arrays of different lengths (use shortest)", () => {
      const row = {
        usageJson: "[1, 2]",
        everyJson: "[1]",
        startJson: '["2025-01-01T08:00", "2025-01-01T20:00", "2025-01-01T12:00"]',
      };

      const blisters = parseBlisters(row);
      
      expect(blisters).toHaveLength(1);
      expect(blisters[0]).toEqual({ usage: 1, every: 1, start: "2025-01-01T08:00" });
    });

    it("should return empty array for empty JSON arrays", () => {
      const row = {
        usageJson: "[]",
        everyJson: "[]",
        startJson: "[]",
      };

      const blisters = parseBlisters(row);
      expect(blisters).toHaveLength(0);
    });

    it("should return empty array for invalid JSON", () => {
      const row = {
        usageJson: "invalid",
        everyJson: "[1]",
        startJson: '["2025-01-01T08:00"]',
      };

      const blisters = parseBlisters(row);
      expect(blisters).toHaveLength(0);
    });

    it("should return empty array for non-array JSON", () => {
      const row = {
        usageJson: '{"usage": 1}',
        everyJson: "[1]",
        startJson: '["2025-01-01T08:00"]',
      };

      const blisters = parseBlisters(row);
      expect(blisters).toHaveLength(0);
    });
  });

  describe("parseTakenByJson", () => {
    it("should return empty array for null input", () => {
      expect(parseTakenByJson(null)).toEqual([]);
    });

    it("should return empty array for undefined input", () => {
      expect(parseTakenByJson(undefined)).toEqual([]);
    });

    it("should return empty array for empty string", () => {
      expect(parseTakenByJson("")).toEqual([]);
    });

    it("should parse valid JSON array of strings", () => {
      expect(parseTakenByJson('["Alice", "Bob"]')).toEqual(["Alice", "Bob"]);
    });

    it("should return empty array for empty JSON array", () => {
      expect(parseTakenByJson("[]")).toEqual([]);
    });

    it("should filter out non-string values", () => {
      expect(parseTakenByJson('[1, "Alice", null, "Bob", true]')).toEqual(["Alice", "Bob"]);
    });

    it("should filter out empty strings", () => {
      expect(parseTakenByJson('["Alice", "", "Bob", "  "]')).toEqual(["Alice", "Bob"]);
    });

    it("should return empty array for invalid JSON", () => {
      expect(parseTakenByJson("invalid json")).toEqual([]);
    });

    it("should return empty array for non-array JSON", () => {
      expect(parseTakenByJson('{"name": "Alice"}')).toEqual([]);
      expect(parseTakenByJson('"Alice"')).toEqual([]);
      expect(parseTakenByJson("123")).toEqual([]);
    });
  });
});

describe("Scheduler Utils - Daily Usage Calculation", () => {
  describe("calculateDailyUsage", () => {
    it("should calculate daily usage for single daily dose", () => {
      const blisters: Blister[] = [{ usage: 1, every: 1, start: "2025-01-01T08:00" }];
      expect(calculateDailyUsage(blisters)).toBe(1);
    });

    it("should calculate daily usage for twice daily dose", () => {
      const blisters: Blister[] = [
        { usage: 1, every: 1, start: "2025-01-01T08:00" },
        { usage: 1, every: 1, start: "2025-01-01T20:00" },
      ];
      expect(calculateDailyUsage(blisters)).toBe(2);
    });

    it("should calculate daily usage for weekly dose", () => {
      const blisters: Blister[] = [{ usage: 1, every: 7, start: "2025-01-01T08:00" }];
      expect(calculateDailyUsage(blisters)).toBeCloseTo(1/7, 5);
    });

    it("should calculate daily usage for mixed schedules", () => {
      const blisters: Blister[] = [
        { usage: 2, every: 1, start: "2025-01-01T08:00" },  // 2 per day
        { usage: 1, every: 2, start: "2025-01-01T20:00" },  // 0.5 per day
      ];
      expect(calculateDailyUsage(blisters)).toBe(2.5);
    });

    it("should return 0 for empty blisters", () => {
      expect(calculateDailyUsage([])).toBe(0);
    });

    it("should handle fractional usage amounts", () => {
      const blisters: Blister[] = [{ usage: 0.5, every: 1, start: "2025-01-01T08:00" }];
      expect(calculateDailyUsage(blisters)).toBe(0.5);
    });
  });
});

describe("Scheduler Utils - Depletion Calculation", () => {
  describe("calculateDepletionInfo", () => {
    it("should calculate days left correctly", () => {
      const blisters: Blister[] = [{ usage: 1, every: 1, start: "2025-01-01T08:00" }];
      const result = calculateDepletionInfo({ count: 30, blisters }, "en");
      expect(result.daysLeft).toBe(30);
      expect(result.depletionDate).toBeTruthy();
    });

    it("should calculate days left with multiple doses per day", () => {
      const blisters: Blister[] = [
        { usage: 1, every: 1, start: "2025-01-01T08:00" },
        { usage: 1, every: 1, start: "2025-01-01T20:00" },
      ];
      const result = calculateDepletionInfo({ count: 30, blisters }, "en");
      expect(result.daysLeft).toBe(15);
    });

    it("should return null when no blisters configured", () => {
      const result = calculateDepletionInfo({ count: 30, blisters: [] }, "en");
      expect(result.daysLeft).toBeNull();
      expect(result.depletionDate).toBeNull();
    });

    it("should return null when usage is zero", () => {
      const blisters: Blister[] = [{ usage: 0, every: 1, start: "2025-01-01T08:00" }];
      const result = calculateDepletionInfo({ count: 30, blisters }, "en");
      expect(result.daysLeft).toBeNull();
    });

    it("should floor the days left", () => {
      // 10 pills / 3 per day = 3.33... days -> floors to 3
      const blisters: Blister[] = [{ usage: 3, every: 1, start: "2025-01-01T08:00" }];
      const result = calculateDepletionInfo({ count: 10, blisters }, "en");
      expect(result.daysLeft).toBe(3);
    });

    it("should handle German language", () => {
      const blisters: Blister[] = [{ usage: 1, every: 1, start: "2025-01-01T08:00" }];
      const result = calculateDepletionInfo({ count: 10, blisters }, "de");
      expect(result.depletionDate).toBeTruthy();
      // German locale should be used
    });
  });
});

describe("Scheduler Utils - Upcoming Intakes", () => {
  describe("getUpcomingIntakes", () => {
    it("should return empty array when no intakes in window", () => {
      const blisters: Blister[] = [{ usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" }];
      // Set "now" to a time far from any scheduled intake
      const now = new Date("2025-01-01T12:00:00.000Z").getTime();
      
      const result = getUpcomingIntakes("TestMed", blisters, 15, [], null, "en-US", "UTC", now);
      expect(result).toEqual([]);
    });

    it("should find intake within reminder window", () => {
      // Schedule intake at 08:00, check at 07:45 (15 minutes before)
      const blisters: Blister[] = [{ usage: 2, every: 1, start: "2025-01-01T08:00:00.000Z" }];
      const now = new Date("2025-01-01T07:45:00.000Z").getTime();
      
      const result = getUpcomingIntakes("TestMed", blisters, 15, ["Alice"], 500, "en-US", "UTC", now);
      
      expect(result).toHaveLength(1);
      expect(result[0].medName).toBe("TestMed");
      expect(result[0].usage).toBe(2);
      expect(result[0].takenBy).toEqual(["Alice"]);
      expect(result[0].pillWeightMg).toBe(500);
    });

    it("should skip blisters with zero interval", () => {
      const blisters: Blister[] = [{ usage: 1, every: 0, start: "2025-01-01T08:00:00.000Z" }];
      const now = new Date("2025-01-01T07:45:00.000Z").getTime();
      
      const result = getUpcomingIntakes("TestMed", blisters, 15, [], null, "en-US", "UTC", now);
      expect(result).toEqual([]);
    });

    it("should handle multiple blisters", () => {
      // Two intakes at 08:00 and 08:01
      const blisters: Blister[] = [
        { usage: 1, every: 1, start: "2025-01-01T08:00:00.000Z" },
        { usage: 2, every: 1, start: "2025-01-01T08:01:00.000Z" },
      ];
      const now = new Date("2025-01-01T07:45:00.000Z").getTime();
      
      const result = getUpcomingIntakes("TestMed", blisters, 15, [], null, "en-US", "UTC", now);
      
      // Both should be found as they're within the window
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("Scheduler Utils - State Management", () => {
  describe("createDefaultReminderState", () => {
    it("should create default reminder state", () => {
      const state = createDefaultReminderState();
      expect(state.lastAutoEmailSent).toBeNull();
      expect(state.lastAutoEmailDate).toBeNull();
      expect(state.notifiedMedications).toEqual([]);
      expect(state.nextScheduledCheck).toBeNull();
      expect(state.lastNotificationType).toBeNull();
      expect(state.lastNotificationChannel).toBeNull();
    });
  });

  describe("createDefaultIntakeReminderState", () => {
    it("should create default intake reminder state", () => {
      const state = createDefaultIntakeReminderState();
      expect(state.reminders).toEqual({});
    });
  });

  describe("parseReminderState", () => {
    it("should parse valid JSON", () => {
      const json = JSON.stringify({
        lastAutoEmailSent: "2025-12-30T10:00:00.000Z",
        lastAutoEmailDate: "2025-12-30",
        notifiedMedications: ["med1", "med2"],
        nextScheduledCheck: "2025-12-31T06:00:00.000Z",
        lastNotificationType: "stock",
        lastNotificationChannel: "email",
      });
      
      const state = parseReminderState(json);
      expect(state.lastAutoEmailSent).toBe("2025-12-30T10:00:00.000Z");
      expect(state.lastAutoEmailDate).toBe("2025-12-30");
      expect(state.notifiedMedications).toEqual(["med1", "med2"]);
      expect(state.lastNotificationType).toBe("stock");
      expect(state.lastNotificationChannel).toBe("email");
    });

    it("should handle partial state with defaults", () => {
      const json = JSON.stringify({ lastAutoEmailSent: "2025-12-30T10:00:00.000Z" });
      
      const state = parseReminderState(json);
      expect(state.lastAutoEmailSent).toBe("2025-12-30T10:00:00.000Z");
      expect(state.lastAutoEmailDate).toBeNull();
      expect(state.notifiedMedications).toEqual([]);
    });

    it("should return defaults for invalid JSON", () => {
      const state = parseReminderState("invalid json {{{");
      expect(state.lastAutoEmailSent).toBeNull();
      expect(state.notifiedMedications).toEqual([]);
    });
  });

  describe("parseIntakeReminderState", () => {
    it("should parse valid new format JSON", () => {
      const json = JSON.stringify({ 
        reminders: { 
          "med1:123": { firstSentAt: 1000, lastSentAt: 2000, sendCount: 2 },
          "med2:456": { firstSentAt: 3000, lastSentAt: 3000, sendCount: 1 }
        } 
      });
      
      const state = parseIntakeReminderState(json);
      expect(Object.keys(state.reminders)).toHaveLength(2);
      expect(state.reminders["med1:123"].sendCount).toBe(2);
    });
    
    it("should convert old array format to new format", () => {
      const json = JSON.stringify({ sentReminders: ["med1:123", "med2:456"] });
      
      const state = parseIntakeReminderState(json);
      expect(Object.keys(state.reminders)).toHaveLength(2);
      expect(state.reminders["med1:123"]).toBeDefined();
      expect(state.reminders["med1:123"].sendCount).toBe(1);
    });

    it("should return defaults for invalid JSON", () => {
      const state = parseIntakeReminderState("invalid");
      expect(state.reminders).toEqual({});
    });

    it("should handle missing reminders field", () => {
      const state = parseIntakeReminderState("{}");
      expect(state.reminders).toEqual({});
    });
  });

  describe("cleanOldIntakeReminders", () => {
    it("should remove entries from past days (timezone-aware)", () => {
      const tz = "Europe/Berlin";
      const now = new Date();
      const today = new Date(now.toLocaleString("en-US", { timeZone: tz }));
      today.setHours(12, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const reminders = {
        [`med1:${yesterday.getTime()}`]: { firstSentAt: yesterday.getTime(), lastSentAt: yesterday.getTime(), sendCount: 1 },
        [`med2:${today.getTime()}`]: { firstSentAt: today.getTime(), lastSentAt: today.getTime(), sendCount: 1 },
      };
      
      const cleaned = cleanOldIntakeReminders(reminders, tz);
      
      expect(Object.keys(cleaned)).toHaveLength(1);
      expect(cleaned[`med2:${today.getTime()}`]).toBeDefined();
    });

    it("should keep all entries from today", () => {
      const tz = "Europe/Berlin";
      const now = new Date();
      const morning = new Date(now.toLocaleString("en-US", { timeZone: tz }));
      morning.setHours(8, 0, 0, 0);
      
      const evening = new Date(now.toLocaleString("en-US", { timeZone: tz }));
      evening.setHours(20, 0, 0, 0);
      
      const reminders = {
        [`med1:${morning.getTime()}`]: { firstSentAt: morning.getTime(), lastSentAt: morning.getTime(), sendCount: 1 },
        [`med2:${evening.getTime()}`]: { firstSentAt: evening.getTime(), lastSentAt: evening.getTime(), sendCount: 1 },
      };
      
      const cleaned = cleanOldIntakeReminders(reminders, tz);
      expect(Object.keys(cleaned)).toHaveLength(2);
    });

    it("should handle empty reminders", () => {
      const cleaned = cleanOldIntakeReminders({}, "Europe/Berlin");
      expect(cleaned).toEqual({});
    });

    it("should handle malformed entries (invalid timestamp in key)", () => {
      const reminders = {
        "med1:invalid": { firstSentAt: 1000, lastSentAt: 1000, sendCount: 1 },
        "med2:notanumber": { firstSentAt: 2000, lastSentAt: 2000, sendCount: 1 }
      };
      const cleaned = cleanOldIntakeReminders(reminders, "Europe/Berlin");
      // NaN from parseInt will cause these to be filtered out (invalid < todayStart)
      expect(Object.keys(cleaned)).toHaveLength(0);
    });
  });
});
