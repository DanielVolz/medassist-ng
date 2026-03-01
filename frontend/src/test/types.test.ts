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

	it("calculates bottle type from looseTablets only", () => {
		const med = {
			packageType: "bottle" as const,
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 150,
		};

		expect(getMedTotal(med)).toBe(150);
	});

	it("calculates bottle type with stock adjustment", () => {
		const med = {
			packageType: "bottle" as const,
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 150,
			stockAdjustment: -10,
		};

		expect(getMedTotal(med)).toBe(140); // 150 + (-10) = 140
	});

	it("ignores blister fields for bottle type", () => {
		const med = {
			packageType: "bottle" as const,
			packCount: 5,
			blistersPerPack: 10,
			pillsPerBlister: 20,
			looseTablets: 80,
		};

		// Should use looseTablets only, NOT 5*10*20 + 80 = 1080
		expect(getMedTotal(med)).toBe(80);
	});

	it("calculates tube/liquid totals from amount fields, not blister math", () => {
		const tube = {
			packageType: "tube" as const,
			packCount: 4,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 600,
			looseTablets: 600,
			stockAdjustment: 4,
		};
		const liquid = {
			packageType: "liquid_container" as const,
			packCount: 3,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 450,
			looseTablets: 450,
		};

		expect(getMedTotal(tube)).toBe(604);
		expect(getMedTotal(liquid)).toBe(450);
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

	it("returns looseTablets for bottle type", () => {
		const med = {
			packageType: "bottle" as const,
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 200,
		};

		expect(getPackageSize(med)).toBe(200);
	});

	it("ignores blister fields for bottle type", () => {
		const med = {
			packageType: "bottle" as const,
			packCount: 5,
			blistersPerPack: 10,
			pillsPerBlister: 20,
			looseTablets: 80,
			stockAdjustment: 50,
		};

		// Should use looseTablets only, ignore stockAdjustment and blister math
		expect(getPackageSize(med)).toBe(80);
	});

	it("returns totalPills for tube/liquid container package size", () => {
		const tube = {
			packageType: "tube" as const,
			packCount: 4,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 600,
			looseTablets: 600,
		};
		const liquid = {
			packageType: "liquid_container" as const,
			packCount: 3,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 450,
			looseTablets: 450,
		};

		expect(getPackageSize(tube)).toBe(600);
		expect(getPackageSize(liquid)).toBe(450);
	});
});

describe("FIELD_LIMITS", () => {
	it("has correct limits for name field", () => {
		expect(FIELD_LIMITS.name.min).toBe(0);
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
