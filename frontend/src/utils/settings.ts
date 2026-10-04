import type { Settings } from "../hooks/useSettings";

// Exhaustive classification: a new Settings field must make an explicit dirty-state choice.
// Language saves immediately on its own endpoint; SMTP/scheduler values are server-managed.
const settingsFieldPolicy = {
	timezone: "editable",
	emailEnabled: "editable",
	notificationEmail: "editable",
	emailStockReminders: "editable",
	emailIntakeReminders: "editable",
	emailPrescriptionReminders: "editable",
	reminderDaysBefore: "editable",
	repeatDailyReminders: "editable",
	skipRemindersForTakenDoses: "editable",
	repeatRemindersEnabled: "editable",
	reminderRepeatIntervalMinutes: "editable",
	maxNaggingReminders: "editable",
	lowStockDays: "editable",
	normalStockDays: "editable",
	highStockDays: "editable",
	shoutrrrEnabled: "editable",
	shoutrrrUrl: "editable",
	shoutrrrStockReminders: "editable",
	shoutrrrIntakeReminders: "editable",
	shoutrrrPrescriptionReminders: "editable",
	stockCalculationMode: "editable",
	shareMedicationOverview: "editable",
	upcomingTodayOnly: "editable",
	shareScheduleTodayOnly: "editable",
	swapDashboardMainSections: "editable",
	language: "immediate",
	availableTimezones: "server",
	serverTimezone: "server",
	smtpHost: "server",
	smtpPort: "server",
	smtpUser: "server",
	smtpPass: "server",
	smtpFrom: "server",
	smtpSecure: "server",
	hasSmtpPassword: "server",
	lastAutoEmailSent: "server",
	nextScheduledCheck: "server",
	lastNotificationType: "server",
	lastNotificationChannel: "server",
	lastReminderMedName: "server",
	lastReminderTakenBy: "server",
	lastStockReminderSent: "server",
	lastStockReminderChannel: "server",
	lastStockReminderMedNames: "server",
	lastPrescriptionReminderSent: "server",
	lastPrescriptionReminderChannel: "server",
	lastPrescriptionReminderMedNames: "server",
	reminderHour: "server",
	reminderMinutesBefore: "server",
	expiryWarningDays: "server",
} as const satisfies Record<keyof Settings, "editable" | "immediate" | "server">;

export type UserEditableSettingsField = {
	[Field in keyof Settings]: (typeof settingsFieldPolicy)[Field] extends "editable" ? Field : never;
}[keyof Settings];

export const USER_EDITABLE_SETTINGS_FIELDS = Object.keys(settingsFieldPolicy).filter(
	(field) => settingsFieldPolicy[field as keyof Settings] === "editable"
) as readonly UserEditableSettingsField[];

export type ComparableSettings = Pick<Settings, UserEditableSettingsField>;

export function normalizeSettingsForComparison(settings: Settings): ComparableSettings {
	return Object.fromEntries(
		USER_EDITABLE_SETTINGS_FIELDS.map((field) => [field, settings[field]])
	) as ComparableSettings;
}

export function settingsChanged(original: Settings, current: Settings): boolean {
	const normalizedOriginal = normalizeSettingsForComparison(original);
	const normalizedCurrent = normalizeSettingsForComparison(current);

	return USER_EDITABLE_SETTINGS_FIELDS.some((field) => normalizedOriginal[field] !== normalizedCurrent[field]);
}

/** Preserve the PUT contract while keeping dirty comparison free of scheduler metadata. */
export function buildSettingsPayload(settings: Settings) {
	const effectiveEmailEnabled = settings.emailEnabled && !!settings.notificationEmail?.trim();
	const effectiveShoutrrrEnabled = settings.shoutrrrEnabled && !!settings.shoutrrrUrl?.trim();
	const hasEmailStock = effectiveEmailEnabled && settings.emailStockReminders && !!settings.notificationEmail?.trim();
	const hasShoutrrrStock =
		effectiveShoutrrrEnabled && settings.shoutrrrStockReminders && !!settings.shoutrrrUrl?.trim();
	const hasAnyStockReminder = hasEmailStock || hasShoutrrrStock;
	return {
		...normalizeSettingsForComparison(settings),
		emailEnabled: effectiveEmailEnabled,
		shoutrrrEnabled: effectiveShoutrrrEnabled,
		repeatDailyReminders: hasAnyStockReminder ? settings.repeatDailyReminders : false,
		maxNaggingReminders: settings.maxNaggingReminders ?? 5,
		language: settings.language,
		smtpHost: settings.smtpHost,
		smtpPort: settings.smtpPort,
		smtpUser: settings.smtpUser,
		smtpPass: settings.smtpPass || undefined,
		smtpFrom: settings.smtpFrom,
		smtpSecure: settings.smtpSecure,
	};
}
