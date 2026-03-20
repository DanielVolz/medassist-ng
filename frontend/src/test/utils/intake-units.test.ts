import { describe, expect, it, vi } from "vitest";

import { convertLiquidUsageToMl, getLiquidCountUnitLabel } from "../../utils/intake-units";

describe("intake-units", () => {
	it("keeps ml unchanged and converts teaspoon and tablespoon usage to ml", () => {
		expect(convertLiquidUsageToMl(12, "ml")).toBe(12);
		expect(convertLiquidUsageToMl(2, "tsp")).toBe(10);
		expect(convertLiquidUsageToMl(3, "tbsp")).toBe(45);
	});

	it("returns the existing liquid usage labels for each intake unit", () => {
		const t = vi.fn((key: string) => key);

		expect(getLiquidCountUnitLabel("ml", 2, t)).toBe("form.packageAmountUnitMl");
		expect(getLiquidCountUnitLabel("tsp", 2, t)).toBe("form.blisters.teaspoons");
		expect(getLiquidCountUnitLabel("tbsp", 3, t)).toBe("form.blisters.tablespoons");

		expect(t).toHaveBeenNthCalledWith(1, "form.packageAmountUnitMl");
		expect(t).toHaveBeenNthCalledWith(2, "form.blisters.teaspoons", { count: 2 });
		expect(t).toHaveBeenNthCalledWith(3, "form.blisters.tablespoons", { count: 3 });
	});
});
