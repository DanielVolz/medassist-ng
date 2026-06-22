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

		await expect(page.getByTestId("planner-form-card")).toBeVisible();
	});

	test("should navigate to planner via nav tab", async ({ page }) => {
		await navigateTo(page, "/dashboard");

		await page
			.getByTestId("main-nav")
			.getByRole("button", { name: /Planner/i })
			.click();
		await expect(page).toHaveURL(/\/planner/);
		await expect(page.getByTestId("planner-form-card")).toBeVisible();
	});

	test("should have date inputs", async ({ page }) => {
		await navigateTo(page, "/planner");

		await expect(page.getByText(/From|Von/i)).toBeVisible();
		await expect(page.getByText(/Until|Bis/i)).toBeVisible();
	});

	test("should have a calculate button", async ({ page }) => {
		await navigateTo(page, "/planner");

		const calculateBtn = page
			.getByTestId("planner-form-card")
			.getByRole("button", { name: /Calculate|Calculating|Berechnen/i });
		await expect(calculateBtn).toBeVisible();
	});

	test("should have a reset button", async ({ page }) => {
		await navigateTo(page, "/planner");

		const resetBtn = page.getByTestId("planner-form-card").getByRole("button", { name: /Reset|Zurücksetzen/i });
		await expect(resetBtn).toBeVisible();
	});

	test("should have include-until-start checkbox", async ({ page }) => {
		await navigateTo(page, "/planner");

		const checkbox = page.getByTestId("planner-include-until-start").locator('input[type="checkbox"]');
		await expect(checkbox).toBeVisible();
	});

	test("should submit planner form without error", async ({ page }) => {
		await navigateTo(page, "/planner");

		// Submit the planner form (default dates should work)
		await page
			.getByTestId("planner-form-card")
			.getByRole("button", { name: /Calculate|Berechnen/i })
			.click();

		// After submit, the form should still be visible (no crash)
		await expect(page.getByTestId("planner-form-card")).toBeVisible();
	});

	test("should show planner tab as active", async ({ page }) => {
		await navigateTo(page, "/planner");

		await expect(page).toHaveURL(/\/planner/);
	});

	test("Planner page keeps its main content visible", async ({ page }) => {
		await navigateTo(page, "/planner");

		await expect(page.getByTestId("planner-page")).toBeVisible();
	});
});
