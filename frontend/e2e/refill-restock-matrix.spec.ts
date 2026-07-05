import type { Page } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

type PackageType = "blister" | "bottle" | "tube" | "liquid_container" | "inhaler" | "injection";

type MedicationSnapshot = {
	id: number;
	name: string;
	packageType: PackageType;
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	looseTablets: number;
	totalPills: number | null;
	stockAdjustment: number;
	packageAmountValue: number | null;
};

type Scenario = {
	label: string;
	create: Parameters<typeof createMedicationViaAPI>[0];
	stockCorrectionInputs: number[];
	expectedAfterCorrection: number;
	refillInputs: number[];
	expectedRefillAdded: number;
	expectedFinalStock: number;
	expectedCapacity: number;
	expectedPackageAmountValue?: number;
};

function tomorrowMorningLocal() {
	const date = new Date();
	date.setDate(date.getDate() + 1);
	date.setHours(8, 0, 0, 0);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function currentStock(med: MedicationSnapshot) {
	const adjustment = med.stockAdjustment ?? 0;
	if (med.packageType === "blister") {
		return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + adjustment;
	}
	return med.looseTablets + adjustment;
}

function displayCapacity(med: MedicationSnapshot) {
	if (med.packageType === "tube" || med.packageType === "liquid_container") {
		const amountPerPackage = med.packageAmountValue ?? 0;
		if (amountPerPackage > 0) {
			return Math.max(1, med.packCount || 1) * amountPerPackage;
		}
	}
	if (med.packageType === "bottle" || med.packageType === "inhaler" || med.packageType === "injection") {
		return med.totalPills ?? med.looseTablets;
	}
	return med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets;
}

async function getMedication(page: Page, id: number): Promise<MedicationSnapshot> {
	const response = await page.request.get("/api/medications");
	expect(response.ok()).toBeTruthy();
	const medications = (await response.json()) as MedicationSnapshot[];
	const medication = medications.find((item) => item.id === id);
	expect(medication).toBeTruthy();
	return medication as MedicationSnapshot;
}

async function getRefillHistory(page: Page, id: number): Promise<Array<{ quantityAdded: number }>> {
	const response = await page.request.get(`/api/medications/${id}/refills`);
	expect(response.ok()).toBeTruthy();
	return response.json() as Promise<Array<{ quantityAdded: number }>>;
}

async function openMedicationDetail(page: Page, medName: string) {
	await navigateTo(page, "/dashboard");
	const overviewTable = page.getByTestId("dashboard-overview-table");
	await expect(overviewTable).toBeVisible({ timeout: 10000 });
	const medRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: medName }).first();
	await expect(medRow).toBeVisible({ timeout: 10000 });
	await medRow.getByRole("button", { name: medName }).click();

	const modal = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: medName }) })
		.last();
	await expect(modal).toBeVisible({ timeout: 5000 });
	return modal;
}

async function fillNumberInput(page: Page, index: number, value: number) {
	const input = page.getByRole("dialog").last().getByRole("spinbutton").nth(index);
	await expect(input).toBeVisible();
	await input.fill(String(value));
}

