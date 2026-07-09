import { describe, expect, it } from "vitest";
import type { Settings } from "../../hooks/useSettings";
import {
	normalizeSettingsForComparison,
	settingsChanged,
	USER_EDITABLE_SETTINGS_FIELDS,
	type UserEditableSettingsField,
} from "../../utils/settings";

const baseSettings: Settings = {
	language: "en",
	timezone: "Europe/Berlin",
	availableTimezones: ["Europe/Berlin", "UTC"],
	serverTimezone: "UTC",
	emailEnabled: false,
	notificationEmail: "",
	reminderDaysBefore: 7,
	repeatDailyReminders: false,
	skipRemindersForTakenDoses: false,
	repeatRemindersEnabled: false,
	reminderRepeatIntervalMinutes: 30,
	maxNaggingReminders: 5,
	lowStockDays: 30,
	normalStockDays: 90,
	highStockDays: 180,
	smtpHost: "smtp.example.com",
	smtpPort: 587,
	smtpUser: "smtp-user",
	smtpPass: "",
	smtpFrom: "medassist@example.com",
	smtpSecure: false,
	hasSmtpPassword: false,
	lastAutoEmailSent: null,
	nextScheduledCheck: null,
	lastNotificationType: null,
	lastNotificationChannel: null,
	lastReminderMedName: null,
	lastReminderTakenBy: null,
	lastStockReminderSent: null,
	lastStockReminderChannel: null,
	lastStockReminderMedNames: null,
	lastPrescriptionReminderSent: null,
	lastPrescriptionReminderChannel: null,
	lastPrescriptionReminderMedNames: null,
	shoutrrrEnabled: false,
	shoutrrrUrl: "",
	emailStockReminders: true,
	emailIntakeReminders: true,
	emailPrescriptionReminders: true,
	shoutrrrStockReminders: true,
	shoutrrrIntakeReminders: true,
	shoutrrrPrescriptionReminders: true,
	stockCalculationMode: "automatic",
	shareMedicationOverview: false,
	upcomingTodayOnly: false,
	shareScheduleTodayOnly: false,
	swapDashboardMainSections: false,
	reminderHour: 6,
	reminderMinutesBefore: 15,
	expiryWarningDays: 30,
};

function changeEditableField(field: UserEditableSettingsField): Settings {
	const currentValue = baseSettings[field];
	if (typeof currentValue === "boolean") {
		return { ...baseSettings, [field]: !currentValue };
	}
	if (typeof currentValue === "number") {
		return { ...baseSettings, [field]: currentValue + 1 };
	}
	if (field === "stockCalculationMode") {
		return { ...baseSettings, stockCalculationMode: "manual" };
	}
	return { ...baseSettings, [field]: `${currentValue}-changed` };
}

describe("settings comparison utilities", () => {
	it("documents the one canonical list of user-editable settings fields", () => {
		expect([...USER_EDITABLE_SETTINGS_FIELDS]).toEqual([
			"timezone",
			"emailEnabled",
			"notificationEmail",
			"emailStockReminders",
			"emailIntakeReminders",
			"emailPrescriptionReminders",
			"reminderDaysBefore",
			"repeatDailyReminders",
			"skipRemindersForTakenDoses",
			"repeatRemindersEnabled",
			"reminderRepeatIntervalMinutes",
			"maxNaggingReminders",
			"lowStockDays",
			"normalStockDays",
			"highStockDays",
			"shoutrrrEnabled",
			"shoutrrrUrl",
			"shoutrrrStockReminders",
			"shoutrrrIntakeReminders",
			"shoutrrrPrescriptionReminders",
			"stockCalculationMode",
			"shareMedicationOverview",
			"upcomingTodayOnly",
			"shareScheduleTodayOnly",
			"swapDashboardMainSections",
		]);
	});

	it.each(USER_EDITABLE_SETTINGS_FIELDS)("marks %s as dirty when changed", (field) => {
		expect(settingsChanged(baseSettings, changeEditableField(field))).toBe(true);
	});

	it("normalizes only editable fields for comparison", () => {
		expect(Object.keys(normalizeSettingsForComparison(baseSettings))).toEqual([...USER_EDITABLE_SETTINGS_FIELDS]);
	});

	it("does not treat scheduler or server-managed fields as user-editable", () => {
		const current: Settings = {
			...baseSettings,
			availableTimezones: ["UTC"],
			serverTimezone: "Europe/London",
			smtpHost: "smtp.changed.example.com",
			smtpPort: 2525,
			hasSmtpPassword: true,
			lastAutoEmailSent: "2026-06-06T08:00:00.000Z",
			nextScheduledCheck: "2026-06-06T09:00:00.000Z",
			lastNotificationType: "stock",
			lastNotificationChannel: "email",
			lastReminderMedName: "Aspirin",
			lastReminderTakenBy: "Max",
			lastStockReminderSent: "2026-06-06T07:00:00.000Z",
			lastStockReminderChannel: "both",
			lastStockReminderMedNames: "Aspirin",
			lastPrescriptionReminderSent: "2026-06-06T06:00:00.000Z",
			lastPrescriptionReminderChannel: "push",
			lastPrescriptionReminderMedNames: "Rx Med",
			reminderHour: 8,
			reminderMinutesBefore: 30,
			expiryWarningDays: 90,
		};

		expect(settingsChanged(baseSettings, current)).toBe(false);
	});
});
