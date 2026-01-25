// =============================================================================
// Formatting Utilities
// =============================================================================

import type { BlisterStock, Medication } from "../types";

/**
 * Map timezone to region code (ISO 3166-1 alpha-2).
 * This allows combining app language with regional formatting.
 */
const TIMEZONE_TO_REGION: Record<string, string> = {
	// Europe
	"Europe/Berlin": "DE",
	"Europe/Vienna": "AT",
	"Europe/Zurich": "CH",
	"Europe/London": "GB",
	"Europe/Dublin": "IE",
	"Europe/Paris": "FR",
	"Europe/Madrid": "ES",
	"Europe/Rome": "IT",
	"Europe/Amsterdam": "NL",
	"Europe/Brussels": "BE",
	"Europe/Warsaw": "PL",
	"Europe/Prague": "CZ",
	"Europe/Stockholm": "SE",
	"Europe/Oslo": "NO",
	"Europe/Copenhagen": "DK",
	"Europe/Helsinki": "FI",
	"Europe/Athens": "GR",
	"Europe/Lisbon": "PT",
	"Europe/Moscow": "RU",
	"Europe/Kiev": "UA",
	"Europe/Kyiv": "UA",
	"Europe/Budapest": "HU",
	"Europe/Bucharest": "RO",
	// Americas
	"America/New_York": "US",
	"America/Chicago": "US",
	"America/Denver": "US",
	"America/Los_Angeles": "US",
	"America/Phoenix": "US",
	"America/Toronto": "CA",
	"America/Vancouver": "CA",
	"America/Mexico_City": "MX",
	"America/Sao_Paulo": "BR",
	"America/Buenos_Aires": "AR",
	// Asia/Pacific
	"Asia/Tokyo": "JP",
	"Asia/Shanghai": "CN",
	"Asia/Hong_Kong": "HK",
	"Asia/Singapore": "SG",
	"Asia/Seoul": "KR",
	"Asia/Dubai": "AE",
	"Asia/Kolkata": "IN",
	"Australia/Sydney": "AU",
	"Australia/Melbourne": "AU",
	"Pacific/Auckland": "NZ",
};

/**
 * Get region code from timezone.
 * Returns undefined if timezone is not mapped.
 */
export function getRegionFromTimezone(): string | undefined {
	try {
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		return TIMEZONE_TO_REGION[timezone];
	} catch {
		return undefined;
	}
}

/**
 * Get locale for formatting based on app language and timezone region.
 * Combines app language (en/de) with region from timezone (DE/US/etc.)
 * Example: app=en + timezone=Europe/Berlin → en-DE (English text, German format)
 *
 * @param appLanguage - The app's UI language (e.g., 'en', 'de')
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
	const effectiveLocale = locale ?? getSystemLocale();

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
	const total =
		med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
	const bSize = med.pillsPerBlister;
	const fullBlisters = Math.floor(total / bSize);
	const openBlisterPills = total % bSize;
	return { fullBlisters, openBlisterPills, loosePills: openBlisterPills };
}

/**
 * Format full blisters count with optional pills per blister
 */
export function formatFullBlisters(stock: BlisterStock, pillsPerBlister?: number): string {
	const count = stock.fullBlisters;
	if (pillsPerBlister !== undefined) {
		return `${count} (${count * pillsPerBlister})`;
	}
	return String(count);
}

/**
 * Format open blister and loose pills
 */
export function formatOpenBlisterAndLoose(stock: BlisterStock): string {
	return String(stock.openBlisterPills);
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
