import type { Locator, Page } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	test,
	updateSettingsViaAPI,
} from "./fixtures";

const MED_NAME = "Button Height Guard Med";

function dueIntakeStart(): string {
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - 1);
	return startDate.toISOString().slice(0, 16);
}

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

async function expectGermanMobileDoseActionButtonsToFit(page: Page) {
	const metrics = await page.evaluate(() => {
		type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

		function rectFromDomRect(rect: DOMRect): Rect {
			return {
				left: rect.left,
				right: rect.right,
				top: rect.top,
				bottom: rect.bottom,
				width: rect.width,
				height: rect.height,
			};
		}

		function unionRect(current: Rect | null, next: DOMRect): Rect {
			if (!current) return rectFromDomRect(next);
			const left = Math.min(current.left, next.left);
			const right = Math.max(current.right, next.right);
			const top = Math.min(current.top, next.top);
			const bottom = Math.max(current.bottom, next.bottom);
			return { left, right, top, bottom, width: right - left, height: bottom - top };
		}

		function isVisible(element: HTMLElement) {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
		}

		function textRect(element: HTMLElement): Rect | null {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let rect: Rect | null = null;
			while (walker.nextNode()) {
				const node = walker.currentNode;
				const text = node.textContent?.trim();
				if (!text) continue;

				const range = document.createRange();
				range.selectNodeContents(node);
				const nextRect = range.getBoundingClientRect();
				range.detach();
				if (nextRect.width <= 0 || nextRect.height <= 0) continue;
				rect = unionRect(rect, nextRect);
			}
			return rect;
		}

		const rows = Array.from(document.querySelectorAll<HTMLElement>(".dashboard-schedules-section .dose-person")).filter(
			isVisible
		);
		const violations: Array<Record<string, number | string | boolean>> = [];
		let checkedAuslassen = 0;
		let checkedUndo = 0;
		let checkedNotiz = 0;

		for (const row of rows) {
			const buttons = Array.from(row.querySelectorAll<HTMLElement>("button")).filter(isVisible);
			for (const button of buttons) {
				const text = button.textContent?.trim().replace(/\s+/g, " ") ?? "";
				if (!/^(Nehmen|Auslassen|Notiz|Rückg\.)/.test(text)) continue;

				const buttonRect = button.getBoundingClientRect();
				const label = button.querySelector<HTMLElement>(".mantine-Button-label") ?? button;
				const labelTextRect = textRect(label);
				if (!labelTextRect) continue;
				const buttonStyle = window.getComputedStyle(button);
				const labelStyle = window.getComputedStyle(label);

				const tolerance = 1.5;
				if (labelTextRect.left < buttonRect.left - tolerance || labelTextRect.right > buttonRect.right + tolerance) {
					violations.push({
						buttonWidth: Math.round(buttonRect.width * 10) / 10,
						labelLeft: Math.round(labelTextRect.left * 10) / 10,
						labelRight: Math.round(labelTextRect.right * 10) / 10,
						reason: "text outside button",
						text,
					});
				}

				if (text === "Auslassen") {
					checkedAuslassen += 1;
					const centerOffset = labelTextRect.left + labelTextRect.width / 2 - (buttonRect.left + buttonRect.width / 2);
					const centerDelta = Math.abs(centerOffset);
					if (centerDelta > 2) {
						violations.push({
							centerDelta: Math.round(centerDelta * 10) / 10,
							centerOffset: Math.round(centerOffset * 10) / 10,
							fontSize: buttonStyle.fontSize,
							labelDisplay: labelStyle.display,
							labelWidth: Math.round(label.getBoundingClientRect().width * 10) / 10,
							paddingLeft: buttonStyle.paddingLeft,
							paddingRight: buttonStyle.paddingRight,
							reason: "Auslassen not centered",
							text,
						});
					}
				}

				if (text.startsWith("Rückg.")) {
					checkedUndo += 1;
					const iconRect = button.querySelector<SVGElement>("svg")?.getBoundingClientRect();
					if (iconRect) {
						const gap = iconRect.left - labelTextRect.right;
						if (gap < 1) {
							violations.push({
								fontSize: buttonStyle.fontSize,
								gap: Math.round(gap * 10) / 10,
								iconLeft: Math.round(iconRect.left * 10) / 10,
								labelRight: Math.round(labelTextRect.right * 10) / 10,
								paddingLeft: buttonStyle.paddingLeft,
								paddingRight: buttonStyle.paddingRight,
								reason: "undo label overlaps icon",
								text,
							});
						}
					}
				}

				if (text === "Notiz") checkedNotiz += 1;
			}
		}

		return { checkedAuslassen, checkedNotiz, checkedUndo, violations };
	});

	expect(metrics.checkedAuslassen, "German skip action should be visible").toBeGreaterThan(0);
	expect(metrics.checkedUndo, "German undo action should be visible").toBeGreaterThan(0);
	expect(metrics.checkedNotiz, "German note action should be visible").toBeGreaterThan(0);
	expect(metrics.violations).toEqual([]);
}