test.describe("Refill and stock correction package matrix", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 180000, mode: "serial" });

	const start = tomorrowMorningLocal();
	const scenarios: Scenario[] = [
		{
			label: "blister",
			create: {
				name: "Matrix Blister Refill",
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 2,
				pillsPerBlister: 5,
				looseTablets: 1,
				intakes: [{ usage: 1, every: 1, start, intakeRemindersEnabled: false }],
			},
			stockCorrectionInputs: [2, 0, 2],
			expectedAfterCorrection: 12,
			refillInputs: [1, 3],
			expectedRefillAdded: 13,
			expectedFinalStock: 25,
			expectedCapacity: 35,
		},
		{
			label: "bottle",
			create: {
				name: "Matrix Bottle Refill",
				packageType: "bottle",
				totalPills: 100,
				looseTablets: 40,
				intakes: [{ usage: 1, every: 1, start, intakeRemindersEnabled: false }],
			},
			stockCorrectionInputs: [55],
			expectedAfterCorrection: 55,
			refillInputs: [20],
			expectedRefillAdded: 20,
			expectedFinalStock: 75,
			expectedCapacity: 100,
		},
		{
			label: "tube",
			create: {
				name: "Matrix Tube Refill",
				packageType: "tube",
				medicationForm: "topical",
				packageAmountValue: 40,
				totalPills: 40,
				looseTablets: 40,
				intakes: [{ usage: 2, every: 1, start, intakeRemindersEnabled: false }],
			},
			stockCorrectionInputs: [24],
			expectedAfterCorrection: 24,
			refillInputs: [1],
			expectedRefillAdded: 40,
			expectedFinalStock: 64,
			expectedCapacity: 80,
			expectedPackageAmountValue: 40,
		},
		{
			label: "liquid_container",
			create: {
				name: "Matrix Liquid Refill",
				packageType: "liquid_container",
				medicationForm: "liquid",
				packCount: 1,
				packageAmountValue: 180,
				totalPills: 180,
				looseTablets: 180,
				intakes: [{ usage: 5, every: 1, start, intakeRemindersEnabled: false }],
			},
			stockCorrectionInputs: [90],
			expectedAfterCorrection: 90,
			refillInputs: [1],
			expectedRefillAdded: 180,
			expectedFinalStock: 270,
			expectedCapacity: 360,
			expectedPackageAmountValue: 180,
		},
		{
			label: "inhaler",
			create: {
				name: "Matrix Inhaler Refill",
				packageType: "inhaler",
				totalPills: 200,
				looseTablets: 80,
				intakes: [{ usage: 2, every: 1, start, intakeRemindersEnabled: false }],
			},
			stockCorrectionInputs: [110],
			expectedAfterCorrection: 110,
			refillInputs: [40],
			expectedRefillAdded: 40,
			expectedFinalStock: 150,
			expectedCapacity: 200,
		},
		{
			label: "injection",
			create: {
				name: "Matrix Injection Refill",
				packageType: "injection",
				totalPills: 12,
				looseTablets: 4,
				intakes: [{ usage: 1, every: 7, start, intakeRemindersEnabled: false }],
			},
			stockCorrectionInputs: [5],
			expectedAfterCorrection: 5,
			refillInputs: [3],
			expectedRefillAdded: 3,
			expectedFinalStock: 8,
			expectedCapacity: 12,
		},
	];

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("corrects stock and refills every package type through the web UI", async ({ page }) => {
		for (const scenario of scenarios) {
			await test.step(`${scenario.label}: create, correct stock, refill`, async () => {
				const med = await createMedicationViaAPI(scenario.create);

				let modal = await openMedicationDetail(page, scenario.create.name);
				await modal
					.getByRole("button", {
						name: /^(Correct Stock\/Partial Blister|Bestand\/Angebrochene Blister korrigieren|editStock\.buttonLabel)$/i,
					})
					.click();
				const stockDialog = page
					.getByRole("dialog")
					.filter({ has: page.getByRole("heading", { name: /Correct Stock|Bestand korrigieren|editStock\.title/i }) })
					.last();
				await expect(stockDialog).toBeVisible({ timeout: 5000 });
				for (const [index, value] of scenario.stockCorrectionInputs.entries()) {
					await fillNumberInput(page, index, value);
				}
				await stockDialog.getByRole("button", { name: /Save Correction|Korrektur speichern|editStock\.save/i }).click();
				await expect(stockDialog).not.toBeVisible({ timeout: 10000 });
				await expect
					.poll(async () => currentStock(await getMedication(page, med.id)), { timeout: 10000 })
					.toBe(scenario.expectedAfterCorrection);

				await modal
					.getByLabel(/Close|Schließen|common\.close/i)
					.first()
					.click();
				await expect(modal).not.toBeVisible({ timeout: 5000 });

				modal = await openMedicationDetail(page, scenario.create.name);
				await modal.getByRole("button", { name: /Refill|Nachfüllen|refill\.button/i }).click();
				const refillDialog = page
					.getByRole("dialog")
					.filter({ has: page.getByRole("heading", { name: /^(Refill|Nachfüllen|refill\.title)$/i }) })
					.last();
				await expect(refillDialog).toBeVisible({ timeout: 5000 });
				for (const [index, value] of scenario.refillInputs.entries()) {
					await fillNumberInput(page, index, value);
				}
				await expect(refillDialog.getByText(new RegExp(`\\+${scenario.expectedRefillAdded}\\b`)).first()).toBeVisible();
				await refillDialog.getByRole("button", { name: /Refill|Nachfüllen|refill\.button/i }).click();
				await expect(refillDialog).not.toBeVisible({ timeout: 10000 });
				await expect
					.poll(async () => currentStock(await getMedication(page, med.id)), { timeout: 10000 })
					.toBe(scenario.expectedFinalStock);

				const updated = await getMedication(page, med.id);
				expect(displayCapacity(updated)).toBe(scenario.expectedCapacity);
				if (scenario.expectedPackageAmountValue !== undefined) {
					expect(updated.packageAmountValue).toBe(scenario.expectedPackageAmountValue);
				}
				const refills = await getRefillHistory(page, med.id);
				expect(refills[0]?.quantityAdded).toBe(scenario.expectedRefillAdded);

				await modal
					.getByLabel(/Close|Schließen|common\.close/i)
					.first()
					.click();
				await expect(modal).not.toBeVisible({ timeout: 5000 });
			});
		}
	});
});
