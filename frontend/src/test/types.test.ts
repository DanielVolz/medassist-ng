import { describe, expect, it } from "vitest";
import { FIELD_LIMITS, getMedTotal, getPackageSize } from "../types";

describe("getMedTotal", () => {
	it("calculates total pills without stock adjustment", () => {
		const med = {
			packCount: 2,
			blistersPerPack: 3,
			pillsPerBlister: 10,
			looseTablets: 5,
		};

		expect(getMedTotal(med)).toBe(65); // 2*3*10 + 5 = 65
	});

	it("includes positive stock adjustment", () => {
		const med = {
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			stockAdjustment: 5,
		};

		expect(getMedTotal(med)).toBe(15); // 10 + 5 = 15
	});

	it("includes negative stock adjustment", () => {
		const med = {
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			stockAdjustment: -3,
		};

		expect(getMedTotal(med)).toBe(7); // 10 - 3 = 7
	});

	it("handles undefined stock adjustment", () => {
		const med = {
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			stockAdjustment: undefined,
		};

		expect(getMedTotal(med)).toBe(10);
	});

	it("handles zero values", () => {
		const med = {
			packCount: 0,
			blistersPerPack: 0,
			pillsPerBlister: 0,
			looseTablets: 0,
		};

		expect(getMedTotal(med)).toBe(0);
	});
});

describe("getPackageSize", () => {
	it("calculates base package size", () => {
		const med = {
			packCount: 2,
			blistersPerPack: 3,
			pillsPerBlister: 10,
			looseTablets: 5,
		};

		expect(getPackageSize(med)).toBe(65);
	});

	it("ignores stock adjustment", () => {
		const med = {
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			looseTablets: 0,
			stockAdjustment: 100, // Should be ignored
		};

		expect(getPackageSize(med)).toBe(10);
	});
});

describe("FIELD_LIMITS", () => {
	it("has correct limits for name field", () => {
		expect(FIELD_LIMITS.name.min).toBe(1);
		expect(FIELD_LIMITS.name.max).toBe(100);
	});

	it("has correct limits for genericName field", () => {
		expect(FIELD_LIMITS.genericName.max).toBe(100);
	});

	it("has correct limits for takenBy field", () => {
		expect(FIELD_LIMITS.takenBy.max).toBe(100);
	});

	it("has correct limits for notes field", () => {
		expect(FIELD_LIMITS.notes.max).toBe(2000);
	});
});
