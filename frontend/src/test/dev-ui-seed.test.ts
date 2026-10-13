import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { demoMedications } from "../../../tools/ui-sandbox/seed.mjs";
import type { Medication } from "../types";
import { buildSchedulePreview, calculateCoverage, getStockStatus } from "../utils/schedule";

const assetsDir = resolve(process.cwd(), "../tools/ui-sandbox/assets");

describe("local UI sandbox medication seed", () => {
	it("bundles an attributed illustration for every seeded medication", () => {
		const imageAssets = demoMedications.map(({ imageAsset }) => imageAsset);
		expect(new Set(imageAssets).size).toBe(demoMedications.length);

		for (const imageAsset of imageAssets) {
			const assetPath = resolve(assetsDir, imageAsset);
			expect(existsSync(assetPath), `${imageAsset} should be available locally`).toBe(true);
			expect(readFileSync(assetPath, "utf8")).toMatch(/<svg\b/);
		}

		const attribution = readFileSync(resolve(assetsDir, "README.md"), "utf8");
		expect(attribution).toContain("CC0 1.0 Universal");
		expect(attribution).toContain("No external images, fonts, logos, or other assets");
	});

	it("keeps every seeded medication above critical and empty status using the app stock calculation", () => {
		const medications = demoMedications.map(({ medication }, index) => {
			const intakes = medication.intakes;
			return {
				...medication,
				packageType: medication.packageType as Medication["packageType"],
				medicationForm: medication.medicationForm as Medication["medicationForm"],
				pillForm: medication.pillForm as Medication["pillForm"],
				packageAmountUnit: medication.packageAmountUnit as Medication["packageAmountUnit"],
				doseUnit: medication.doseUnit as Medication["doseUnit"],
				id: index + 1,
				blisters: intakes.map(({ usage, every, start }) => ({ usage, every, start })),
				updatedAt: new Date().toISOString(),
			} as Medication;
		});

		const { events } = buildSchedulePreview(medications, "en-US");
		const coverage = calculateCoverage(medications, events, "en-US", 7, "automatic", new Set());

		for (const medication of medications) {
			const row = coverage.all.find((item) => item.name === medication.name);
			expect(row, `${medication.name} should have a stock projection`).toBeDefined();
			const status = getStockStatus(
				row?.daysLeft ?? null,
				row?.medsLeft ?? 0,
				{ lowStockDays: 30, normalStockDays: 30, highStockDays: 180, criticalStockDays: 7, expiryWarningDays: 30 },
				medication.packageType
			);
			expect(["critical", "out-of-stock"]).not.toContain(status.level);
		}
	});
});
