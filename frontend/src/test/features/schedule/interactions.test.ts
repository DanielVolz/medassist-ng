import { describe, expect, it } from "vitest";
import {
	areAllDoseIdsTaken,
	countTakenDoseIds,
	resolveCollapsedState,
	toggleDateInSet,
} from "../../../features/schedule/interactions";

describe("schedule interactions", () => {
	it("toggles dates without mutating the original set", () => {
		const previous = new Set(["2026-01-01"]);
		const added = toggleDateInSet(previous, "2026-01-02");
		const removed = toggleDateInSet(added, "2026-01-01");

		expect(previous).toEqual(new Set(["2026-01-01"]));
		expect(added).toEqual(new Set(["2026-01-01", "2026-01-02"]));
		expect(removed).toEqual(new Set(["2026-01-02"]));
	});

	it("resolves auto and manual collapsed states", () => {
		expect(resolveCollapsedState(true, "2026-01-01", new Set(), new Set())).toBe(true);
		expect(resolveCollapsedState(true, "2026-01-01", new Set(["2026-01-01"]), new Set())).toBe(false);
		expect(resolveCollapsedState(false, "2026-01-01", new Set(), new Set(["2026-01-01"]))).toBe(true);
	});

	it("counts and checks taken dose ids", () => {
		const taken = new Set(["a", "c"]);
		const isDoseTaken = (doseId: string) => taken.has(doseId);

		expect(countTakenDoseIds(["a", "b", "c"], isDoseTaken)).toBe(2);
		expect(areAllDoseIdsTaken(["a", "c"], isDoseTaken)).toBe(true);
		expect(areAllDoseIdsTaken(["a", "b"], isDoseTaken)).toBe(false);
		expect(areAllDoseIdsTaken([], isDoseTaken)).toBe(false);
	});
});
