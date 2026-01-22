// =============================================================================
// Formatting Utilities
// =============================================================================

import type { Medication, BlisterStock } from "../types";

/**
 * Format a number using the current locale with optional decimal places
 */
export function formatNumber(n: number | null | undefined, decimals = 0): string {
	if (n === null || n === undefined) return "—";
	return n.toLocaleString(undefined, {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	});
}

/**
 * Format a date/time string for display
 */
export function formatDateTime(iso: string | null | undefined, locale?: string): string {
	if (!iso) return "-";
	const d = new Date(iso);
	if (isNaN(d.getTime())) return "-";
	const dateOpts: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	};
	const timeOpts: Intl.DateTimeFormatOptions = {
		hour: "2-digit",
		minute: "2-digit"
	};
	const dateStr = d.toLocaleDateString(locale, dateOpts);
	const timeStr = d.toLocaleTimeString(locale, timeOpts);
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
 */
export function toTimeValue(input: string | Date): string {
	const d = input instanceof Date ? input : new Date(input);
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
 */
export function getExpiryClass(expiryDate: string | null | undefined, thresholdDays: number): string {
	if (!expiryDate) return "";
	const exp = new Date(expiryDate);
	const now = new Date();
	const diff = (exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
	if (diff < 0) return "expired";
	if (diff <= thresholdDays) return "expiring-soon";
	return "";
}

/**
 * Calculate blister stock breakdown for a medication
 */
export function getBlisterStock(med: Medication): BlisterStock {
	const total = med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0);
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
