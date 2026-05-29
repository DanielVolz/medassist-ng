// =============================================================================
// Formatting Utilities
// =============================================================================

import { getRegionForTimezone } from "@medassist/shared";
import type { BlisterStock, Medication } from "../types";
import { getMedTotal } from "../types";
import { splitCurrentBlisterStock } from "./stock";

let defaultFormattingTimezone: string | null = null;

export function setDefaultFormattingTimezone(timezone: string | null | undefined): void {
	defaultFormattingTimezone = timezone?.trim() || null;
}

export function getFormattingTimezone(): string | undefined {
	if (defaultFormattingTimezone) {
		return defaultFormattingTimezone;
	}

	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return undefined;
	}
}

export function withFormattingTimezone(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions {
	const timezone = getFormattingTimezone();
	if (!timezone) {
		return options;
	}

	return {
		...options,
		timeZone: timezone,
	};
}

/**
 * Get region code from timezone.
 * Returns undefined if timezone is not mapped.
 */
export function getRegionFromTimezone(): string | undefined {
	const timezone = getFormattingTimezone();
	return getRegionForTimezone(timezone);
}

/**
 * Map region code to the region's primary language for date/number formatting.
 * This ensures dates use regional conventions (e.g., dots in Germany)
 * regardless of the app's UI language.
 */
const REGION_TO_LANG: Record<string, string> = {
	DE: "de",
	AT: "de",
	CH: "de",
	GB: "en",
	IE: "en",
	FR: "fr",
	ES: "es",
	IT: "it",
	NL: "nl",
	BE: "nl",
	PL: "pl",
	CZ: "cs",
	SE: "sv",
	NO: "nb",
	DK: "da",
	FI: "fi",
	GR: "el",
	PT: "pt",
	RU: "ru",
	UA: "uk",
	HU: "hu",
	RO: "ro",
	US: "en",
	CA: "en",
	MX: "es",
	BR: "pt",
	AR: "es",
	JP: "ja",
	CN: "zh",
	HK: "zh",
	SG: "en",
	KR: "ko",
	AE: "ar",
	IN: "en",
	AU: "en",
	NZ: "en",
};

/**
 * Get locale for text-based date formatting (weekday names, month names).
 * Uses the app's UI language + timezone region so text appears in the app language
 * while regional conventions (day-first order) are respected.
 *
 * Example: app=en + timezone=Europe/Berlin → en-DE
 * → "Thu, 05. Feb." (English names, German order)
 */
export function getSystemLocale(appLanguage?: string): string {
	const region = getRegionFromTimezone();
	const lang = appLanguage || navigator.language?.split("-")[0] || "en";

	if (region) {
		return `${lang}-${region}`;
	}

	// Fallback: use browser language, or en-US as last resort
	return navigator.language || "en-US";
}

/**
 * Get locale for purely numeric date/number formatting.
 * Uses the region's native language so separators match regional conventions
 * (e.g., dots in Germany: 14.02.2026, slashes in US: 02/14/2026).
 *
 * Only use this for numeric-only output (2-digit day/month/year, no text).
 * For output that includes weekday or month names, use getSystemLocale() instead.
 */
export function getNumericLocale(): string {
	const region = getRegionFromTimezone();

	if (region) {
		const regionLang = REGION_TO_LANG[region] || "en";
		return `${regionLang}-${region}`;
	}

	return navigator.language || "en-US";
}

/**
 * Format a number using the current locale with optional decimal places
 */
export function formatNumber(n: number | null | undefined, decimals = 0): string {
	if (n === null || n === undefined) return "—";
	return n.toLocaleString(undefined, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
}

/**
 * Format a date/time string for display
 * Extracts date and time directly from string to avoid timezone conversion
 * Uses system locale by default for consistent regional formatting
 */
export function formatDateTime(iso: string | null | undefined, locale?: string): string {
	if (!iso) return "-";

	// Extract date and time components directly from ISO string
	// Format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DDTHH:MM:SS.sssZ
	const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!match) return "-";

	const [, year, month, day, hour, minute] = match;
	const effectiveLocale = locale ?? getNumericLocale();

	// Create a date object for formatting, but use local timezone interpretation
	// by creating the date without the Z suffix
	const localDateStr = `${year}-${month}-${day}T${hour}:${minute}:00`;
	const d = new Date(localDateStr);
	if (Number.isNaN(d.getTime())) return "-";

	const dateOpts: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	};
	const timeOpts: Intl.DateTimeFormatOptions = {
		hour: "2-digit",
		minute: "2-digit",
	};
	const dateStr = d.toLocaleDateString(effectiveLocale, dateOpts);
	const timeStr = d.toLocaleTimeString(effectiveLocale, timeOpts);
	return `${dateStr} ${timeStr}`;
}

