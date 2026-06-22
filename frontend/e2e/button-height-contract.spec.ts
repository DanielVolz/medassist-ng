import type { Page } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const MED_NAME = "Button Height Guard Med";

function actionGroupSelector() {
	return [
		'[data-testid="app-modal-footer"]',
		'[data-testid="planner-actions"]',
		'[class*="actions"]',
		'[class*="Actions"]',
		'[class*="footer"]',
		'[class*="Footer"]',
	].join(",");
}

async function expectVisibleActionGroupsHaveAlignedButtons(pagePath: string, page: Page) {
	const violations = await page.evaluate((selector) => {
		function isVisible(element: HTMLElement) {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
		}

		function uniqueControls(group: HTMLElement) {
			const controls = Array.from(
				group.querySelectorAll<HTMLElement>(
					'button, a[role="button"], .mantine-Button-root, .mantine-ActionIcon-root, select'
				)
			).filter(isVisible);

			return controls.filter(
				(control, index) => !controls.some((other, otherIndex) => otherIndex < index && other.contains(control))
			);
		}

		function rowKey(control: HTMLElement) {
			return Math.round(control.getBoundingClientRect().top / 3) * 3;
		}

		return Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((group) => {
			if (!isVisible(group)) return [];

			const controls = uniqueControls(group);
			if (controls.length < 2) return [];

			const rows = new Map<number, HTMLElement[]>();
			for (const control of controls) {
				const key = rowKey(control);
				rows.set(key, [...(rows.get(key) ?? []), control]);
			}

			const groupLabel =
				group.getAttribute("data-testid") ||
				group.className
					.toString()
					.split(/\s+/)
					.find((className) => /actions|footer/i.test(className)) ||
				group.tagName.toLowerCase();

			return Array.from(rows.values()).flatMap((rowControls) => {
				if (rowControls.length < 2) return [];

				const heights = rowControls.map((control) => control.getBoundingClientRect().height);
				const spread = Math.max(...heights) - Math.min(...heights);
				if (spread <= 1.5) return [];

				return [
					{
						group: groupLabel,
						heights: heights.map((height) => Math.round(height * 10) / 10),
						labels: rowControls.map(
							(control) =>
								control.getAttribute("aria-label") ||
								control.textContent?.trim().replace(/\s+/g, " ") ||
								control.tagName
						),
						spread: Math.round(spread * 10) / 10,
					},
				];
			});
		});
	}, actionGroupSelector());

	expect(violations, `${pagePath} has misaligned action buttons`).toEqual([]);
}

test.describe("Button height contract", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ mode: "serial", timeout: 90000 });

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: MED_NAME,
			takenBy: ["Button Person"],
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			intakes: [
				{
					usage: 1,
					every: 1,
					start: new Date().toISOString().slice(0, 16),
					intakeRemindersEnabled: true,
					takenBy: "Button Person",
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

			for (const path of ["/dashboard", "/schedule", "/planner", "/medications", "/settings"]) {
				test(`${path} keeps action buttons aligned`, async ({ page }) => {
					await navigateTo(page, path);
					await expectVisibleActionGroupsHaveAlignedButtons(path, page);
				});
			}
		});
	}
});
