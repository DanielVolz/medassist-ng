import type { Locator, Page } from "@playwright/test";
import { authFile, createMedicationViaAPI, deleteAllMedicationsViaAPI, expect, navigateTo, test } from "./fixtures";

const MED_NAME = "Modal Layout Guard Med";
const PERSON_NAME = "Guard Person";

async function openUserMenu(page: Page) {
	const userMenuButton = page.getByTestId("user-menu-trigger");
	await expect(userMenuButton).toBeVisible();
	await userMenuButton.click();
}

async function openProfileModal(page: Page) {
	await navigateTo(page, "/dashboard");
	await openUserMenu(page);
	await page.getByTestId("user-menu-profile").click();
	const modal = page.getByRole("dialog");
	await expect(modal).toBeVisible();
	return modal;
}

async function openShareScheduleModal(page: Page) {
	await navigateTo(page, "/dashboard");
	const shareButton = page.locator("button.share-btn");
	await expect(shareButton).toBeVisible({ timeout: 10000 });
	await shareButton.click();
	const modal = page.getByRole("dialog");
	await expect(modal).toBeVisible();
	return modal;
}

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

async function openUserFilterModal(page: Page) {
	await navigateTo(page, "/dashboard");
	const overviewTable = page.getByTestId("dashboard-overview-table");
	await expect(overviewTable).toBeVisible({ timeout: 10000 });
	const medRow = overviewTable.getByTestId("dashboard-overview-row").filter({ hasText: MED_NAME }).first();
	await expect(medRow).toBeVisible({ timeout: 10000 });

	const personName = medRow.getByRole("button", { exact: true, name: PERSON_NAME });
	await expect(personName).toBeVisible();
	await personName.click();

	const modal = page
		.getByRole("dialog")
		.filter({ has: page.getByTestId("user-filter-avatar") })
		.last();
	await expect(modal).toBeVisible({ timeout: 5000 });
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

async function expectMouseWheelScrollsModalContent(page: Page, modal: Locator) {
	const scrollArea = modal.getByTestId("app-modal-scroll-area").last();
	await expect(scrollArea).toBeVisible();
	await scrollArea.evaluate((element) => {
		element.scrollTop = 0;
	});

	const scrollBefore = await scrollArea.evaluate((element) => ({
		clientHeight: element.clientHeight,
		scrollHeight: element.scrollHeight,
		scrollTop: element.scrollTop,
	}));

	expect(scrollBefore.scrollHeight).toBeGreaterThan(scrollBefore.clientHeight + 20);

	const scrollAreaBox = await scrollArea.boundingBox();
	expect(scrollAreaBox).not.toBeNull();
	if (!scrollAreaBox) return;

	await page.mouse.move(scrollAreaBox.x + scrollAreaBox.width / 2, scrollAreaBox.y + scrollAreaBox.height / 2);
	await page.mouse.wheel(0, 600);
	await expect
		.poll(async () => scrollArea.evaluate((element) => element.scrollTop), {
			message: "modal content should scroll with mouse wheel",
		})
		.toBeGreaterThan(20);
}

async function expectModalFooterContract(modal: Locator, options: { mobile: boolean; strictBottomCoverage?: boolean }) {
	const footer = modal.getByTestId("app-modal-footer").last();
	await expect(footer).toBeVisible();
	const initialFooterRect = await footer.evaluate((footerElement) => {
		const rect = footerElement.getBoundingClientRect();
		return { bottom: rect.bottom, top: rect.top };
	});
	await scrollModalContentToBottom(modal);
	await expect(footer).toBeVisible();

	const metrics = await footer.evaluate((footerElement, initialRect) => {
		const modalElement =
			footerElement.closest<HTMLElement>(".mantine-Modal-content") ??
			footerElement.closest<HTMLElement>('[role="dialog"]');
		if (!modalElement) {
			throw new Error("App modal footer is not inside a modal content element");
		}

		const modalRect = modalElement.getBoundingClientRect();
		const footerRect = footerElement.getBoundingClientRect();
		const footerAfterHeight = Number.parseFloat(window.getComputedStyle(footerElement, "::after").height) || 0;
		const sampleY = Math.min(footerRect.bottom - 6, footerRect.top + 8);
		const modalBottomSampleY = modalRect.bottom - 2;
		const sampleXs = [modalRect.left + 6, modalRect.left + modalRect.width / 2, modalRect.right - 6];
		const footerHitMisses = sampleXs.filter((x) => {
			const hit = document.elementFromPoint(x, sampleY);
			return !hit || (hit !== footerElement && !footerElement.contains(hit));
		}).length;
		const modalBottomHitMisses = sampleXs.filter((x) => {
			const hit = document.elementFromPoint(x, modalBottomSampleY);
			return !hit || (hit !== footerElement && !footerElement.contains(hit));
		}).length;
		const visibleButtons = Array.from(footerElement.querySelectorAll<HTMLElement>("button")).filter((button) => {
			const rect = button.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		});
		const buttonRects = visibleButtons.map((button) => {
			const rect = button.getBoundingClientRect();
			return {
				left: rect.left,
				right: rect.right,
				top: rect.top,
				bottom: rect.bottom,
				width: rect.width,
				height: rect.height,
			};
		});
		const sortedHorizontalRects = [...buttonRects].sort((a, b) => a.left - b.left);
		const horizontalGaps = sortedHorizontalRects
			.slice(1)
			.map((rect, index) =>
				Math.abs(rect.top - sortedHorizontalRects[index].top) < 6 ? rect.left - sortedHorizontalRects[index].right : 0
			)
			.filter((gap) => gap > 0);
		const scrollContainers = Array.from(modalElement.querySelectorAll<HTMLElement>("*")).filter((candidate) => {
			const style = window.getComputedStyle(candidate);
			return /(auto|scroll)/.test(style.overflowY) && candidate.scrollHeight > candidate.clientHeight + 2;
		});

		return {
			boxShadow: window.getComputedStyle(footerElement).boxShadow,
			buttonHeightSpread:
				buttonRects.length > 1
					? Math.max(...buttonRects.map((rect) => rect.height)) - Math.min(...buttonRects.map((rect) => rect.height))
					: 0,
			buttonEdgeViolations: buttonRects.filter(
				(rect) => rect.left - modalRect.left < 10 || modalRect.right - rect.right < 10
			).length,
			footerBottomDistance: Math.abs(modalRect.bottom - footerRect.bottom),
			footerPaintedBottomDistance: Math.abs(modalRect.bottom - (footerRect.bottom + footerAfterHeight)),
			footerCoversInlineEnd: footerRect.right >= modalRect.right - 1,
			footerCoversInlineStart: footerRect.left <= modalRect.left + 1,
			footerMovementAfterScroll: Math.max(
				Math.abs(footerRect.bottom - initialRect.bottom),
				Math.abs(footerRect.top - initialRect.top)
			),
			footerHitMisses,
			footerIsSticky: window.getComputedStyle(footerElement).position === "sticky",
			modalBottomHitMisses,
			maxHorizontalGap: horizontalGaps.length > 0 ? Math.max(...horizontalGaps) : 0,
			scrollContainerCount: scrollContainers.length,
		};
	}, initialFooterRect);

	expect(metrics.footerIsSticky).toBe(true);
	expect(metrics.boxShadow === "none" || metrics.boxShadow === "").toBe(true);
	expect(metrics.footerMovementAfterScroll).toBeLessThanOrEqual(1);
	expect(Math.min(metrics.footerBottomDistance, metrics.footerPaintedBottomDistance)).toBeLessThanOrEqual(4);
	expect(metrics.footerCoversInlineStart).toBe(true);
	expect(metrics.footerCoversInlineEnd).toBe(true);
	expect(metrics.footerHitMisses).toBe(0);
	if (options.strictBottomCoverage) {
		expect(metrics.modalBottomHitMisses).toBe(0);
	}
	expect(metrics.buttonHeightSpread).toBeLessThanOrEqual(1);
	expect(metrics.buttonEdgeViolations).toBe(0);
	expect(metrics.scrollContainerCount).toBeLessThanOrEqual(1);
	if (!options.mobile) {
		expect(metrics.maxHorizontalGap).toBeLessThanOrEqual(40);
	}
}

async function expectMedicationDetailModalViewportGap(modal: Locator) {
	const metrics = await modal.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			bottomGap: window.innerHeight - rect.bottom,
			height: rect.height,
			topGap: rect.top,
			viewportHeight: window.innerHeight,
		};
	});

	expect(metrics.height).toBeGreaterThanOrEqual(metrics.viewportHeight * 0.92);
	expect(metrics.topGap).toBeGreaterThanOrEqual(16);
	expect(metrics.bottomGap).toBeGreaterThanOrEqual(16);
}

