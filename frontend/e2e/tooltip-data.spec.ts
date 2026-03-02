import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	type TestMedication,
	test,
} from "./fixtures";

/**
 * Tooltip Visibility Regression Tests
 *
 * Ensures that tooltip pseudo-elements on MedDetail footer icon buttons
 * are not clipped by ancestor overflow or hidden behind modal overlays.
 * This is a regression guard — tooltips have repeatedly broken due to
 * CSS overflow/z-index changes on modal containers.
 */
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

	/**
	 * Open the MedDetail modal by clicking a medication row in the Dashboard overview table.
	 */
	async function openMedDetailModal(page: import("@playwright/test").Page) {
		await navigateTo(page, "/dashboard");
		const overviewTable = page.locator(".dashboard-overview-section .table").first();
		await expect(overviewTable).toBeVisible({ timeout: 10000 });

		const medRow = overviewTable.locator(".table-row").filter({ hasText: MED_NAME }).first();
		await medRow.click();

		const modal = page.locator(".modal-overlay.med-detail-overlay");
		await expect(modal).toBeVisible({ timeout: 5000 });
		return modal;
	}

	test("no ancestor of footer tooltip buttons has overflow:hidden", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		const footer = modal.locator(".med-detail-footer");
		await expect(footer).toBeVisible();

		// Walk up from footer through modal-content to modal-overlay and check overflow
		const overflowHiddenAncestors = await page.evaluate(() => {
			const footer = document.querySelector(".med-detail-footer");
			if (!footer) return ["footer not found"];

			const problems: string[] = [];
			let el: HTMLElement | null = footer as HTMLElement;
			while (el && !el.classList.contains("modal-overlay")) {
				const computed = window.getComputedStyle(el);
				const overflowX = computed.overflowX;
				const overflowY = computed.overflowY;
				if (overflowX === "hidden" || overflowY === "hidden") {
					const id = el.id ? `#${el.id}` : "";
					const cls = el.className ? `.${el.className.split(" ").join(".")}` : "";
					problems.push(`${el.tagName.toLowerCase()}${id}${cls} has overflow: ${overflowX}/${overflowY}`);
				}
				el = el.parentElement;
			}
			return problems;
		});

		expect(
			overflowHiddenAncestors,
			`Tooltip ancestors must not clip with overflow:hidden: ${overflowHiddenAncestors.join("; ")}`
		).toHaveLength(0);
	});

	test("tooltip z-index is above modal overlay", async ({ page }) => {
		const _modal = await openMedDetailModal(page);

		// Get modal overlay z-index and tooltip pseudo-element z-index from CSS
		const { modalZIndex, tooltipZIndex, arrowZIndex } = await page.evaluate(() => {
			const overlay = document.querySelector(".modal-overlay");
			const overlayZ = overlay ? Number.parseInt(window.getComputedStyle(overlay).zIndex, 10) : 0;

			// Read the tooltip ::after z-index from stylesheets
			let ttZ = 0;
			let arrZ = 0;
			for (const sheet of document.styleSheets) {
				try {
					for (const rule of sheet.cssRules) {
						const cssRule = rule as CSSStyleRule;
						if (cssRule.selectorText?.includes("tooltip-trigger[data-tooltip]::after")) {
							const z = Number.parseInt(cssRule.style.zIndex, 10);
							if (z > ttZ) ttZ = z;
						}
						if (cssRule.selectorText?.includes("tooltip-trigger[data-tooltip]::before")) {
							const z = Number.parseInt(cssRule.style.zIndex, 10);
							if (z > arrZ) arrZ = z;
						}
					}
				} catch {
					// cross-origin sheets — skip
				}
			}
			return { modalZIndex: overlayZ, tooltipZIndex: ttZ, arrowZIndex: arrZ };
		});

		expect(
			tooltipZIndex,
			`Tooltip ::after z-index (${tooltipZIndex}) must be > modal overlay z-index (${modalZIndex})`
		).toBeGreaterThan(modalZIndex);
		expect(
			arrowZIndex,
			`Tooltip ::before z-index (${arrowZIndex}) must be > modal overlay z-index (${modalZIndex})`
		).toBeGreaterThan(modalZIndex);
	});

	test("edit button tooltip is visible on hover", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		const editBtn = modal.locator(".med-detail-footer button.tooltip-trigger.info.icon-only");
		await expect(editBtn).toBeVisible();

		// Hover to activate tooltip
		await editBtn.hover();
		// Small wait for CSS transition
		await page.waitForTimeout(300);

		// Verify the tooltip pseudo-element is visible and within viewport
		const isVisible = await page.evaluate(() => {
			const btn = document.querySelector(".med-detail-footer button.tooltip-trigger.info.icon-only");
			if (!btn) return { visible: false, reason: "button not found" };

			const style = window.getComputedStyle(btn, "::after");
			const opacity = Number.parseFloat(style.opacity);
			const visibility = style.visibility;

			if (opacity < 0.5 || visibility === "hidden") {
				return {
					visible: false,
					reason: `opacity=${opacity}, visibility=${visibility}`,
				};
			}
			return { visible: true, reason: "ok" };
		});

		expect(isVisible.visible, `Edit tooltip should be visible on hover: ${isVisible.reason}`).toBe(true);
	});

	test("stock correction button tooltip is visible on hover", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		const stockBtn = modal.locator(".med-detail-footer button.tooltip-trigger.icon-stock-correction");
		await expect(stockBtn).toBeVisible();

		await stockBtn.hover();
		await page.waitForTimeout(300);

		const isVisible = await page.evaluate(() => {
			const btn = document.querySelector(".med-detail-footer button.tooltip-trigger.icon-stock-correction");
			if (!btn) return { visible: false, reason: "button not found" };

			const style = window.getComputedStyle(btn, "::after");
			const opacity = Number.parseFloat(style.opacity);
			const visibility = style.visibility;

			if (opacity < 0.5 || visibility === "hidden") {
				return {
					visible: false,
					reason: `opacity=${opacity}, visibility=${visibility}`,
				};
			}
			return { visible: true, reason: "ok" };
		});

		expect(isVisible.visible, `Stock correction tooltip should be visible on hover: ${isVisible.reason}`).toBe(true);
	});

	test("export button tooltip is visible on hover", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		const exportBtn = modal.locator(".med-detail-footer button.tooltip-trigger.secondary.icon-only");
		// Export button only shows when blisters exist — skip if not present
		if (!(await exportBtn.isVisible().catch(() => false))) {
			test.skip(true, "Export button not visible (no blisters)");
			return;
		}

		await exportBtn.hover();
		await page.waitForTimeout(300);

		const isVisible = await page.evaluate(() => {
			const btn = document.querySelector(".med-detail-footer button.tooltip-trigger.secondary.icon-only");
			if (!btn) return { visible: false, reason: "button not found" };

			const style = window.getComputedStyle(btn, "::after");
			const opacity = Number.parseFloat(style.opacity);
			const visibility = style.visibility;

			if (opacity < 0.5 || visibility === "hidden") {
				return {
					visible: false,
					reason: `opacity=${opacity}, visibility=${visibility}`,
				};
			}
			return { visible: true, reason: "ok" };
		});

		expect(isVisible.visible, `Export tooltip should be visible on hover: ${isVisible.reason}`).toBe(true);
	});

	test("close button tooltip in header is visible on hover", async ({ page }) => {
		const modal = await openMedDetailModal(page);

		const closeBtn = modal.locator("button.modal-close.tooltip-trigger");
		await expect(closeBtn).toBeVisible();

		await closeBtn.hover();
		await page.waitForTimeout(300);

		const isVisible = await page.evaluate(() => {
			const btn = document.querySelector(".med-detail-overlay button.modal-close.tooltip-trigger");
			if (!btn) return { visible: false, reason: "button not found" };

			const style = window.getComputedStyle(btn, "::after");
			const opacity = Number.parseFloat(style.opacity);
			const visibility = style.visibility;

			if (opacity < 0.5 || visibility === "hidden") {
				return {
					visible: false,
					reason: `opacity=${opacity}, visibility=${visibility}`,
				};
			}
			return { visible: true, reason: "ok" };
		});

		expect(isVisible.visible, `Close button tooltip should be visible on hover: ${isVisible.reason}`).toBe(true);
	});
});
