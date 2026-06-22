import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
} from "./fixtures";

test.describe("MedDetail footer tooltip visibility", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 60000 });

	const MED_NAME = "Tooltip Test Med";
	const createdMeds: TestMedication[] = [];

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
		createdMeds.push(
			await createMedicationViaAPI({
				name: MED_NAME,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				intakes: [
					{
						usage: 1,
						every: 1,
						start: new Date().toISOString().slice(0, 16),
						intakeRemindersEnabled: false,
					},
				],
			})
		);
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	async function openMedDetailModal(page: import("@playwright/test").Page) {
		await navigateTo(page, "/dashboard");
		const overviewTable = page.getByTestId("dashboard-overview-table");
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const medRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_NAME }).first();
		await medRow.click();

		const modal = page
			.getByRole("dialog")
			.filter({ has: page.getByRole("heading", { name: MED_NAME }) })
			.last();
		await expect(modal).toBeVisible({ timeout: 5000 });
		return modal;
	}

	async function expectTooltipAboveModal(page: import("@playwright/test").Page, label: RegExp) {
		const tooltip = page.getByRole("tooltip").filter({ hasText: label });
		await expect(tooltip).toBeVisible();
		await expect
			.poll(async () => {
				const zIndex = await tooltip.evaluate((element) => getComputedStyle(element).zIndex);
				return Number.parseInt(zIndex, 10);
			})
			.toBeGreaterThan(2400);
	}

	test("footer action buttons stay visible inside the Mantine detail modal", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		await expect(modal.getByRole("button", { name: /Refill|refill\.button/i })).toBeVisible();
		await expect(modal.getByLabel(/Edit|common\.edit/i)).toBeVisible();
		await expect(modal.getByLabel(/Stock|editStock\.buttonLabel|Bestand/i)).toBeVisible();
	});

	test("footer Mantine tooltips are visible on hover", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		const editButton = modal.getByLabel(/Edit|common\.edit/i);
		await editButton.hover();
		await expectTooltipAboveModal(page, /Edit|common\.edit/i);

		const stockButton = modal.getByLabel(/Stock|editStock\.buttonLabel|Bestand/i);
		await stockButton.hover();
		await expectTooltipAboveModal(page, /Stock|editStock\.buttonLabel|Bestand/i);

		const calendarButton = modal.getByLabel(/Calendar|Export|Kalender|modal\.exportTooltip/i);
		await calendarButton.hover();
		await expectTooltipAboveModal(page, /Calendar|Export|Kalender|modal\.exportTooltip/i);
	});

	test("close button remains visible after scrolling detail content", async ({ page }) => {
		const modal = await openMedDetailModal(page);
		const closeButton = modal.getByLabel(/Close|common\.close/i).first();

		await modal.evaluate((element) => {
			const scrollable = Array.from(element.querySelectorAll("div")).find(
				(candidate) => candidate.scrollHeight > candidate.clientHeight
			);
			if (scrollable) {
				scrollable.scrollTop = scrollable.scrollHeight;
			}
		});

		await expect(closeButton).toBeVisible();
	});
});
