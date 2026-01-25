// =============================================================================
// useCollapsedDays Hook - Day collapse/expand state management
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { loadCollapsedDaysFromStorage, userStorageKey } from "../utils/storage";

export interface UseCollapsedDaysReturn {
	manuallyCollapsedDays: Set<string>;
	manuallyExpandedDays: Set<string>;
	toggleDayCollapse: (dateStr: string, isAutoCollapsed: boolean) => void;
}

export function useCollapsedDays(userId: number | undefined): UseCollapsedDaysReturn {
	const [manuallyCollapsedDays, setManuallyCollapsedDays] = useState<Set<string>>(new Set());
	const [manuallyExpandedDays, setManuallyExpandedDays] = useState<Set<string>>(new Set());

	// Load collapsed/expanded state from localStorage when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && userId) {
			const { collapsed, expanded } = loadCollapsedDaysFromStorage(
				userStorageKey(userId, "collapsedDays"),
				userStorageKey(userId, "expandedDays")
			);
			setManuallyCollapsedDays(collapsed);
			setManuallyExpandedDays(expanded);
		}
	}, [userId]);

	// Toggle day collapse/expand
	const toggleDayCollapse = useCallback(
		(dateStr: string, isAutoCollapsed: boolean) => {
			if (isAutoCollapsed) {
				// Day is auto-collapsed (all taken) - toggle the expanded override
				setManuallyExpandedDays((prev) => {
					const next = new Set(prev);
					if (next.has(dateStr)) {
						next.delete(dateStr);
					} else {
						next.add(dateStr);
					}
					if (userId) localStorage.setItem(userStorageKey(userId, "expandedDays"), JSON.stringify([...next]));
					return next;
				});
			} else {
				// Day is not auto-collapsed - toggle manual collapse
				setManuallyCollapsedDays((prev) => {
					const next = new Set(prev);
					if (next.has(dateStr)) {
						next.delete(dateStr);
					} else {
						next.add(dateStr);
					}
					if (userId) localStorage.setItem(userStorageKey(userId, "collapsedDays"), JSON.stringify([...next]));
					return next;
				});
			}
		},
		[userId]
	);

	return {
		manuallyCollapsedDays,
		manuallyExpandedDays,
		toggleDayCollapse,
	};
}
