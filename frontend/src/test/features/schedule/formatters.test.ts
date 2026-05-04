import { describe, expect, it } from "vitest";
import { formatScheduleDoseUsageLabel, formatScheduleTotalUsageLabel } from "../../../features/schedule/formatters";

const t = (key: string, options?: Record<string, unknown>): string => {
	switch (key) {
		case "form.packageAmountUnitMl":
			return "ml";
		case "form.blisters.teaspoons":
			return Number(options?.count) === 1 ? "teaspoon" : "teaspoons";
		case "form.blisters.tablespoons":
			return Number(options?.count) === 1 ? "tablespoon" : "tablespoons";
		case "form.blisters.applications":
			return Number(options?.count) === 1 ? "application" : "applications";
		case "common.pill":
			return "pill";
		case "common.pills":
			return "pills";
		case "common.pillsTotal":
			return `${options?.count ?? 0} pills total`;
		default:
			return key;
	}
};

describe("schedule formatters", () => {
	it("formats liquid dose labels in base and converted units", () => {
		expect(formatScheduleDoseUsageLabel({ packageType: "liquid_container" }, 0, t, "ml")).toBe("0 ml");
		expect(formatScheduleDoseUsageLabel({ packageType: "liquid_container" }, 2, t, "tsp")).toBe("2 teaspoons 10 ml");
	});

	it("formats tube doses as applications by default and ml for liquid forms", () => {
		expect(formatScheduleDoseUsageLabel({ packageType: "tube" }, 1, t)).toBe("1 application");
		expect(formatScheduleDoseUsageLabel({ packageType: "tube", medicationForm: "liquid" }, 3, t)).toBe("3 ml");
	});

	it("formats liquid totals from dose units and mixed-unit conversion", () => {
		expect(
			formatScheduleTotalUsageLabel(
				{ packageType: "liquid_container" },
				0,
				t,
				[
					{ usage: 1, intakeUnit: "tsp" },
					{ usage: 2, intakeUnit: "tsp" },
				],
				"ml"
			)
		).toBe("3 teaspoons 15 ml");

		expect(
			formatScheduleTotalUsageLabel(
				{ packageType: "liquid_container" },
				0,
				t,
				[
					{ usage: 1, intakeUnit: "tsp" },
					{ usage: 1, intakeUnit: "tbsp" },
				],
				"ml"
			)
		).toBe("20 ml");
	});

	it("falls back to total and non-liquid totals when dose list is not usable", () => {
		expect(
			formatScheduleTotalUsageLabel(
				{ packageType: "liquid_container" },
				4,
				t,
				[{ usage: -1, intakeUnit: "ml" }],
				"tbsp"
			)
		).toBe("4 tablespoons 60 ml");
		expect(formatScheduleTotalUsageLabel({ packageType: "blister" }, 3, t)).toBe("3 pills total");
	});
});
