import type { Locator, Page } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const MED_NAME = "Button Height Guard Med";

function actionGroupSelector() {
	return [
		'[data-testid="app-modal-footer"]',
		'[data-testid="planner-actions"]',
		".dose-person",
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

async function expectVisibleActionGroupsHaveReadableButtonText(pagePath: string, page: Page) {
	const violations = await page.evaluate((selector) => {
		function isVisible(element: HTMLElement) {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
		}

		function uniqueControls(group: HTMLElement) {
			const controls = Array.from(
				group.querySelectorAll<HTMLElement>('button, a[role="button"], .mantine-Button-root')
			).filter(isVisible);

			return controls.filter(
				(control, index) => !controls.some((other, otherIndex) => otherIndex < index && other.contains(control))
			);
		}

		function textRect(element: HTMLElement) {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let rect: DOMRect | null = null;
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const text = node.textContent?.trim();
				if (!text) continue;

				const range = document.createRange();
				range.selectNodeContents(node);
				const nextRect = range.getBoundingClientRect();
				range.detach();
				if (nextRect.width <= 0 || nextRect.height <= 0) continue;

				rect = rect
					? DOMRect.fromRect({
							x: Math.min(rect.left, nextRect.left),
							y: Math.min(rect.top, nextRect.top),
							width: Math.max(rect.right, nextRect.right) - Math.min(rect.left, nextRect.left),
							height: Math.max(rect.bottom, nextRect.bottom) - Math.min(rect.top, nextRect.top),
						})
					: nextRect;
			}
			return rect;
		}

		return Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((group) => {
			if (!isVisible(group)) return [];

			const groupLabel =
				group.getAttribute("data-testid") ||
				group.className
					.toString()
					.split(/\s+/)
					.find((className) => /actions|footer/i.test(className)) ||
				group.tagName.toLowerCase();
			const tolerance = 1.5;

			return uniqueControls(group).flatMap((control) => {
				const text = control.textContent?.trim().replace(/\s+/g, " ");
				if (!text) return [];

				const label = control.querySelector<HTMLElement>(".mantine-Button-label, .dose-btn-label") ?? control;
				const controlRect = control.getBoundingClientRect();
				const labelRect = textRect(label) ?? label.getBoundingClientRect();
				const controlStyle = window.getComputedStyle(control);
				const labelStyle = window.getComputedStyle(label);
				const boundsClipY =
					labelRect.top < controlRect.top - tolerance || labelRect.bottom > controlRect.bottom + tolerance;
				const boundsClipX =
					labelRect.left < controlRect.left - tolerance || labelRect.right > controlRect.right + tolerance;
				const controlOverflowY =
					control.scrollHeight > control.clientHeight + tolerance && controlStyle.overflowY !== "visible";
				const controlOverflowX =
					control.scrollWidth > control.clientWidth + tolerance && controlStyle.overflowX !== "visible";
				const labelOverflowY =
					label.scrollHeight > label.clientHeight + tolerance && labelStyle.overflowY !== "visible";
				const labelOverflowX = label.scrollWidth > label.clientWidth + tolerance && labelStyle.overflowX !== "visible";

				if (!boundsClipY && !boundsClipX && !controlOverflowY && !labelOverflowY && !labelOverflowX) {
					return [];
				}

				return [
					{
						boundsClipX,
						boundsClipY,
						controlOverflowX,
						controlOverflowY,
						controlHeight: Math.round(controlRect.height * 10) / 10,
						controlWidth: Math.round(controlRect.width * 10) / 10,
						group: groupLabel,
						labelLeft: Math.round(labelRect.left * 10) / 10,
						labelRight: Math.round(labelRect.right * 10) / 10,
						labelBottom: Math.round(labelRect.bottom * 10) / 10,
						labelOverflowX,
						labelOverflowY,
						labelTop: Math.round(labelRect.top * 10) / 10,
						text,
					},
				];
			});
		});
	}, actionGroupSelector());

	expect(violations, `${pagePath} has action button text clipping`).toEqual([]);
}

async function expectDoseStatusBackgroundHasEvenButtonPadding(row: Locator) {
	const metrics = await row.evaluate((element) => {
		const rowRect = element.getBoundingClientRect();
		const buttons = Array.from(element.querySelectorAll<HTMLElement>("button")).filter((button) => {
			const rect = button.getBoundingClientRect();
			const style = window.getComputedStyle(button);
			return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
		});
		const firstButtonRect = buttons[0]?.getBoundingClientRect();
		const lastButtonRect = buttons.at(-1)?.getBoundingClientRect();
		return {
			bottom: rowRect.bottom - Math.max(...buttons.map((button) => button.getBoundingClientRect().bottom)),
			left: firstButtonRect ? firstButtonRect.left - rowRect.left : 0,
			right: lastButtonRect ? rowRect.right - lastButtonRect.right : 0,
			top: Math.min(...buttons.map((button) => button.getBoundingClientRect().top)) - rowRect.top,
		};
	});

	const values = [metrics.top, metrics.right, metrics.bottom, metrics.left];
	for (const value of values) {
		expect(value).toBeGreaterThanOrEqual(3.5);
	}
	expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
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
					await expectVisibleActionGroupsHaveReadableButtonText(path, page);
				});
			}

			if (viewport.name === "desktop") {
				test("/dashboard keeps desktop intake recipient names on one line", async ({ page }) => {
					const medName = `${MED_NAME} Desktop Recipient`;
					const personName = "pillepallemann";
					await deleteAllMedicationsViaAPI();
					await createMedicationViaAPI({
						name: medName,
						takenBy: [personName],
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
								takenBy: personName,
							},
						],
					});
					await navigateTo(page, "/dashboard");

					const todayBlock = page.locator(".day-block.today");
					await expect(todayBlock).toBeVisible({ timeout: 10000 });
					await expect(todayBlock).toContainText(medName, { timeout: 10000 });
					const actionRow = todayBlock.locator(".dose-person", { hasText: personName }).first();
					await expect(actionRow).toBeVisible({ timeout: 10000 });
					const recipientName = actionRow.locator(".person-name").first();
					await expect(recipientName).toBeVisible();

					const metrics = await recipientName.evaluate((element) => {
						const range = document.createRange();
						range.selectNodeContents(element);
						const textRect = range.getBoundingClientRect();
						const textLineCount = Array.from(range.getClientRects()).filter(
							(rect) => rect.width > 0 && rect.height > 0
						).length;
						range.detach();

						const elementRect = element.getBoundingClientRect();
						const doseItemRect = element.closest(".dose-item")?.getBoundingClientRect();
						const actionRowRect = element.closest(".dose-person")?.getBoundingClientRect();
						const style = window.getComputedStyle(element);
						return {
							actionFitsInDoseItem:
								!doseItemRect ||
								!actionRowRect ||
								(actionRowRect.left >= doseItemRect.left - 1 && actionRowRect.right <= doseItemRect.right + 1),
							elementWidth: elementRect.width,
							textLineCount,
							textWidth: textRect.width,
							whiteSpace: style.whiteSpace,
						};
					});

					expect(metrics.whiteSpace).toBe("nowrap");
					expect(metrics.textLineCount).toBe(1);
					expect(metrics.elementWidth).toBeGreaterThanOrEqual(metrics.textWidth - 1);
					expect(metrics.actionFitsInDoseItem).toBe(true);
				});

				test("/dashboard keeps skip action slot width stable after skipping", async ({ page }) => {
					const medName = `${MED_NAME} Desktop Skip`;
					await deleteAllMedicationsViaAPI();
					await createMedicationViaAPI({
						name: medName,
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
					await navigateTo(page, "/dashboard");

					const todayBlock = page.locator(".day-block.today");
					await expect(todayBlock).toBeVisible({ timeout: 10000 });
					await expect(todayBlock).toContainText(medName, { timeout: 10000 });
					const actionRow = todayBlock.locator(".dose-person").first();
					const skipButton = actionRow.getByRole("button", { name: /^Skip$/ }).first();
					await expect(skipButton).toBeVisible({ timeout: 10000 });
					const rowWidthBefore = (await actionRow.boundingBox())?.width ?? 0;
					const skipWidth = (await skipButton.boundingBox())?.width ?? 0;

					const skipResponsePromise = page.waitForResponse(
						(response) => response.url().includes("/api/doses/skip") && response.request().method() === "POST",
						{ timeout: 10000 }
					);
					await skipButton.click();
					const skipResponse = await skipResponsePromise;
					expect(skipResponse.ok()).toBe(true);

					const undoButton = actionRow.getByRole("button", { name: /^Undo/ }).first();
					await expect(undoButton).toBeVisible({ timeout: 10000 });
					const rowWidthAfter = (await actionRow.boundingBox())?.width ?? 0;
					const undoWidth = (await undoButton.boundingBox())?.width ?? 0;
					expect(Math.abs(undoWidth - skipWidth)).toBeLessThanOrEqual(1);
					expect(Math.abs(rowWidthAfter - rowWidthBefore)).toBeLessThanOrEqual(1);
				});
			}

			if (viewport.name === "mobile") {
				test("/dashboard keeps skip undo button text readable after skipping", async ({ page }) => {
					const medName = `${MED_NAME} Skip Undo`;
					await deleteAllMedicationsViaAPI();
					await createMedicationViaAPI({
						name: medName,
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
					await navigateTo(page, "/dashboard");

					const todayBlock = page.locator(".day-block.today");
					await expect(todayBlock).toBeVisible({ timeout: 10000 });
					await expect(todayBlock).toContainText(medName, { timeout: 10000 });
					const skipButton = todayBlock.getByRole("button", { name: /^Skip$/ }).first();
					await expect(skipButton).toBeVisible({ timeout: 10000 });

					const skipResponsePromise = page.waitForResponse(
						(response) => response.url().includes("/api/doses/skip") && response.request().method() === "POST",
						{ timeout: 10000 }
					);
					await skipButton.click();
					const skipResponse = await skipResponsePromise;
					expect(skipResponse.ok()).toBe(true);

					const undoButton = todayBlock.getByRole("button", { name: /^Undo/ }).first();
					await expect(undoButton).toBeVisible({ timeout: 10000 });
					await expect.poll(async () => (await undoButton.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(96);
					await expectDoseStatusBackgroundHasEvenButtonPadding(todayBlock.locator(".dose-person.skipped").first());
					await expectVisibleActionGroupsHaveReadableButtonText("mobile /dashboard skipped dose", page);
				});
			}
		});
	}
});
