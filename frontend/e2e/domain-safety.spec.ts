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

type PlannerUsageRequest = {
	startDate: string;
	endDate: string;
	includeUntilStart?: boolean;
};

function formatDateTimeLocal(date: Date): string {
	const pad = (value: number) => value.toString().padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateTimeForOffset(daysFromToday: number, hour: number, minute: number): string {
	const date = new Date();
	date.setDate(date.getDate() + daysFromToday);
	date.setHours(hour, minute, 0, 0);
	return formatDateTimeLocal(date);
}

function localDateTimeForToday(hour: number, minute: number): string {
	return localDateTimeForOffset(0, hour, minute);
}

function addLocalDays(dateTimeValue: string, days: number): string {
	const date = new Date(dateTimeValue);
	date.setDate(date.getDate() + days);
	return formatDateTimeLocal(date);
}

function normalizeText(value: string | null | undefined): string {
	return value?.replace(/\s+/g, " ").trim() ?? "";
}

async function calculatePlanner(page: Page): Promise<void> {
	await page.waitForLoadState("networkidle");
	await page.locator('form.planner button[type="submit"]').click();
	await expect(page.locator(".table")).toBeVisible({ timeout: 15000 });
}

async function calculatePlannerWithRequest(page: Page): Promise<PlannerUsageRequest> {
	await page.waitForLoadState("networkidle");
	const responsePromise = page.waitForResponse(
		(response) => response.url().includes("/api/medications/usage") && response.request().method() === "POST"
	);
	await page.locator('form.planner button[type="submit"]').click();
	const response = await responsePromise;
	expect(response.ok()).toBe(true);
	await expect(page.locator(".table")).toBeVisible({ timeout: 15000 });

	return JSON.parse(response.request().postData() ?? "{}") as PlannerUsageRequest;
}

async function setPlannerRange(page: Page, start: string, end: string): Promise<void> {
	const dateInputs = page.locator('form.planner input[type="datetime-local"]');
	await expect(dateInputs.first()).toBeAttached();
	await dateInputs.first().fill(start);
	await dateInputs.last().fill(end);
	await expect(dateInputs.first()).toHaveValue(start);
	await expect(dateInputs.last()).toHaveValue(end);
}

async function expectedDateTimeDisplay(page: Page, value: string, locale: string): Promise<string> {
	return page.evaluate(
		({ dateTimeValue, displayLocale }) => {
			const match = dateTimeValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
			if (!match) return "";
			const [, year, month, day, hour, minute] = match;
			const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
			const dateText = date.toLocaleDateString(displayLocale, {
				year: "numeric",
				month: "2-digit",
				day: "2-digit",
			});
			const timeText = date.toLocaleTimeString(displayLocale, {
				hour: "2-digit",
				minute: "2-digit",
			});
			return `${dateText} ${timeText}`;
		},
		{ dateTimeValue: value, displayLocale: locale }
	);
}

async function expectPlannerStartDisplay(page: Page, start: string, locale: string): Promise<void> {
	const expectedDisplay = await expectedDateTimeDisplay(page, start, locale);
	await expect(page.locator("form.planner .date-input-display").first()).toHaveText(expectedDisplay);
}

async function getPlannerUsage(page: Page, medicationName: string): Promise<string> {
	const row = page.locator(".table-row", { hasText: medicationName });
	await expect(row).toBeVisible({ timeout: 15000 });
	const usage = await row.locator("[data-label] strong").first().textContent();
	expect(usage).toBeTruthy();
	return usage ?? "";
}

async function getPlannerRowSnapshot(page: Page, medicationName: string): Promise<string[]> {
	const row = page.locator(".table-row", { hasText: medicationName });
	await expect(row).toBeVisible({ timeout: 15000 });
	const cells = await row.locator("[data-label]").allTextContents();
	expect(cells.length).toBeGreaterThanOrEqual(6);
	return cells.map(normalizeText);
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

async function getSettingsTimezone(page: Page): Promise<string> {
	return page.evaluate(async () => {
		const response = await fetch("/api/settings", { credentials: "include" });
		if (!response.ok) {
			throw new Error(`Settings read failed: ${response.status}`);
		}
		const body = (await response.json()) as { timezone: string };
		return body.timezone;
	});
}

async function saveTimezoneFromUi(page: Page, timezone: string): Promise<void> {
	await navigateTo(page, "/settings");

	const timezoneInput = page.locator('input[list="settings-timezone-suggestions"]');
	await expect(timezoneInput).toBeVisible();

	const settingsSaved = page.waitForResponse(
		(response) => response.url().includes("/api/settings") && response.request().method() === "PUT"
	);
	await timezoneInput.fill(timezone);
	await timezoneInput.press("Enter");
	const response = await settingsSaved;
	expect(response.ok()).toBe(true);

	await expect(timezoneInput).toHaveValue(timezone);
	await expect.poll(() => getSettingsTimezone(page)).toBe(timezone);
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
		expect(await getShareDoses(page, share.token)).toEqual([]);
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
		await expect.poll(async () => (await getShareDoses(page, share.token)).length).toBe(0);
	});

	test("settings timezone override updates planner display and calculation request", async ({ page }) => {
		const suffix = Date.now().toString(36);
		const medicationName = `Domain Timezone Planner ${suffix}`;
		const plannerStart = localDateTimeForOffset(10, 8, 30);
		const plannerEnd = addLocalDays(plannerStart, 3);

		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: medicationName,
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			intakes: [{ usage: 2, every: 1, start: plannerStart }],
		});

		await saveTimezoneFromUi(page, "America/New_York");
		await navigateTo(page, "/planner");
		await setPlannerRange(page, plannerStart, plannerEnd);
		await expectPlannerStartDisplay(page, plannerStart, "en-US");

		const newYorkRequest = await calculatePlannerWithRequest(page);
		const expectedStartIso = await page.evaluate((value) => new Date(value).toISOString(), plannerStart);
		const expectedEndIso = await page.evaluate((value) => new Date(value).toISOString(), plannerEnd);
		expect(newYorkRequest).toMatchObject({
			startDate: expectedStartIso,
			endDate: expectedEndIso,
			includeUntilStart: false,
		});
		expect(await getPlannerUsage(page, medicationName)).toBe("6");

		await saveTimezoneFromUi(page, "Europe/Berlin");
		await navigateTo(page, "/planner");
		await setPlannerRange(page, plannerStart, plannerEnd);
		await expectPlannerStartDisplay(page, plannerStart, "de-DE");

		const berlinRequest = await calculatePlannerWithRequest(page);
		expect(berlinRequest).toMatchObject({
			startDate: expectedStartIso,
			endDate: expectedEndIso,
			includeUntilStart: false,
		});
		expect(await getPlannerUsage(page, medicationName)).toBe("6");
	});

	test("export/import restore produces equivalent planner usage", async ({ page }) => {
		const suffix = Date.now().toString(36);
		const medicationName = `Domain Roundtrip Planner ${suffix}`;
		const plannerStart = localDateTimeForOffset(14, 7, 45);
		const plannerEnd = addLocalDays(plannerStart, 5);

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
		await setPlannerRange(page, plannerStart, plannerEnd);
		await calculatePlanner(page);
		const beforeUsage = await getPlannerUsage(page, medicationName);
		const beforeRow = await getPlannerRowSnapshot(page, medicationName);
		const exported = await exportData(page);

		await deleteAllMedicationsViaAPI();
		await importData(page, exported);

		await navigateTo(page, "/planner");
		await setPlannerRange(page, plannerStart, plannerEnd);
		await calculatePlanner(page);
		const afterUsage = await getPlannerUsage(page, medicationName);
		const afterRow = await getPlannerRowSnapshot(page, medicationName);

		expect(afterUsage).toBe(beforeUsage);
		expect(afterRow).toEqual(beforeRow);
	});
});
