import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const documentedDefaultSettingEnvVars = new Set([
	"DEFAULT_EMAIL_ENABLED",
	"DEFAULT_NOTIFICATION_EMAIL",
	"DEFAULT_EMAIL_STOCK_REMINDERS",
	"DEFAULT_EMAIL_INTAKE_REMINDERS",
	"DEFAULT_EMAIL_PRESCRIPTION_REMINDERS",
	"DEFAULT_SHOUTRRR_ENABLED",
	"DEFAULT_SHOUTRRR_URL",
	"DEFAULT_SHOUTRRR_STOCK_REMINDERS",
	"DEFAULT_SHOUTRRR_INTAKE_REMINDERS",
	"DEFAULT_SHOUTRRR_PRESCRIPTION_REMINDERS",
	"DEFAULT_REPEAT_DAILY_REMINDERS",
	"DEFAULT_SKIP_REMINDERS_FOR_TAKEN_DOSES",
	"DEFAULT_REPEAT_REMINDERS_ENABLED",
	"DEFAULT_REMINDER_REPEAT_INTERVAL_MINUTES",
	"DEFAULT_MAX_NAGGING_REMINDERS",
	"DEFAULT_LOW_STOCK_DAYS",
	"DEFAULT_NORMAL_STOCK_DAYS",
	"DEFAULT_HIGH_STOCK_DAYS",
	"DEFAULT_LANGUAGE",
	"DEFAULT_STOCK_CALCULATION_MODE",
	"DEFAULT_SHARE_MEDICATION_OVERVIEW",
	"DEFAULT_UPCOMING_TODAY_ONLY",
	"DEFAULT_SHARE_SCHEDULE_TODAY_ONLY",
]);

const docsWithDefaultSettings = [
	".env.example",
	"docs/DEFAULT_USER_SETTINGS.md",
	"docs/PUSH_NOTIFICATIONS.md",
	"docs/CONFIGURATION.md",
	"README.md",
];
const nonEnvDefaultReferences = new Set(["DEFAULT_USER_SETTINGS"]);
const removedShareStockStatusEnvVar = ["DEFAULT", "SHARE", "STOCK", "STATUS"].join("_");

function readRepoFile(path: string): string {
	return readFileSync(resolve(process.cwd(), "..", path), "utf-8");
}

function extractDefaultEnvVars(content: string): Set<string> {
	return new Set(
		(content.match(/\bDEFAULT_[A-Z0-9_]+\b/g) ?? []).filter((envVar) => !nonEnvDefaultReferences.has(envVar))
	);
}

describe("environment documentation consistency", () => {
	it("does not mention the removed share stock-status default setting", () => {
		const content = docsWithDefaultSettings.map(readRepoFile).join("\n");

		expect(content).not.toContain(removedShareStockStatusEnvVar);
	});

	it("only documents DEFAULT_* variables that are current default-user settings", () => {
		const documentedVars = new Set<string>();
		for (const file of docsWithDefaultSettings) {
			for (const envVar of extractDefaultEnvVars(readRepoFile(file))) {
				documentedVars.add(envVar);
			}
		}

		const staleVars = [...documentedVars].filter((envVar) => !documentedDefaultSettingEnvVars.has(envVar)).sort();
		expect(staleVars).toEqual([]);
		expect(documentedVars).toContain("DEFAULT_SHARE_MEDICATION_OVERVIEW");
	});
});
