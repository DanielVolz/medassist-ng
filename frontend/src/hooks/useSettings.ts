// =============================================================================
// useSettings Hook - Settings state and operations
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface Settings {
	emailEnabled: boolean;
	notificationEmail: string;
	reminderDaysBefore: number;
	repeatDailyReminders: boolean;
	skipRemindersForTakenDoses: boolean;
	repeatRemindersEnabled: boolean;
	reminderRepeatIntervalMinutes: number;
	maxNaggingReminders: number;
	lowStockDays: number;
	normalStockDays: number;
	highStockDays: number;
	smtpHost: string;
	smtpPort: number;
	smtpUser: string;
	smtpPass: string;
	smtpFrom: string;
	smtpSecure: boolean;
	hasSmtpPassword: boolean;
	lastAutoEmailSent: string | null;
	nextScheduledCheck: string | null;
	lastNotificationType: "stock" | "intake" | null;
	lastNotificationChannel: "email" | "push" | "both" | null;
	lastReminderMedName: string | null;
	lastReminderTakenBy: string | null;
	lastStockReminderSent: string | null;
	lastStockReminderChannel: "email" | "push" | "both" | null;
	lastStockReminderMedNames: string | null;
	shoutrrrEnabled: boolean;
	shoutrrrUrl: string;
	emailStockReminders: boolean;
	emailIntakeReminders: boolean;
	shoutrrrStockReminders: boolean;
	shoutrrrIntakeReminders: boolean;
	stockCalculationMode: "automatic" | "manual";
	shareStockStatus: boolean;
	expiryWarningDays: number;
}

const defaultSettings: Settings = {
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
	smtpHost: "",
	smtpPort: 587,
	smtpUser: "",
	smtpPass: "",
	smtpFrom: "",
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
	shoutrrrEnabled: false,
	shoutrrrUrl: "",
	emailStockReminders: true,
	emailIntakeReminders: true,
	shoutrrrStockReminders: true,
	shoutrrrIntakeReminders: true,
	stockCalculationMode: "automatic",
	shareStockStatus: true,
	expiryWarningDays: 30,
};

export interface UseSettingsReturn {
	settings: Settings;
	setSettings: React.Dispatch<React.SetStateAction<Settings>>;
	savedSettings: Settings;
	settingsLoading: boolean;
	settingsSaving: boolean;
	settingsSaved: boolean;
	testingEmail: boolean;
	testEmailResult: { success: boolean; message: string } | null;
	setTestEmailResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
	testingShoutrrr: boolean;
	testShoutrrrResult: { success: boolean; message: string } | null;
	setTestShoutrrrResult: React.Dispatch<React.SetStateAction<{ success: boolean; message: string } | null>>;
	loadSettings: () => void;
	saveSettings: (e: React.FormEvent) => Promise<void>;
	testEmail: () => Promise<void>;
	testShoutrrr: () => Promise<void>;
	hasUnsavedChanges: boolean;
}

