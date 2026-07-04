import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Medication } from "../../types";
import {
	combineDateAndTime,
	compareSemver,
	deriveTotal,
	formatDateTime,
	formatDisplayDate,
	formatDisplayDateTime,
	formatExpiryDate,
	formatMonth,
	formatNumber,
	getBlisterStock,
	getExpiryClass,
	pad2,
	toDateValue,
	toInputValue,
	toIsoString,
	toMonthEndDateValue,
	toMonthValue,
	toTimeValue,
} from "../../utils/formatters";

describe("formatNumber", () => {
	it('returns "—" for null', () => {
		expect(formatNumber(null)).toBe("—");
	});

	it('returns "—" for undefined', () => {
		expect(formatNumber(undefined)).toBe("—");
	});

	it("formats integer with no decimals", () => {
		expect(formatNumber(1234, 0)).toBe("1,234");
	});

	it("formats number with specified decimals", () => {
		expect(formatNumber(1234.5678, 2)).toBe("1,234.57");
	});

	it("formats zero correctly", () => {
		expect(formatNumber(0)).toBe("0");
	});

	it("formats negative numbers correctly", () => {
		expect(formatNumber(-500)).toBe("-500");
	});
});

describe("formatDateTime", () => {
	it('returns "-" for null', () => {
		expect(formatDateTime(null)).toBe("-");
	});

	it('returns "-" for undefined', () => {
		expect(formatDateTime(undefined)).toBe("-");
	});

	it('returns "-" for empty string', () => {
		expect(formatDateTime("")).toBe("-");
	});

	it('returns "-" for invalid date string', () => {
		expect(formatDateTime("not-a-date")).toBe("-");
	});

	it("formats valid ISO date string", () => {
		const result = formatDateTime("2024-03-15T10:30:00Z", "en-US");
		expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/); // Contains date in some format
		expect(result).toMatch(/\d{1,2}:\d{2}/); // Contains time
	});
});

describe("formatDisplayDate", () => {
	const currentYear = new Date(2026, 6, 1, 12, 0, 0);

	it("formats same-year deadline dates with weekday and no year", () => {
		expect(formatDisplayDate("2026-07-14", "en-DE", { weekday: true, now: currentYear })).toBe("Tue, 14 Jul");
	});

	it("adds the year for deadline dates outside the current year", () => {
		expect(formatDisplayDate("2027-05-01", "en-DE", { weekday: true, now: currentYear })).toBe("Sat, 01 May 2027");
	});

	it("formats metadata dates without weekday using the same conditional-year rule", () => {
		expect(formatDisplayDate("2026-07-14", "en-DE", { now: currentYear })).toBe("14 Jul");
		expect(formatDisplayDate("2027-05-01", "en-DE", { now: currentYear })).toBe("01 May 2027");
	});

	it("uses the configured fallback for missing and invalid values", () => {
		expect(formatDisplayDate(null, "en-DE", { fallback: "—", now: currentYear })).toBe("—");
		expect(formatDisplayDate("not-a-date", "en-DE", { fallback: "—", now: currentYear })).toBe("—");
	});

	it("keeps date-only strings on their calendar day", () => {
		expect(formatDisplayDate("2027-01-01", "en-DE", { weekday: true, now: new Date(2027, 0, 1) })).toBe("Fri, 01 Jan");
	});
});

describe("formatDisplayDateTime", () => {
	const currentYear = new Date(2026, 6, 1, 12, 0, 0);

	it("formats visible date-time metadata without weekday by default", () => {
		expect(formatDisplayDateTime("2026-07-14T20:30:00", "en-DE", { now: currentYear })).toBe("14 Jul, 20:30");
	});

	it("adds the year to date-time metadata outside the current year", () => {
		expect(formatDisplayDateTime("2027-05-01T20:30:00", "en-DE", { now: currentYear })).toBe("01 May 2027, 20:30");
	});
});

