// =============================================================================
// useSettings Hook - Settings state and operations
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { log } from "../utils/logger";

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
	reminderHour: number;
	reminderMinutesBefore: number;
	expiryWarningDays: number;
}

export type SettingsLoadError = "auth" | "forbidden" | "request" | null;

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
	reminderHour: 6,
	reminderMinutesBefore: 15,
	expiryWarningDays: 30,
};

export interface UseSettingsReturn {
	settings: Settings;
	setSettings: React.Dispatch<React.SetStateAction<Settings>>;
	savedSettings: Settings;
	settingsLoading: boolean;
	settingsLoadError: SettingsLoadError;
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
	resetSettingsState: () => void;
}

export function useSettings(): UseSettingsReturn {
	const { i18n } = useTranslation();
	const [settings, setSettings] = useState<Settings>(defaultSettings);
	const [savedSettings, setSavedSettings] = useState<Settings>(defaultSettings);
	const [settingsLoading, setSettingsLoading] = useState(false);
	const [settingsLoadError, setSettingsLoadError] = useState<SettingsLoadError>(null);
	const [settingsSaving, setSettingsSaving] = useState(false);
	const [settingsSaved, setSettingsSaved] = useState(false);
	const [testingEmail, setTestingEmail] = useState(false);
	const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [testingShoutrrr, setTestingShoutrrr] = useState(false);
	const [testShoutrrrResult, setTestShoutrrrResult] = useState<{ success: boolean; message: string } | null>(null);

	// Generation counter: incremented on every resetSettingsState call.
	// loadSettings captures the current generation; if it changes before
	// the fetch completes, the stale response is silently discarded.
	const loadGenerationRef = useRef(0);

	const resetSettingsState = useCallback(() => {
		loadGenerationRef.current += 1; // Invalidate any in-flight loadSettings
		setSettings(defaultSettings);
		setSavedSettings(defaultSettings);
		setSettingsLoading(false);
		setSettingsLoadError(null);
		setSettingsSaving(false);
		setSettingsSaved(false);
		setTestingEmail(false);
		setTestEmailResult(null);
		setTestingShoutrrr(false);
		setTestShoutrrrResult(null);
	}, []);

	const clearReminderMetadata = useCallback(() => {
		setSettings((prev) => ({
			...prev,
			lastAutoEmailSent: null,
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
		}));
		setSavedSettings((prev) => ({
			...prev,
			lastAutoEmailSent: null,
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
		}));
	}, []);

	const fetchWithRefresh = useCallback(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		const requestInit: RequestInit = {
			credentials: "include",
			...init,
		};

		let response = await fetch(input, requestInit);
		if (response.status !== 401) {
			return response;
		}

		const refreshResponse = await fetch("/api/auth/refresh", {
			method: "POST",
			credentials: "include",
		});
		if (!refreshResponse.ok) {
			return response;
		}

		response = await fetch(input, requestInit);
		return response;
	}, []);

	// Load settings function - exposed for manual refresh (e.g., after auth)
	const loadSettings = useCallback(() => {
		setSettingsLoading(true);
		const generation = loadGenerationRef.current;
		fetchWithRefresh("/api/settings")
			.then((res) => {
				// Discard result if a newer loadSettings call (or resetSettingsState) has fired
				if (loadGenerationRef.current !== generation) return Promise.reject("stale");
				if (!res.ok) {
					log.warn("[useSettings] loadSettings failed", { status: res.status });
					if (res.status === 401 || res.status === 403) {
						resetSettingsState();
					}
					return Promise.reject({ status: res.status });
				}
				return res.json();
			})
			.then((data) => {
				if (!data || loadGenerationRef.current !== generation) return;
				log.debug("[useSettings] settings loaded", { smtpConfigured: !!data.smtpHost });
				const newSettings = { ...defaultSettings, ...data, smtpPass: "" };
				setSettings(newSettings);
				setSavedSettings(newSettings);
				setSettingsLoadError(null);
				setSettingsSaved(false);
			})
			.catch((error: unknown) => {
				if (error === "stale") return;
				const status =
					typeof error === "object" && error !== null && "status" in error ? (error.status as number) : undefined;
				if (status === 401) {
					setSettingsLoadError("auth");
					return;
				}
				if (status === 403) {
					setSettingsLoadError("forbidden");
					return;
				}
				setSettingsLoadError("request");
			})
			.finally(() => {
				if (loadGenerationRef.current === generation) setSettingsLoading(false);
			});
	}, [fetchWithRefresh, resetSettingsState]);

	// Load settings on mount
	useEffect(() => {
		loadSettings();
	}, [loadSettings]);

	// Auto-refresh reminder status (last sent timestamp) every 30 seconds
	useEffect(() => {
		const refreshReminderStatus = () => {
			fetchWithRefresh("/api/settings")
				.then((res) => {
					if (!res.ok) {
						if (res.status === 401 || res.status === 403) {
							clearReminderMetadata();
						}
						return Promise.reject();
					}
					return res.json();
				})
				.then((data) => {
					const pick = <T>(key: string, fallback: T): T => (Object.hasOwn(data, key) ? (data[key] as T) : fallback);

					// Only update the reminder-related fields without triggering unsaved changes
					setSettings((prev) => ({
						...prev,
						lastAutoEmailSent: pick("lastAutoEmailSent", prev.lastAutoEmailSent),
						lastNotificationType: pick("lastNotificationType", prev.lastNotificationType),
						lastNotificationChannel: pick("lastNotificationChannel", prev.lastNotificationChannel),
						lastReminderMedName: pick("lastReminderMedName", prev.lastReminderMedName),
						lastReminderTakenBy: pick("lastReminderTakenBy", prev.lastReminderTakenBy),
						lastStockReminderSent: pick("lastStockReminderSent", prev.lastStockReminderSent),
						lastStockReminderChannel: pick("lastStockReminderChannel", prev.lastStockReminderChannel),
						lastStockReminderMedNames: pick("lastStockReminderMedNames", prev.lastStockReminderMedNames),
						lastPrescriptionReminderSent: pick("lastPrescriptionReminderSent", prev.lastPrescriptionReminderSent),
						lastPrescriptionReminderChannel: pick(
							"lastPrescriptionReminderChannel",
							prev.lastPrescriptionReminderChannel
						),
						lastPrescriptionReminderMedNames: pick(
							"lastPrescriptionReminderMedNames",
							prev.lastPrescriptionReminderMedNames
						),
					}));
					setSavedSettings((prev) => ({
						...prev,
						lastAutoEmailSent: pick("lastAutoEmailSent", prev.lastAutoEmailSent),
						lastNotificationType: pick("lastNotificationType", prev.lastNotificationType),
						lastNotificationChannel: pick("lastNotificationChannel", prev.lastNotificationChannel),
						lastReminderMedName: pick("lastReminderMedName", prev.lastReminderMedName),
						lastReminderTakenBy: pick("lastReminderTakenBy", prev.lastReminderTakenBy),
						lastStockReminderSent: pick("lastStockReminderSent", prev.lastStockReminderSent),
						lastStockReminderChannel: pick("lastStockReminderChannel", prev.lastStockReminderChannel),
						lastStockReminderMedNames: pick("lastStockReminderMedNames", prev.lastStockReminderMedNames),
						lastPrescriptionReminderSent: pick("lastPrescriptionReminderSent", prev.lastPrescriptionReminderSent),
						lastPrescriptionReminderChannel: pick(
							"lastPrescriptionReminderChannel",
							prev.lastPrescriptionReminderChannel
						),
						lastPrescriptionReminderMedNames: pick(
							"lastPrescriptionReminderMedNames",
							prev.lastPrescriptionReminderMedNames
						),
					}));
				})
				.catch(() => {});
		};

		const interval = setInterval(refreshReminderStatus, 30000);
		return () => clearInterval(interval);
	}, [clearReminderMetadata, fetchWithRefresh]);

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

			try {
				const response = await fetchWithRefresh("/api/settings", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});

				if (!response.ok) {
					throw new Error(`SETTINGS_SAVE_FAILED_${response.status}`);
				}

				const updatedSettings = { ...settingsToSave };
				setSettings(updatedSettings);
				setSavedSettings(updatedSettings);
				setSettingsSaved(true);
			} catch {
				setSettingsSaved(false);
				// Keep UI aligned with backend truth if save failed (auth/session/network/server error).
				loadSettings();
			} finally {
				setSettingsSaving(false);
			}
		},
		[fetchWithRefresh, i18n.language, loadSettings]
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
			const res = await fetchWithRefresh("/api/settings/test-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
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
	}, [fetchWithRefresh, settings.notificationEmail]);

	const testShoutrrr = useCallback(async () => {
		setTestingShoutrrr(true);
		setTestShoutrrrResult(null);
		try {
			const res = await fetchWithRefresh("/api/settings/test-shoutrrr", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
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
	}, [fetchWithRefresh, settings.shoutrrrUrl]);

	// Check for unsaved changes
	const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings);

	return {
		settings,
		setSettings,
		savedSettings,
		settingsLoading,
		settingsLoadError,
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
		resetSettingsState,
	};
}