/**
 * Format a date-only string (YYYY-MM-DD) or ISO datetime to a localized date (no time).
 */
export function formatDate(dateStr: string | null | undefined, locale?: string): string {
	if (!dateStr) return "-";
	const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!match) return "-";
	const [, year, month, day] = match;
	const d = new Date(`${year}-${month}-${day}T00:00:00`);
	if (Number.isNaN(d.getTime())) return "-";
	const effectiveLocale = locale ?? getNumericLocale();
	return d.toLocaleDateString(effectiveLocale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * Pad a number to 2 digits with leading zero
 */
export function pad2(n: number): string {
	return n.toString().padStart(2, "0");
}

/**
 * Convert a Date to ISO date string (YYYY-MM-DD)
 */
export function toIsoString(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Get the date portion (YYYY-MM-DD) from an ISO datetime string or Date
 */
export function toDateValue(input: string | Date): string {
	if (input instanceof Date) {
		return toIsoString(input);
	}
	return input.slice(0, 10);
}

/**
 * Get the time portion (HH:MM) from an ISO datetime string or Date
 * For strings, extracts HH:MM directly without timezone conversion
 */
export function toTimeValue(input: string | Date): string {
	if (input instanceof Date) {
		return `${pad2(input.getHours())}:${pad2(input.getMinutes())}`;
	}
	// Extract HH:MM directly from string (position 11-16 in YYYY-MM-DDTHH:MM...)
	// This avoids timezone conversion issues with Z suffix
	const timeMatch = input.match(/T(\d{2}):(\d{2})/);
	if (timeMatch) {
		return `${timeMatch[1]}:${timeMatch[2]}`;
	}
	// Fallback to Date parsing if format doesn't match
	const d = new Date(input);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Combine a date string (YYYY-MM-DD) and time string (HH:MM) into ISO datetime
 */
export function combineDateAndTime(dateStr: string, timeStr: string): string {
	return `${dateStr}T${timeStr}:00`;
}

/**
 * Format a Date or ISO string to datetime-local input value (YYYY-MM-DDTHH:MM)
 */
export function toInputValue(input: Date | string): string {
	const d = input instanceof Date ? input : new Date(input);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Derive total pills from medication inventory
 */
export function deriveTotal(
	packCount: number,
	blistersPerPack: number,
	pillsPerBlister: number,
	looseTablets: number
): number {
	return packCount * blistersPerPack * pillsPerBlister + looseTablets;
}

/**
 * Get CSS class for expiry date status
 * Returns: danger-text (expired), warning-text (within threshold), success-text (OK)
 */
export function getExpiryClass(expiryDate: string | null | undefined, thresholdDays: number): string {
	if (!expiryDate) return "";
	const exp = new Date(expiryDate);
	const now = new Date();
	const diff = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
	if (diff < 0) return "danger-text";
	if (diff <= thresholdDays) return "warning-text";
	return "success-text";
}

/**
 * Calculate blister stock breakdown for a medication
 */
export function getBlisterStock(med: Medication): BlisterStock {
	return splitCurrentBlisterStock(getMedTotal(med), med.pillsPerBlister, med.looseTablets);
}

/**
 * Compare semantic version strings
 * Returns: negative if a < b, positive if a > b, 0 if equal
 */
export function compareSemver(a: string, b: string): number {
	const pa = a.replace(/^v/, "").split(".").map(Number);
	const pb = b.replace(/^v/, "").split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] ?? 0;
		const nb = pb[i] ?? 0;
		if (na !== nb) return na - nb;
	}
	return 0;
}