describe("formatExpiryDate", () => {
	it("formats medication expiry dates as month and 2-digit year only", () => {
		expect(formatExpiryDate("2028-09-03", "en-DE")).toBe("Sept 28");
		expect(formatExpiryDate("2027-05-01", "en-DE")).toBe("May 27");
	});

	it("keeps date-only expiry strings on their calendar month", () => {
		expect(formatExpiryDate("2027-01-01", "en-DE")).toBe("Jan 27");
	});

	it("uses the configured fallback for missing and invalid values", () => {
		expect(formatExpiryDate(null, "en-DE", { fallback: "—" })).toBe("—");
		expect(formatExpiryDate("not-a-date", "en-DE", { fallback: "—" })).toBe("—");
	});
});

describe("formatMonth", () => {
	it("formats date strings as localized month and year only", () => {
		expect(formatMonth("2028-09-03", "de-DE")).toMatch(/^09\D2028$/);
		expect(formatMonth("2028-09", "de-DE")).toMatch(/^09\D2028$/);
	});

	it("uses fallback for missing and invalid month strings", () => {
		expect(formatMonth(null, "de-DE")).toBe("-");
		expect(formatMonth("not-a-month", "de-DE")).toBe("-");
		expect(formatMonth("2028-13", "de-DE")).toBe("-");
	});
});

describe("pad2", () => {
	it("pads single digit with leading zero", () => {
		expect(pad2(5)).toBe("05");
	});

	it("keeps double digit as is", () => {
		expect(pad2(12)).toBe("12");
	});

	it("pads zero correctly", () => {
		expect(pad2(0)).toBe("00");
	});
});

describe("toIsoString", () => {
	it("converts Date to ISO string format", () => {
		const date = new Date(2024, 2, 15); // March 15, 2024
		expect(toIsoString(date)).toBe("2024-03-15");
	});

	it("pads single digit months and days", () => {
		const date = new Date(2024, 0, 5); // January 5, 2024
		expect(toIsoString(date)).toBe("2024-01-05");
	});
});

describe("toDateValue", () => {
	it("extracts date from ISO string", () => {
		expect(toDateValue("2024-03-15T10:30:00Z")).toBe("2024-03-15");
	});

	it("converts Date to date string", () => {
		const date = new Date(2024, 2, 15);
		expect(toDateValue(date)).toBe("2024-03-15");
	});
});

describe("toMonthValue", () => {
	it("extracts month from date strings", () => {
		expect(toMonthValue("2027-01-01")).toBe("2027-01");
		expect(toMonthValue("2028-09")).toBe("2028-09");
	});

	it("converts Date to month string", () => {
		const date = new Date(2024, 2, 15);
		expect(toMonthValue(date)).toBe("2024-03");
	});

	it("returns empty string for invalid month values", () => {
		expect(toMonthValue(null)).toBe("");
		expect(toMonthValue("not-a-month")).toBe("");
		expect(toMonthValue("2028-13")).toBe("");
	});
});

describe("toMonthEndDateValue", () => {
	it("converts month values to the last day of the month", () => {
		expect(toMonthEndDateValue("2028-09")).toBe("2028-09-30");
		expect(toMonthEndDateValue("2028-02")).toBe("2028-02-29");
		expect(toMonthEndDateValue("2027-02")).toBe("2027-02-28");
	});

	it("returns empty string for missing and invalid values", () => {
		expect(toMonthEndDateValue(null)).toBe("");
		expect(toMonthEndDateValue("not-a-month")).toBe("");
		expect(toMonthEndDateValue("2028-13")).toBe("");
	});
});

describe("toTimeValue", () => {
	it("extracts time from ISO string", () => {
		const result = toTimeValue("2024-03-15T10:30:00Z");
		// Time depends on timezone, just check format
		expect(result).toMatch(/^\d{2}:\d{2}$/);
	});

	it("extracts time from Date object", () => {
		const date = new Date(2024, 2, 15, 14, 45);
		expect(toTimeValue(date)).toBe("14:45");
	});
});

describe("combineDateAndTime", () => {
	it("combines date and time into ISO datetime", () => {
		expect(combineDateAndTime("2024-03-15", "10:30")).toBe("2024-03-15T10:30:00");
	});
});

