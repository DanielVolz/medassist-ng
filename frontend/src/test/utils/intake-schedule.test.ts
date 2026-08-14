import { describe, expect, it } from "vitest";
import { getMedicationIntakes } from "../../utils/intake-schedule";

describe("getMedicationIntakes", () => {
	it("preserves an explicit empty schedule instead of falling back to legacy blisters", () => {
		expect(
			getMedicationIntakes({
				intakes: [],
				blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
			})
		).toEqual([]);
	});

	it("uses legacy blisters only when the intakes field is absent", () => {
		expect(
			getMedicationIntakes({
				blisters: [{ usage: 1, every: 1, start: "2026-01-01T08:00:00" }],
			})
		).toHaveLength(1);
	});
});
