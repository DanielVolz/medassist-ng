export function toggleDateInSet(previous: Set<string>, dateStr: string): Set<string> {
	const next = new Set(previous);
	if (next.has(dateStr)) {
		next.delete(dateStr);
	} else {
		next.add(dateStr);
	}
	return next;
}

export function resolveCollapsedState(
	isAutoCollapsed: boolean,
	dateStr: string,
	manuallyExpandedDays: Set<string>,
	manuallyCollapsedDays: Set<string>
): boolean {
	if (isAutoCollapsed) {
		return !manuallyExpandedDays.has(dateStr);
	}
	return manuallyCollapsedDays.has(dateStr);
}

export function countTakenDoseIds(doseIds: string[], isDoseTaken: (doseId: string) => boolean): number {
	return doseIds.filter((id) => isDoseTaken(id)).length;
}

export function areAllDoseIdsTaken(doseIds: string[], isDoseTaken: (doseId: string) => boolean): boolean {
	return doseIds.length > 0 && doseIds.every((id) => isDoseTaken(id));
}
