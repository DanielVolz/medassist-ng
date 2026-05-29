import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	test,
	updateSettingsViaAPI,
} from "./fixtures";

type ExportPayload = {
	version: string;
	includeSensitiveData: boolean;
	medications: Array<{ name: string }>;
	settings?: {
		timezone?: string;
		notificationEmail?: string | null;
		shoutrrrEnabled?: boolean;
		shoutrrrUrl?: string | null;
		upcomingTodayOnly?: boolean;
		shareScheduleTodayOnly?: boolean;
		swapDashboardMainSections?: boolean;
	};
};

async function downloadExportFromSettings(page: Page, options: { includeSensitive: boolean }): Promise<ExportPayload> {
	await navigateTo(page, "/settings");

	await page
		.getByTestId("settings-danger-zone-card")
		.getByRole("button", { name: /Export Data|Daten exportieren/i })
		.click();
	const dialog = page.getByRole("dialog").or(page.locator(".modal-content"));
	await expect(dialog).toBeVisible();

	const sensitiveToggle = page.getByRole("checkbox", { name: /sensitive data|Sensible Daten/i });
	await expect(sensitiveToggle).not.toBeChecked();
	if (options.includeSensitive) {
		await page.locator(".modal-content .toggle-switch").click();
		await expect(sensitiveToggle).toBeChecked();
		await expect(page.getByText(/stored in plain text|Klartext gespeichert/i)).toBeVisible();
	}

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: /Data Only|Nur Daten/i }).click();
	const download = await downloadPromise;
	const path = await download.path();
	expect(path).toBeTruthy();

	const raw = await readFile(path ?? "", "utf-8");
	return JSON.parse(raw) as ExportPayload;
}

async function exportDataViaAPI(page: Page): Promise<ExportPayload> {
	return page.evaluate(async () => {
		const response = await fetch("/api/export?includeSensitive=false&includeImages=false", { credentials: "include" });
		if (!response.ok) {
			throw new Error(`Export failed: ${response.status} ${await response.text()}`);
		}
		return response.json();
	});
}

async function getMedicationNamesViaAPI(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const response = await fetch("/api/medications", { credentials: "include" });
		if (!response.ok) {
			throw new Error(`Medication read failed: ${response.status} ${await response.text()}`);
		}
		const medications = (await response.json()) as Array<{ name: string }>;
		return medications.map((medication) => medication.name);
	});
}

async function getSettingsViaAPI(page: Page): Promise<NonNullable<ExportPayload["settings"]>> {
	return page.evaluate(async () => {
		const response = await fetch("/api/settings", { credentials: "include" });
		if (!response.ok) {
			throw new Error(`Settings read failed: ${response.status} ${await response.text()}`);
		}
		return response.json();
	});
}

test.describe("Export/import E2E", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ mode: "serial", timeout: 90000 });

	test.afterEach(async () => {
		await updateSettingsViaAPI({
			timezone: "",
			notificationEmail: "",
			shoutrrrEnabled: false,
			shoutrrrUrl: "",
			upcomingTodayOnly: false,
			shareScheduleTodayOnly: false,
			swapDashboardMainSections: false,
		});
		await deleteAllMedicationsViaAPI();
	});

	test("downloads non-sensitive backups by default and includes destinations only after opt-in", async ({ page }) => {
		const suffix = Date.now().toString(36);
		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: `E2E Export Sensitive ${suffix}`,
			takenBy: ["Export E2E"],
		});
		await updateSettingsViaAPI({
			timezone: "Europe/Berlin",
			notificationEmail: "export-e2e@example.com",
			shoutrrrEnabled: true,
			shoutrrrUrl: "ntfy://user:secret@ntfy.sh/medassist-e2e",
			upcomingTodayOnly: true,
			shareScheduleTodayOnly: true,
			swapDashboardMainSections: true,
		});

		const nonSensitive = await downloadExportFromSettings(page, { includeSensitive: false });
		expect(nonSensitive.version).toBe("1.7");
		expect(nonSensitive.includeSensitiveData).toBe(false);
		expect(nonSensitive.settings?.timezone).toBe("Europe/Berlin");
		expect(nonSensitive.settings?.upcomingTodayOnly).toBe(true);
		expect(nonSensitive.settings?.shareScheduleTodayOnly).toBe(true);
		expect(nonSensitive.settings?.swapDashboardMainSections).toBe(true);
		expect(nonSensitive.settings?.notificationEmail).toBeUndefined();
		expect(nonSensitive.settings?.shoutrrrEnabled).toBeUndefined();
		expect(nonSensitive.settings?.shoutrrrUrl).toBeUndefined();

		const sensitive = await downloadExportFromSettings(page, { includeSensitive: true });
		expect(sensitive.includeSensitiveData).toBe(true);
		expect(sensitive.settings?.notificationEmail).toBe("export-e2e@example.com");
		expect(sensitive.settings?.shoutrrrEnabled).toBe(true);
		expect(sensitive.settings?.shoutrrrUrl).toBe("ntfy://user:secret@ntfy.sh/medassist-e2e");
	});

	test("restores an exported backup through the settings import UI", async ({ page }) => {
		const suffix = Date.now().toString(36);
		const medicationName = `E2E Import Roundtrip ${suffix}`;

		await deleteAllMedicationsViaAPI();
		await createMedicationViaAPI({
			name: medicationName,
			takenBy: ["Import E2E"],
			notes: "Created for export/import roundtrip E2E",
		});
		await updateSettingsViaAPI({
			timezone: "America/New_York",
			upcomingTodayOnly: true,
			shareScheduleTodayOnly: true,
			swapDashboardMainSections: true,
		});
		await navigateTo(page, "/settings");
		const exported = await exportDataViaAPI(page);

		await deleteAllMedicationsViaAPI();
		await updateSettingsViaAPI({
			timezone: "",
			upcomingTodayOnly: false,
			shareScheduleTodayOnly: false,
			swapDashboardMainSections: false,
		});
		await navigateTo(page, "/settings");

		await page.locator("#import-file-input").setInputFiles({
			name: "medassist-e2e-export.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(exported), "utf-8"),
		});

		const reviewModal = page.locator(".import-review-modal");
		await expect(reviewModal).toBeVisible();
		await expect(reviewModal.getByText(/Import file|Importdatei/i)).toBeVisible();
		await expect(reviewModal.getByText(/1 medications|1 Medikamente/i)).toBeVisible();

		await reviewModal.getByRole("button", { name: /Import|Replace All|Importieren|alles ersetzen/i }).click();
		await expect(reviewModal).toBeHidden({ timeout: 15000 });
		await expect(page.getByText(/Data imported successfully|Daten erfolgreich importiert/i)).toBeVisible({
			timeout: 15000,
		});

		await expect.poll(() => getMedicationNamesViaAPI(page)).toContain(medicationName);
		const restoredSettings = await getSettingsViaAPI(page);
		expect(restoredSettings.timezone).toBe("America/New_York");
		expect(restoredSettings.upcomingTodayOnly).toBe(true);
		expect(restoredSettings.shareScheduleTodayOnly).toBe(true);
		expect(restoredSettings.swapDashboardMainSections).toBe(true);
	});
});