export function useSettings(): UseSettingsReturn {
	const { i18n } = useTranslation();
	const [settings, setSettings] = useState<Settings>(defaultSettings);
	const [savedSettings, setSavedSettings] = useState<Settings>(defaultSettings);
	const [settingsLoading, setSettingsLoading] = useState(false);
	const [settingsSaving, setSettingsSaving] = useState(false);
	const [settingsSaved, setSettingsSaved] = useState(false);
	const [testingEmail, setTestingEmail] = useState(false);
	const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [testingShoutrrr, setTestingShoutrrr] = useState(false);
	const [testShoutrrrResult, setTestShoutrrrResult] = useState<{ success: boolean; message: string } | null>(null);

	// Load settings function - exposed for manual refresh (e.g., after auth)
	const loadSettings = useCallback(() => {
		setSettingsLoading(true);
		fetch("/api/settings", { credentials: "include" })
			.then((res) => (res.ok ? res.json() : Promise.reject()))
			.then((data) => {
				const newSettings = { ...defaultSettings, ...data, smtpPass: "" };
				setSettings(newSettings);
				setSavedSettings(newSettings);
				setSettingsSaved(false);
			})
			.catch(() => {})
			.finally(() => setSettingsLoading(false));
	}, []);

	// Load settings on mount
	useEffect(() => {
		loadSettings();
	}, [loadSettings]);

	// Auto-refresh reminder status (last sent timestamp) every 30 seconds
	useEffect(() => {
		const refreshReminderStatus = () => {
			fetch("/api/settings", { credentials: "include" })
				.then((res) => (res.ok ? res.json() : Promise.reject()))
				.then((data) => {
					// Only update the reminder-related fields without triggering unsaved changes
					setSettings((prev) => ({
						...prev,
						lastAutoEmailSent: data.lastAutoEmailSent ?? prev.lastAutoEmailSent,
						lastNotificationType: data.lastNotificationType ?? prev.lastNotificationType,
						lastNotificationChannel: data.lastNotificationChannel ?? prev.lastNotificationChannel,
						lastReminderMedName: data.lastReminderMedName ?? prev.lastReminderMedName,
						lastReminderTakenBy: data.lastReminderTakenBy ?? prev.lastReminderTakenBy,
						lastStockReminderSent: data.lastStockReminderSent ?? prev.lastStockReminderSent,
						lastStockReminderChannel: data.lastStockReminderChannel ?? prev.lastStockReminderChannel,
						lastStockReminderMedNames: data.lastStockReminderMedNames ?? prev.lastStockReminderMedNames,
					}));
					setSavedSettings((prev) => ({
						...prev,
						lastAutoEmailSent: data.lastAutoEmailSent ?? prev.lastAutoEmailSent,
						lastNotificationType: data.lastNotificationType ?? prev.lastNotificationType,
						lastNotificationChannel: data.lastNotificationChannel ?? prev.lastNotificationChannel,
						lastReminderMedName: data.lastReminderMedName ?? prev.lastReminderMedName,
						lastReminderTakenBy: data.lastReminderTakenBy ?? prev.lastReminderTakenBy,
						lastStockReminderSent: data.lastStockReminderSent ?? prev.lastStockReminderSent,
						lastStockReminderChannel: data.lastStockReminderChannel ?? prev.lastStockReminderChannel,
						lastStockReminderMedNames: data.lastStockReminderMedNames ?? prev.lastStockReminderMedNames,
					}));
				})
				.catch(() => {});
		};

		const interval = setInterval(refreshReminderStatus, 30000);
		return () => clearInterval(interval);
	}, []);

	const saveSettings = useCallback(
		async (e: React.FormEvent) => {
			e.preventDefault();

			// Auto-disable email if no recipient is set
			const effectiveEmailEnabled = settings.emailEnabled && !!settings.notificationEmail?.trim();
			// Auto-disable push if no URL is set
			const effectiveShoutrrrEnabled = settings.shoutrrrEnabled && !!settings.shoutrrrUrl?.trim();

			// Validate email if email notifications are enabled
			if (effectiveEmailEnabled && settings.notificationEmail) {
				const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
				if (!emailRegex.test(settings.notificationEmail)) {
					setTestEmailResult({ success: false, message: "Invalid email address" });
					return;
				}
			}

			setSettingsSaving(true);
			setTestEmailResult(null);

			const payload = {
				emailEnabled: effectiveEmailEnabled,
				notificationEmail: settings.notificationEmail,
				reminderDaysBefore: settings.reminderDaysBefore,
				repeatDailyReminders: settings.repeatDailyReminders,
				skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses,
				repeatRemindersEnabled: settings.repeatRemindersEnabled,
				reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes,
				maxNaggingReminders: settings.maxNaggingReminders ?? 5,
				lowStockDays: settings.lowStockDays,
				normalStockDays: settings.normalStockDays,
				highStockDays: settings.highStockDays,
				shoutrrrEnabled: effectiveShoutrrrEnabled,
				shoutrrrUrl: settings.shoutrrrUrl,
				emailStockReminders: settings.emailStockReminders,
				emailIntakeReminders: settings.emailIntakeReminders,
				shoutrrrStockReminders: settings.shoutrrrStockReminders,
				shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
				stockCalculationMode: settings.stockCalculationMode,
				shareStockStatus: settings.shareStockStatus,
				language: i18n.language,
				smtpHost: settings.smtpHost,
				smtpPort: settings.smtpPort,
				smtpUser: settings.smtpUser,
				smtpPass: settings.smtpPass || undefined,
				smtpFrom: settings.smtpFrom,
				smtpSecure: settings.smtpSecure,
			};

			await fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(payload),
			}).catch(() => null);

			const updatedSettings = {
				...settings,
				emailEnabled: effectiveEmailEnabled,
				shoutrrrEnabled: effectiveShoutrrrEnabled,
			};
			setSettings(updatedSettings);
			setSettingsSaving(false);
			setSavedSettings(updatedSettings);
			setSettingsSaved(true);
		},
		[settings, i18n.language]
	);

	const testEmail = useCallback(async () => {
		setTestingEmail(true);
		setTestEmailResult(null);
		try {
			const res = await fetch("/api/settings/test-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ email: settings.notificationEmail }),
			});
			const data = await res.json();
			setTestEmailResult({
				success: res.ok,
				message: data.message || (res.ok ? "Email sent!" : "Failed to send email"),
			});
		} catch {
			setTestEmailResult({ success: false, message: "Failed to send test email" });
		} finally {
			setTestingEmail(false);
		}
	}, [settings.notificationEmail]);

	const testShoutrrr = useCallback(async () => {
		setTestingShoutrrr(true);
		setTestShoutrrrResult(null);
		try {
			const res = await fetch("/api/settings/test-shoutrrr", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ url: settings.shoutrrrUrl }),
			});
			const data = await res.json();
			setTestShoutrrrResult({
				success: res.ok,
				message: data.message || (res.ok ? "Notification sent!" : "Failed to send notification"),
			});
		} catch {
			setTestShoutrrrResult({ success: false, message: "Failed to send test notification" });
		} finally {
			setTestingShoutrrr(false);
		}
	}, [settings.shoutrrrUrl]);

	// Check for unsaved changes
	const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);

	return {
		settings,
		setSettings,
		savedSettings,
		settingsLoading,
		settingsSaving,
		settingsSaved,
		testingEmail,
		testEmailResult,
		setTestEmailResult,
		testingShoutrrr,
		testShoutrrrResult,
		setTestShoutrrrResult,
		loadSettings,
		saveSettings,
		testEmail,
		testShoutrrr,
		hasUnsavedChanges,
	};
}