describe("toInputValue", () => {
	it("converts Date to datetime-local input format", () => {
		const date = new Date(2024, 2, 15, 14, 30);
		expect(toInputValue(date)).toBe("2024-03-15T14:30");
	});

	it("converts ISO string to datetime-local input format", () => {
		const result = toInputValue("2024-03-15T14:30:00");
		// Format depends on timezone, but should be YYYY-MM-DDTHH:MM
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
	});
});

describe("deriveTotal", () => {
	it("calculates total pills correctly", () => {
		expect(deriveTotal(2, 3, 10, 5)).toBe(65); // 2*3*10 + 5 = 65
	});

	it("handles zero values", () => {
		expect(deriveTotal(0, 0, 0, 0)).toBe(0);
	});

	it("handles only loose tablets", () => {
		expect(deriveTotal(0, 0, 0, 15)).toBe(15);
	});
});

describe("getExpiryClass", () => {
	let realDateNow: () => number;

	beforeEach(() => {
		realDateNow = Date.now;
		// Mock current date to a fixed point
		const fixedDate = new Date("2024-03-15T12:00:00Z").getTime();
		vi.spyOn(Date, "now").mockReturnValue(fixedDate);
		vi.setSystemTime(new Date("2024-03-15T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
		Date.now = realDateNow;
	});

	it("returns empty string for null", () => {
		expect(getExpiryClass(null, 30)).toBe("");
	});

	it("returns empty string for undefined", () => {
		expect(getExpiryClass(undefined, 30)).toBe("");
	});

	it("returns danger-text for past date", () => {
		expect(getExpiryClass("2024-03-10", 30)).toBe("danger-text");
	});

	it("returns warning-text when within threshold", () => {
		expect(getExpiryClass("2024-03-25", 30)).toBe("warning-text");
	});

	it("returns success-text when expiry is far away", () => {
		expect(getExpiryClass("2024-06-15", 30)).toBe("success-text");
	});
});

describe("getBlisterStock", () => {
	it("calculates blister stock correctly", () => {
		const med: Medication = {
			id: 1,
			name: "Test Med",
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 5,
			takenBy: [],
			blisters: [],
			updatedAt: null,
		};

		const result = getBlisterStock(med);
		expect(result.fullBlisters).toBe(2); // 25 / 10 = 2
		expect(result.openBlisterPills).toBe(0); // 20 % 10 = 0 after preserving loose tablets
		expect(result.loosePills).toBe(5);
	});

	it("includes stock adjustment in calculation", () => {
		const med: Medication = {
			id: 1,
			name: "Test Med",
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			stockAdjustment: -5,
			takenBy: [],
			blisters: [],
			updatedAt: null,
		};

		const result = getBlisterStock(med);
		expect(result.fullBlisters).toBe(0); // 5 / 10 = 0
		expect(result.openBlisterPills).toBe(5); // 5 % 10 = 5
	});
});

describe("compareSemver", () => {
	it("returns 0 for equal versions", () => {
		expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
	});

	it("returns negative when a < b", () => {
		expect(compareSemver("1.2.3", "1.2.4")).toBeLessThan(0);
		expect(compareSemver("1.2.3", "1.3.0")).toBeLessThan(0);
		expect(compareSemver("1.2.3", "2.0.0")).toBeLessThan(0);
	});

	it("returns positive when a > b", () => {
		expect(compareSemver("1.2.4", "1.2.3")).toBeGreaterThan(0);
		expect(compareSemver("1.3.0", "1.2.3")).toBeGreaterThan(0);
		expect(compareSemver("2.0.0", "1.2.3")).toBeGreaterThan(0);
	});

	it("handles version prefixes", () => {
		expect(compareSemver("v1.2.3", "v1.2.3")).toBe(0);
		expect(compareSemver("v1.2.3", "1.2.4")).toBeLessThan(0);
	});

	it("handles versions with different segment counts", () => {
		expect(compareSemver("1.2", "1.2.0")).toBe(0);
		expect(compareSemver("1.2.3", "1.2")).toBeGreaterThan(0);
	});
});
