import type { Page } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	createShareTokenViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	test,
	updateSettingsViaAPI,
} from "./fixtures";

function localDateTimeForToday(hour: number, minute: number): string {
	const date = new Date();
	date.setHours(hour, minute, 0, 0);
	const pad = (value: number) => value.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function calculatePlanner(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle");
	await page.locator('form.planner button[type="submit"]').click();
	await expect(page.locator(".table")).toBeVisible({ timeout: 15000 });
}

async function getPlannerUsage(page: Page, medicationName: string): Promise<string> {
	const row = page.locator(".table-row", { hasText: medicationName });
	await expect(row).toBeVisible({ timeout: 15000 });
	const usage = await row.locator("[data-label] strong").first().textContent();
	expect(usage).toBeTruthy();
	return usage ?? "";
}

async function exportData(page: Page): Promise<unknown> {
	return page.evaluate(async () => {
		const response = await fetch("/api/export?includeSensitive=false&includeImages=false", { credentials: "include" });
		if (!response.ok) {
			throw new Error(`Export failed: ${response.status}`);
		}
		return response.json();
	});
}

async function importData(page: Page, payload: unknown): Promise<void> {
	await page.evaluate(async (importPayload) => {
		const response = await fetch("/api/import", {
			method: "POST",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(importPayload),
		});
		if (!response.ok) {
			throw new Error(`Import failed: ${response.status} ${await response.text()}`);
		}
	}, payload);
}

async function getShareDoses(page: Page, token: string): Promise<Array<{ doseId: string }>> {
	return page.evaluate(async (shareToken) => {
		const response = await fetch(`/api/share/${shareToken}/doses`);
		if (!response.ok) {
			throw new Error(`Share dose read failed: ${response.status}`);
		}
		const body = (await response.json()) as { doses: Array<{ doseId: string }> };
		return body.doses;
	}, token);
}

test.describe("Domain safety flows", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ mode: "serial", timeout: 90000 });

	test.afterEach(async () => {
		await updateSettingsViaAPI({ timezone: "" });
		await deleteAllMedicationsViaAPI();
	});

	test("shared schedule recipient can mark and unmark a dose", async ({ page }) => {
		const suffix = Date.now().toString(36);
		const person = `Domain Share ${suffix}`;
		const medicationName = `Domain Share Med ${suffix}`;

		await createMedicationViaAPI({
			name: medicationName,
			takenBy: [person],
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: localDateTimeForToday(8, 0), takenBy: person }],
		});
		const share = await createShareTokenViaAPI(person, 30, { allowMarkTaken: true });

		await page.goto(`/share/${share.token}`);
		await page.waitForLoadState("networkidle");
		await expect(page.locator(".shared-schedule-loading-skeleton")).toBeHidden({ timeout: 10000 });
		await expect(page.locator(".med-name-text").filter({ hasText: medicationName }).first()).toBeVisible({
			timeout: 15000,
		});

		const todayBlock = page.locator(".day-block.today");
		const doseItem = page.locator(".dose-item").first();
		await expect(doseItem).toBeVisible({ timeout: 15000 });
		await expect(doseItem.locator(".dose-btn.take:not(.undo)")).toBeVisible();

		await doseItem.locator(".dose-btn.take:not(.undo)").click();
		await expect.poll(async () => (await getShareDoses(page, share.token)).length).toBe(1);
		const markedDoses = await getShareDoses(page, share.token);
		const markedDoseId = markedDoses[0].doseId;

		const undoButton = todayBlock.locator(".dose-btn.undo.take").first();
		if (!(await undoButton.isVisible().catch(() => false))) {
			await todayBlock.locator(".day-divider.clickable").click();
		}
		await expect(undoButton).toBeVisible({ timeout: 10000 });
		await undoButton.click();
		await expect(todayBlock.locator(".dose-btn.take:not(.undo)").first()).toBeVisible({ timeout: 10000 });
		await expect
			.poll(async () => (await getShareDoses(page, share.token)).some((dose) => dose.doseId === markedDoseId))
			.toBe(false);
	});

	test("settings timezone override is saved from the UI", async ({ page }) => {
		await updateSettingsViaAPI({ timezone: "" });
		await navigateTo(page, "/settings");

		const timezoneInput = page.locator('input[list="settings-timezone-suggestions"]');
		await expect(timezoneInput).toBeVisible();

		const settingsSaved = page.waitForResponse(
			(response) => response.url().includes("/api/settings") && response.request().method() === "PUT"
		);
		await timezoneInput.fill("America/New_York");
		await timezoneInput.press("Enter");
		await settingsSaved;

		await expect(timezoneInput).toHaveValue("America/New_York");
		const savedTimezone = await page.evaluate(async () => {
			const response = await fetch("/api/settings", { credentials: "include" });
			const body = (await response.json()) as { timezone: string };
			return body.timezone;
		});
		expect(savedTimezone).toBe("America/New_York");
	});

	test("export/import restore produces equivalent planner usage", async ({ page }) => {
		const suffix = Date.now().toString(36);
		const medicationName = `Domain Roundtrip Planner ${suffix}`;

		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: medicationName,
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 1,
			pillsPerBlister: 10,
			intakes: [{ usage: 1, every: 1, start: localDateTimeForToday(8, 0) }],
		});

		await navigateTo(page, "/planner");
		await calculatePlanner(page);
		const beforeUsage = await getPlannerUsage(page, medicationName);
		const exported = await exportData(page);

		await deleteAllMedicationsViaAPI();
		await importData(page, exported);

		await navigateTo(page, "/planner");
		await calculatePlanner(page);
		const afterUsage = await getPlannerUsage(page, medicationName);

		expect(afterUsage).toBe(beforeUsage);
	});
});
