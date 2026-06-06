import type { Settings } from "../hooks/useSettings";

export const USER_EDITABLE_SETTINGS_FIELDS = [
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
] as const satisfies readonly (keyof Settings)[];

export type UserEditableSettingsField = (typeof USER_EDITABLE_SETTINGS_FIELDS)[number];

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
