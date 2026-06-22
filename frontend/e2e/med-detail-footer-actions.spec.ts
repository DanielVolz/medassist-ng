import type { Locator, Page } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const MED_NAME = "Mobile Footer Actions Med";
const PERSON_NAME = "Footer Person";

async function openMedicationDetailModal(page: Page) {
	await navigateTo(page, "/dashboard");
	const overviewTable = page.getByTestId("dashboard-overview-table");
	await expect(overviewTable).toBeVisible({ timeout: 10000 });
	const medRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_NAME }).first();
	await medRow.getByRole("button", { name: MED_NAME }).click();

	const modal = page
		.getByRole("dialog")
		.filter({ has: page.getByRole("heading", { name: MED_NAME }) })
		.last();
	await expect(modal).toBeVisible();
	return modal;
}

async function scrollModalContentToBottom(modal: Locator) {
	await modal.evaluate((element) => {
		const scrollContainers = Array.from(element.querySelectorAll<HTMLElement>("*")).filter((candidate) => {
			const style = window.getComputedStyle(candidate);
			return /(auto|scroll)/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 2;
		});
		for (const container of scrollContainers) {
			container.scrollTop = container.scrollHeight;
		}
	});
}

test.describe("Medication detail footer actions", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ mode: "serial", timeout: 90000 });

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: MED_NAME,
			takenBy: [PERSON_NAME],
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			intakes: [
				{
					usage: 1,
					every: 1,
					start: new Date().toISOString().slice(0, 16),
					intakeRemindersEnabled: false,
					takenBy: PERSON_NAME,
				},
			],
		});
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	for (const viewport of [
		{ name: "desktop", size: { width: 1280, height: 720 } },
		{ name: "mobile", size: { width: 390, height: 844 } },
	]) {
		test.describe(viewport.name, () => {
			test.use({ viewport: viewport.size });

			test("keeps close, refill, and icon actions in a compact action bar", async ({ page }, testInfo) => {
				const modal = await openMedicationDetailModal(page);
				await scrollModalContentToBottom(modal);

				const footer = modal.getByTestId("app-modal-footer").last();
				await expect(footer).toBeVisible();
				await page.screenshot({ path: testInfo.outputPath(`med-detail-footer-${viewport.name}.png`), fullPage: false });

				const metrics = await footer.evaluate((footerElement) => {
					const footerRect = footerElement.getBoundingClientRect();
					const buttons = Array.from(footerElement.querySelectorAll<HTMLButtonElement>("button"))
						.filter((button) => {
							const rect = button.getBoundingClientRect();
							return rect.width > 0 && rect.height > 0;
						})
						.map((button) => {
							const rect = button.getBoundingClientRect();
							const visibleText = button.textContent?.trim() ?? "";
							return {
								ariaLabel: button.getAttribute("aria-label") ?? "",
								height: rect.height,
								isIconOnly: visibleText.length === 0,
								left: rect.left,
								right: rect.right,
								text: visibleText,
								top: rect.top,
								width: rect.width,
							};
						});

					const rowTops = buttons.reduce<number[]>((rows, button) => {
						if (!rows.some((rowTop) => Math.abs(rowTop - button.top) <= 6)) {
							rows.push(button.top);
						}
						return rows;
					}, []);

					return {
						buttons,
						footerWidth: footerRect.width,
						rowCount: rowTops.length,
					};
				});

				const iconButtons = metrics.buttons.filter((button) => button.isIconOnly);
				const textButtons = metrics.buttons.filter((button) => !button.isIconOnly);
				const iconTopSpread =
					Math.max(...iconButtons.map((button) => button.top)) - Math.min(...iconButtons.map((button) => button.top));
				const textTopSpread =
					Math.max(...textButtons.map((button) => button.top)) - Math.min(...textButtons.map((button) => button.top));
				const allTopSpread =
					Math.max(...metrics.buttons.map((button) => button.top)) -
					Math.min(...metrics.buttons.map((button) => button.top));
				const buttonHeightSpread =
					Math.max(...metrics.buttons.map((button) => button.height)) -
					Math.min(...metrics.buttons.map((button) => button.height));
				const maxTextButtonWidth = Math.max(...textButtons.map((button) => button.width));

				expect(metrics.buttons).toHaveLength(5);
				expect(iconButtons).toHaveLength(3);
				expect(textButtons.map((button) => button.text)).toEqual(["Close", "Refill"]);
				expect(metrics.rowCount).toBe(1);
				expect(buttonHeightSpread).toBeLessThanOrEqual(1);
				expect(allTopSpread).toBeLessThanOrEqual(1);
				expect(iconTopSpread).toBeLessThanOrEqual(8);
				expect(textTopSpread).toBeLessThanOrEqual(8);
				expect(maxTextButtonWidth).toBeLessThan(metrics.footerWidth * 0.72);
			});
		});
	}
});