async function expectMobileDoseSummariesKeepRecipientNamesReadable(
	page: Page,
	expectedRecipient: string,
	expectedCompactUsage: string,
	expectedWeight: string
) {
	const metrics = await page.evaluate(
		({ compactUsage, recipient, weight }) => {
			type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

			function rectFromDomRect(rect: DOMRect): Rect {
				return {
					left: rect.left,
					right: rect.right,
					top: rect.top,
					bottom: rect.bottom,
					width: rect.width,
					height: rect.height,
				};
			}

			function unionRect(current: Rect | null, next: DOMRect): Rect {
				if (!current) return rectFromDomRect(next);
				const left = Math.min(current.left, next.left);
				const right = Math.max(current.right, next.right);
				const top = Math.min(current.top, next.top);
				const bottom = Math.max(current.bottom, next.bottom);
				return { left, right, top, bottom, width: right - left, height: bottom - top };
			}

			function isVisible(element: HTMLElement) {
				const rect = element.getBoundingClientRect();
				const style = window.getComputedStyle(element);
				return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
			}

			function textRect(element: HTMLElement): Rect | null {
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				let rect: Rect | null = null;
				while (walker.nextNode()) {
					const node = walker.currentNode;
					const text = node.textContent?.trim();
					if (!text) continue;

					const range = document.createRange();
					range.selectNodeContents(node);
					const nextRect = range.getBoundingClientRect();
					range.detach();
					if (nextRect.width <= 0 || nextRect.height <= 0) continue;
					rect = unionRect(rect, nextRect);
				}
				return rect;
			}

			const rows = Array.from(
				document.querySelectorAll<HTMLElement>(".dashboard-schedules-section .dose-item.has-recipients")
			).filter(isVisible);
			const violations: Array<Record<string, number | string | boolean>> = [];
			let checked = 0;

			for (const row of rows) {
				const recipientName = row.querySelector<HTMLElement>(".dose-recipient-name");
				if (!recipientName?.textContent?.includes(recipient)) continue;

				const usage = row.querySelector<HTMLElement>(".dose-usage");
				const recipients = row.querySelector<HTMLElement>(".dose-recipients");
				const compactUsageElement = row.querySelector<HTMLElement>(".dose-usage-main-compact");
				const weightElement = row.querySelector<HTMLElement>(".dose-usage-weight");
				const reminderIcon = row.querySelector<HTMLElement>(".reminder-icon");
				if (!usage || !recipients || !isVisible(recipientName)) continue;

				checked += 1;
				const rowRect = row.getBoundingClientRect();
				const usageTextRect = textRect(usage) ?? usage.getBoundingClientRect();
				const recipientTextRect = textRect(recipientName) ?? recipientName.getBoundingClientRect();
				const recipientRect = recipientName.getBoundingClientRect();
				const recipientStyle = window.getComputedStyle(recipientName);
				const summaryStyle = window.getComputedStyle(row.querySelector<HTMLElement>(".dose-summary") ?? row);
				const compactUsageText = compactUsageElement?.textContent?.trim() ?? "";
				const weightText = weightElement?.textContent?.trim() ?? "";
				const gap = recipientTextRect.left - usageTextRect.right;
				const reminderIconRect = reminderIcon?.getBoundingClientRect();
				const recipientToReminderGap =
					reminderIcon && reminderIconRect && isVisible(reminderIcon)
						? reminderIconRect.left - recipientTextRect.right
						: Number.NaN;
				const recipientClipped =
					recipientName.scrollWidth > recipientName.clientWidth + 1 && recipientStyle.overflowX !== "visible";
				const textOutsideRecipient =
					recipientTextRect.left < recipientRect.left - 1 || recipientTextRect.right > recipientRect.right + 1;
				const textOutsideRow = recipientTextRect.right > rowRect.right + 1 || usageTextRect.left < rowRect.left - 1;
				const recipientNotAlignedToReminder =
					!Number.isFinite(recipientToReminderGap) || recipientToReminderGap < 4 || recipientToReminderGap > 24;

				if (
					gap < 6 ||
					recipientClipped ||
					textOutsideRecipient ||
					textOutsideRow ||
					recipientNotAlignedToReminder ||
					compactUsageText !== compactUsage ||
					weightText !== weight
				) {
					violations.push({
						compactUsageText,
						gap: Math.round(gap * 10) / 10,
						gridTemplateColumns: summaryStyle.gridTemplateColumns,
						reason: "dose usage and recipient name are cramped",
						recipientClientWidth: recipientName.clientWidth,
						recipientRectWidth: Math.round(recipientRect.width * 10) / 10,
						recipientScrollWidth: recipientName.scrollWidth,
						recipientText: recipientName.textContent?.trim() ?? "",
						recipientToReminderGap: Number.isFinite(recipientToReminderGap)
							? Math.round(recipientToReminderGap * 10) / 10
							: "missing",
						recipientTextLeft: Math.round(recipientTextRect.left * 10) / 10,
						recipientTextRight: Math.round(recipientTextRect.right * 10) / 10,
						textOutsideRecipient,
						textOutsideRow,
						usageText: usage.textContent?.trim().replace(/\s+/g, " ") ?? "",
						usageTextRight: Math.round(usageTextRect.right * 10) / 10,
						weightText,
					});
				}
			}

			return { checked, violations };
		},
		{ compactUsage: expectedCompactUsage, recipient: expectedRecipient, weight: expectedWeight }
	);

	expect(metrics.checked, `Expected mobile dose summaries for ${expectedRecipient}`).toBeGreaterThan(0);
	expect(metrics.violations).toEqual([]);
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
					start: dueIntakeStart(),
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
								start: dueIntakeStart(),
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
								start: dueIntakeStart(),
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
								start: dueIntakeStart(),
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

				test("/dashboard keeps German dose actions centered and non-overlapping", async ({ page }) => {
					const takeMedName = `${MED_NAME} German Take`;
					const skipMedName = `${MED_NAME} German Skip`;
					const personName = "pillepallemann";
					await updateSettingsViaAPI({ language: "de" });
					await page.addInitScript(() => {
						window.localStorage.setItem("medassist-ng-language", "de");
					});
					try {
						await deleteAllMedicationsViaAPI();
						await createMedicationViaAPI({
							name: takeMedName,
							takenBy: [personName],
							packageType: "blister",
							packCount: 2,
							blistersPerPack: 2,
							pillsPerBlister: 10,
							pillWeightMg: 150,
							doseUnit: "mg",
							intakes: [
								{
									usage: 1,
									every: 1,
									start: dueIntakeStart(),
									intakeRemindersEnabled: true,
									takenBy: personName,
								},
							],
						});
						await createMedicationViaAPI({
							name: skipMedName,
							takenBy: [personName],
							packageType: "blister",
							packCount: 2,
							blistersPerPack: 2,
							pillsPerBlister: 10,
							pillWeightMg: 150,
							doseUnit: "mg",
							intakes: [
								{
									usage: 1,
									every: 1,
									start: dueIntakeStart(),
									intakeRemindersEnabled: true,
									takenBy: personName,
								},
							],
						});
						await navigateTo(page, "/dashboard");
						await page.reload();
						await page.waitForLoadState("networkidle");
						const todayBlock = page.locator(".day-block.today");
						await expect(todayBlock).toContainText(takeMedName, { timeout: 10000 });
						await expect(todayBlock).toContainText(skipMedName, { timeout: 10000 });

						const takeRow = page.locator(".time-row", { hasText: takeMedName }).first();
						await expect(takeRow).toBeVisible({ timeout: 10000 });
						const takeButton = takeRow.getByRole("button", { name: /^Nehmen$/ }).first();
						await expect(takeButton).toBeVisible({ timeout: 10000 });
						const takeResponsePromise = page.waitForResponse(
							(response) => response.url().includes("/api/doses/taken") && response.request().method() === "POST",
							{ timeout: 10000 }
						);
						await takeButton.click();
						expect((await takeResponsePromise).ok()).toBe(true);

						const skipRow = page.locator(".time-row", { hasText: skipMedName }).first();
						await expect(skipRow).toBeVisible({ timeout: 10000 });
						const skipButton = skipRow.getByRole("button", { name: /^Auslassen$/ }).first();
						await expect(skipButton).toBeVisible({ timeout: 10000 });
						const [skipResponse] = await Promise.all([
							page.waitForResponse(
								(response) => response.url().includes("/api/doses/skip") && response.request().method() === "POST",
								{ timeout: 10000 }
							),
							skipButton.dispatchEvent("click"),
						]);
						expect(skipResponse.ok()).toBe(true);

						await expect(takeRow.getByRole("button", { name: /^Rückg\./ }).first()).toBeVisible({ timeout: 10000 });
						await expect(skipRow.getByRole("button", { name: /^Rückg\./ }).first()).toBeVisible({ timeout: 10000 });
						await expectGermanMobileDoseActionButtonsToFit(page);
						await expectMobileDoseSummariesKeepRecipientNamesReadable(page, personName, "1 Tbl.", "150 mg");
					} finally {
						await updateSettingsViaAPI({ language: "en" });
						await page
							.evaluate(() => {
								window.localStorage.setItem("medassist-ng-language", "en");
							})
							.catch(() => {});
					}
				});
			}
		});
	}
});