test.describe("Modal layout contract", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ mode: "serial", timeout: 90000 });

	test.beforeAll(async () => {
		await deleteAllMedicationsViaAPI();
		const startBase = new Date();
		startBase.setHours(8, 0, 0, 0);
		await createMedicationViaAPI({
			name: MED_NAME,
			genericName: "Modal layout guard generic",
			expiryDate: "2026-12-31",
			notes: "Layout guard note",
			takenBy: [PERSON_NAME],
			packageType: "blister",
			packCount: 6,
			blistersPerPack: 5,
			pillsPerBlister: 5,
			intakes: Array.from({ length: 8 }, (_, index) => ({
				usage: 1,
				every: 1,
				start: new Date(startBase.getTime() + index * 60 * 60 * 1000).toISOString().slice(0, 16),
				intakeRemindersEnabled: index % 2 === 0,
				takenBy: PERSON_NAME,
			})),
		});
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test("user filter modal hero uses the app surface instead of a bright gradient", async ({ page }) => {
		const modal = await openUserFilterModal(page);
		const hero = page.getByTestId("user-filter-avatar").locator("xpath=..");

		await expect(modal).toBeVisible();
		await expect(hero).toHaveCSS("background-image", "none");
		await expect(hero).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
	});

	for (const viewport of [
		{ name: "desktop", mobile: false, size: { width: 1280, height: 720 } },
		{ name: "mobile", mobile: true, size: { width: 390, height: 844 } },
	]) {
		test.describe(viewport.name, () => {
			test.use({ viewport: viewport.size });

			test("profile modal keeps the shared footer contract", async ({ page }) => {
				await expectModalFooterContract(await openProfileModal(page), { mobile: viewport.mobile });
			});

			test("share schedule modal keeps the shared footer contract", async ({ page }) => {
				await expectModalFooterContract(await openShareScheduleModal(page), { mobile: viewport.mobile });
			});

			test("medication detail modal keeps the shared footer contract", async ({ page }) => {
				const modal = await openMedicationDetailModal(page);
				if (!viewport.mobile) {
					await expectMedicationDetailModalViewportGap(modal);
				}
				await expectMouseWheelScrollsModalContent(page, modal);
				await expectModalFooterContract(modal, {
					mobile: viewport.mobile,
					strictBottomCoverage: true,
				});
			});

			test("medication detail taken-by names stay plain on hover", async ({ page }) => {
				const modal = await openMedicationDetailModal(page);
				const personName = modal.locator("button").filter({ hasText: PERSON_NAME }).first();

				await expect(personName).toBeVisible();
				await personName.hover();
				await expect(personName).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
				await expect(personName).toHaveCSS("border-top-left-radius", "0px");
				await expect(personName).toHaveCSS("box-shadow", "none");
				await expect(personName).toHaveCSS("text-decoration-line", "underline");
			});
		});
	}
});
