// =============================================================================
// useSettings Hook - Settings state and operations
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
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
	lastNotificationType: "stock" | "intake" | "prescription" | null;
	lastNotificationChannel: "email" | "push" | "both" | null;
	lastReminderMedName: string | null;
	lastReminderTakenBy: string | null;
	lastStockReminderSent: string | null;
	lastStockReminderChannel: "email" | "push" | "both" | null;
	lastStockReminderMedNames: string | null;
	lastPrescriptionReminderSent: string | null;
	lastPrescriptionReminderChannel: "email" | "push" | "both" | null;
	lastPrescriptionReminderMedNames: string | null;
	shoutrrrEnabled: boolean;
	shoutrrrUrl: string;
	emailStockReminders: boolean;
	emailIntakeReminders: boolean;
	emailPrescriptionReminders: boolean;
	shoutrrrStockReminders: boolean;
	shoutrrrIntakeReminders: boolean;
	shoutrrrPrescriptionReminders: boolean;
	stockCalculationMode: "automatic" | "manual";
	shareStockStatus: boolean;
	upcomingTodayOnly: boolean;
	shareScheduleTodayOnly: boolean;
	swapDashboardMainSections: boolean;
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
	shareStockStatus: true,
	upcomingTodayOnly: false,
	shareScheduleTodayOnly: false,
	swapDashboardMainSections: false,
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
	saveSettings: (e?: React.FormEvent) => Promise<void>;
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
						lastPrescriptionReminderSent: data.lastPrescriptionReminderSent ?? prev.lastPrescriptionReminderSent,
						lastPrescriptionReminderChannel:
							data.lastPrescriptionReminderChannel ?? prev.lastPrescriptionReminderChannel,
						lastPrescriptionReminderMedNames:
							data.lastPrescriptionReminderMedNames ?? prev.lastPrescriptionReminderMedNames,
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
						lastPrescriptionReminderSent: data.lastPrescriptionReminderSent ?? prev.lastPrescriptionReminderSent,
						lastPrescriptionReminderChannel:
							data.lastPrescriptionReminderChannel ?? prev.lastPrescriptionReminderChannel,
						lastPrescriptionReminderMedNames:
							data.lastPrescriptionReminderMedNames ?? prev.lastPrescriptionReminderMedNames,
					}));
				})
				.catch(() => {});
		};

		const interval = setInterval(refreshReminderStatus, 30000);
		return () => clearInterval(interval);
	}, []);

	// Internal save function (no event needed)
	const performSave = useCallback(
		async (settingsToSave: Settings) => {
			// Auto-disable email if no recipient is set
			const effectiveEmailEnabled = settingsToSave.emailEnabled && !!settingsToSave.notificationEmail?.trim();
			// Auto-disable push if no URL is set
			const effectiveShoutrrrEnabled = settingsToSave.shoutrrrEnabled && !!settingsToSave.shoutrrrUrl?.trim();

			setSettingsSaving(true);

			const payload = {
				emailEnabled: effectiveEmailEnabled,
				notificationEmail: settingsToSave.notificationEmail,
				reminderDaysBefore: settingsToSave.reminderDaysBefore,
				repeatDailyReminders: settingsToSave.repeatDailyReminders,
				skipRemindersForTakenDoses: settingsToSave.skipRemindersForTakenDoses,
				repeatRemindersEnabled: settingsToSave.repeatRemindersEnabled,
				reminderRepeatIntervalMinutes: settingsToSave.reminderRepeatIntervalMinutes,
				maxNaggingReminders: settingsToSave.maxNaggingReminders ?? 5,
				lowStockDays: settingsToSave.lowStockDays,
				normalStockDays: settingsToSave.normalStockDays,
				highStockDays: settingsToSave.highStockDays,
				shoutrrrEnabled: effectiveShoutrrrEnabled,
				shoutrrrUrl: settingsToSave.shoutrrrUrl,
				emailStockReminders: settingsToSave.emailStockReminders,
				emailIntakeReminders: settingsToSave.emailIntakeReminders,
				emailPrescriptionReminders: settingsToSave.emailPrescriptionReminders,
				shoutrrrStockReminders: settingsToSave.shoutrrrStockReminders,
				shoutrrrIntakeReminders: settingsToSave.shoutrrrIntakeReminders,
				shoutrrrPrescriptionReminders: settingsToSave.shoutrrrPrescriptionReminders,
				stockCalculationMode: settingsToSave.stockCalculationMode,
				shareStockStatus: settingsToSave.shareStockStatus,
				upcomingTodayOnly: settingsToSave.upcomingTodayOnly,
				shareScheduleTodayOnly: settingsToSave.shareScheduleTodayOnly,
				swapDashboardMainSections: settingsToSave.swapDashboardMainSections,
				language: i18n.language,
				smtpHost: settingsToSave.smtpHost,
				smtpPort: settingsToSave.smtpPort,
				smtpUser: settingsToSave.smtpUser,
				smtpPass: settingsToSave.smtpPass || undefined,
				smtpFrom: settingsToSave.smtpFrom,
				smtpSecure: settingsToSave.smtpSecure,
			};

			await fetch("/api/settings", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(payload),
			}).catch(() => null);

			const updatedSettings = { ...settingsToSave };
			setSettings(updatedSettings);
			setSettingsSaving(false);
			setSavedSettings(updatedSettings);
			setSettingsSaved(true);
		},
		[i18n.language]
	);

	// Debounced auto-save: fires whenever settings change
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const initialLoadDone = useRef(false);

	useEffect(() => {
		// Skip auto-save during initial load
		if (!initialLoadDone.current) {
			return;
		}

		// Don't save if nothing changed
		if (JSON.stringify(settings) === JSON.stringify(savedSettings)) {
			return;
		}

		// Don't save if thresholds are invalid
		if (settings.reminderDaysBefore >= settings.lowStockDays || settings.lowStockDays >= settings.highStockDays) {
			return;
		}

		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}

		debounceRef.current = setTimeout(() => {
			performSave(settings);
		}, 600);

		return () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
			}
		};
	}, [settings, savedSettings, performSave]);

	// Mark initial load as done after first settings load completes
	useEffect(() => {
		if (!settingsLoading && !initialLoadDone.current) {
			// Use a small delay to ensure savedSettings is set
			const t = setTimeout(() => {
				initialLoadDone.current = true;
			}, 100);
			return () => clearTimeout(t);
		}
	}, [settingsLoading]);

	// Legacy saveSettings wrapper (kept for compatibility)
	const saveSettings = useCallback(
		async (e?: React.FormEvent) => {
			if (e) e.preventDefault();
			await performSave(settings);
		},
		[settings, performSave]
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
