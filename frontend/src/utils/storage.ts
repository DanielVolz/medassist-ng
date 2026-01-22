// =============================================================================
// Local Storage Utilities
// =============================================================================

import { pad2 } from "./formatters";

/**
 * Generate a user-specific storage key
 * @param userId - The user ID
 * @param key - The storage key name
 */
export function userStorageKey(userId: number | string, key: string): string {
	return `${key}_user_${userId}`;
}

/**
 * Get today's date as ISO string (YYYY-MM-DD)
 */
export function todayIso(): string {
	const d = new Date();
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Get a date N days from today as ISO string (YYYY-MM-DD)
 */
export function plusDaysIso(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Load collapsed days state from localStorage
 */
export function loadCollapsedDaysFromStorage(
	collapsedKey: string,
	expandedKey: string
): { collapsed: Set<string>; expanded: Set<string> } {
	const collapsed = new Set<string>();
	const expanded = new Set<string>();
	try {
		const storedCollapsed = localStorage.getItem(collapsedKey);
		if (storedCollapsed) {
			const arr = JSON.parse(storedCollapsed);
			if (Array.isArray(arr)) arr.forEach((s: string) => collapsed.add(s));
		}
		const storedExpanded = localStorage.getItem(expandedKey);
		if (storedExpanded) {
			const arr = JSON.parse(storedExpanded);
			if (Array.isArray(arr)) arr.forEach((s: string) => expanded.add(s));
		}
	} catch {
		// Ignore parse errors
	}
	return { collapsed, expanded };
}

/**
 * Save collapsed days state to localStorage
 */
export function saveCollapsedDaysToStorage(storageKey: string, state: Record<string, boolean>): void {
	try {
		localStorage.setItem(storageKey, JSON.stringify(state));
	} catch {
		// Ignore storage errors
	}
}

/**
 * Get theme from localStorage or default
 */
export function getStoredTheme(): "light" | "dark" {
	if (typeof window !== "undefined") {
		return (localStorage.getItem("theme") as "light" | "dark") || "dark";
	}
	return "dark";
}

/**
 * Save theme to localStorage
 */
export function saveTheme(theme: "light" | "dark"): void {
	localStorage.setItem("theme", theme);
}
