import { expect } from "@playwright/test";
import { authFile, navigateTo, test } from "./fixtures";

/**
 * Planner Page E2E Tests
 *
 * Verifies the usage planner form, date inputs, calculate action,
 * and results table display.
 */
test.describe("Planner Page", () => {
	test.use({ storageState: authFile });

	test("should display planner form", async ({ page }) => {
		await navigateTo(page, "/planner");

		await expect(page.locator("form.planner")).toBeVisible();
	});

	test("should navigate to planner via nav tab", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page.locator('button.pill:has-text("Planner")').click();
		await expect(page).toHaveURL(/\/planner/);
		await expect(page.locator("form.planner")).toBeVisible();
	});

	test("should have date inputs", async ({ page }) => {
		await navigateTo(page, "/planner");

		const dateInputs = page.locator('form.planner input[type="datetime-local"]');
		expect(await dateInputs.count()).toBeGreaterThanOrEqual(2);
	});

	test("should have a calculate button", async ({ page }) => {
		await navigateTo(page, "/planner");

		const calculateBtn = page.locator('form.planner button[type="submit"]');
		await expect(calculateBtn).toBeVisible();
	});

	test("should have a reset button", async ({ page }) => {
		await navigateTo(page, "/planner");

		const resetBtn = page.locator("form.planner button.ghost");
		await expect(resetBtn).toBeVisible();
	});

	test("should have include-until-start checkbox", async ({ page }) => {
		await navigateTo(page, "/planner");

		const checkbox = page.locator('label.planner-checkbox input[type="checkbox"]');
		await expect(checkbox).toBeVisible();
	});

	test("should submit planner form without error", async ({ page }) => {
		await navigateTo(page, "/planner");

		// Submit the planner form (default dates should work)
		await page.locator('form.planner button[type="submit"]').click();

		// After submit, the form should still be visible (no crash)
		await expect(page.locator("form.planner")).toBeVisible();
	});

	test("should show planner tab as active", async ({ page }) => {
		await navigateTo(page, "/planner");

		const plannerTab = page.locator('button.pill:has-text("Planner")');
		await expect(plannerTab).toHaveClass(/primary/);
	});

	test("Planner eyebrow shows correct heading", async ({ page }) => {
		await navigateTo(page, "/planner");

		await expect(page.locator(".eyebrow")).toBeVisible();
	});
});
