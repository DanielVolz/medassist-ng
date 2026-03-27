import { loadCollapsedDaysFromStorage } from "../../utils/storage";

export type ScheduleCollapseState = {
	collapsed: Set<string>;
	expanded: Set<string>;
};

export function loadScheduleCollapseState(collapseKey: string, expandKey: string): ScheduleCollapseState {
	return loadCollapsedDaysFromStorage(collapseKey, expandKey);
}

export function saveCollapsedDaySet(storageKey: string, value: Set<string>): void {
	try {
		localStorage.setItem(storageKey, JSON.stringify([...value]));
	} catch {
		// Ignore storage failures and keep UI responsive.
	}
}
