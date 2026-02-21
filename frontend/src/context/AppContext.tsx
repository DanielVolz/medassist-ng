import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { useCollapsedDays, useDoses, useMedications, useRefill, useSettings, useShare } from "../hooks";
import type { Coverage, FormState, Medication, ScheduleEvent, StockThresholds } from "../types";
import { getSystemLocale } from "../utils/formatters";
import { log } from "../utils/logger";
import { buildSchedulePreview, calculateCoverage, computeMissedPastDoseIds } from "../utils/schedule";

// =============================================================================
// Types
// =============================================================================

export type DoseInfo = {
	id: string;
	timeStr: string;
	when: number;
	usage: number;
	takenBy: string[];
	intakeRemindersEnabled: boolean;
};

export type DayMedEntry = {
	medName: string;
	total: number;
	doses: DoseInfo[];
	lastWhen: number;
};

export type GroupedDay = {
	dateStr: string;
	date: Date;
	isPast: boolean;
	meds: DayMedEntry[];
};

export interface AppContextValue {
	// From useMedications
	meds: Medication[];
	setMeds: React.Dispatch<React.SetStateAction<Medication[]>>;
	loading: boolean;
	saving: boolean;
	setSaving: React.Dispatch<React.SetStateAction<boolean>>;
	uploadingImage: boolean;
	loadMeds: () => void;
	deleteMed: (id: number, editingId: number | null, resetForm: () => void) => Promise<void>;
	uploadMedImage: (medId: number, file: File) => Promise<void>;
	deleteMedImage: (medId: number) => Promise<void>;

	// From useSettings (selected fields)
	settings: ReturnType<typeof useSettings>["settings"];
	setSettings: ReturnType<typeof useSettings>["setSettings"];
	savedSettings: ReturnType<typeof useSettings>["savedSettings"];
	settingsLoading: boolean;
	settingsSaving: boolean;
	settingsSaved: boolean;
	testingEmail: boolean;
	testEmailResult: { success: boolean; message: string } | null;
	testingShoutrrr: boolean;
	testShoutrrrResult: { success: boolean; message: string } | null;
	loadSettings: () => void;
	saveSettings: (e?: React.FormEvent) => Promise<void>;
	testEmail: () => Promise<void>;
	testShoutrrr: () => Promise<void>;

	// From useDoses
	takenDoses: Set<string>;
	setTakenDoses: React.Dispatch<React.SetStateAction<Set<string>>>;
	dismissedDoses: Set<string>;
	clearingMissed: boolean;
	showClearMissedConfirm: boolean;
	setShowClearMissedConfirm: (show: boolean) => void;
	getDoseId: (baseDoseId: string, person: string | null) => string;
	isDoseTakenAutomatically: (doseId: string) => boolean;
	countTakenDoses: (doses: Array<{ id: string; takenBy: string[] }>) => { total: number; taken: number };
	markDoseTaken: (doseId: string) => Promise<void>;
	undoDoseTaken: (doseId: string) => Promise<void>;
	dismissMissedDoses: (doseIds: string[]) => Promise<void>;

	// From useCollapsedDays
	manuallyCollapsedDays: Set<string>;
	manuallyExpandedDays: Set<string>;
	toggleDayCollapse: (dateStr: string, isCurrentlyExpanded: boolean) => void;

	// From useShare
	showShareDialog: boolean;
	sharePeople: string[];
	shareSelectedPerson: string;
	setShareSelectedPerson: React.Dispatch<React.SetStateAction<string>>;
	shareSelectedDays: number;
	setShareSelectedDays: React.Dispatch<React.SetStateAction<number>>;
	shareGenerating: boolean;
	shareLink: string | null;
	setShareLink: React.Dispatch<React.SetStateAction<string | null>>;
	shareCopied: boolean;
	setShareCopied: React.Dispatch<React.SetStateAction<boolean>>;
	openShareDialog: () => void;
	generateShareLink: () => Promise<void>;
	copyShareLink: () => void;
	closeShareDialog: () => void;
	resetShareDialogState: () => void;

	// From useRefill
	showRefillModal: boolean;
	setShowRefillModal: React.Dispatch<React.SetStateAction<boolean>>;
	refillPacks: number;
	setRefillPacks: React.Dispatch<React.SetStateAction<number>>;
	refillLoose: number;
	setRefillLoose: React.Dispatch<React.SetStateAction<number>>;
	usePrescriptionRefill: boolean;
	setUsePrescriptionRefill: React.Dispatch<React.SetStateAction<boolean>>;
	refillSaving: boolean;
	refillHistory: ReturnType<typeof useRefill>["refillHistory"];
	refillHistoryExpanded: boolean;
	setRefillHistoryExpanded: React.Dispatch<React.SetStateAction<boolean>>;
	showEditStockModal: boolean;
	setShowEditStockModal: React.Dispatch<React.SetStateAction<boolean>>;
	editStockFullBlisters: number;
	setEditStockFullBlisters: React.Dispatch<React.SetStateAction<number>>;
	editStockPartialBlisterPills: number;
	setEditStockPartialBlisterPills: React.Dispatch<React.SetStateAction<number>>;
	editStockLoosePills: number;
	setEditStockLoosePills: React.Dispatch<React.SetStateAction<number>>;
	editStockSaving: boolean;
	editStockMedication: Medication | null;
	loadRefillHistory: (medId: number) => Promise<void>;
	submitRefill: (
		medId: number,
		editingId: number | null,
		setForm: React.Dispatch<React.SetStateAction<FormState>>,
		loadMeds: () => void,
		usePrescription?: boolean
	) => Promise<void>;
	submitStockCorrection: (medId: number, selectedMed: Medication, loadMeds: () => void) => Promise<void>;
	openRefillModal: () => void;
	closeRefillModal: () => void;
	openEditStockModal: (selectedMed: Medication, coverage: { all: Coverage[] }) => void;
	closeEditStockModal: () => void;

	// Computed values
	schedule: { events: ScheduleEvent[] };
	coverage: { all: Coverage[]; low: Coverage[] };
	coverageByMed: Record<string, Coverage>;
	depletionByMed: Record<string, number | null>;
	stockThresholds: StockThresholds;
	existingPeople: string[];
	groupedSchedule: GroupedDay[];
	pastDays: GroupedDay[];
	todayDay: GroupedDay | null;
	futureDays: GroupedDay[];
	missedPastDoseIds: string[];
	getDayStockStatus: (dayMeds: { medName: string; lastWhen: number }[]) => "success" | "warning" | "danger";

	// Schedule UI state
	scheduleDays: number;
	setScheduleDays: React.Dispatch<React.SetStateAction<number>>;
	showPastDays: boolean;
	setShowPastDays: React.Dispatch<React.SetStateAction<boolean>>;
	showFutureDays: boolean;
	setShowFutureDays: React.Dispatch<React.SetStateAction<boolean>>;

	// Modal state
	selectedMed: Medication | null;
	setSelectedMed: React.Dispatch<React.SetStateAction<Medication | null>>;
	showImageLightbox: boolean;
	setShowImageLightbox: React.Dispatch<React.SetStateAction<boolean>>;
	scheduleLightboxImage: string | null;
	setScheduleLightboxImage: React.Dispatch<React.SetStateAction<string | null>>;
	selectedUser: string | null;
	setSelectedUser: React.Dispatch<React.SetStateAction<string | null>>;

	// Export/Import state
	exporting: boolean;
	importing: boolean;
	showExportModal: boolean;
	setShowExportModal: React.Dispatch<React.SetStateAction<boolean>>;
	showImportConfirm: boolean;
	setShowImportConfirm: React.Dispatch<React.SetStateAction<boolean>>;
	pendingImportData: unknown;
	setPendingImportData: React.Dispatch<React.SetStateAction<unknown>>;
	importResult: {
		medications: number;
		doses: number;
		refills: number;
		shares: number;
	} | null;
	setImportResult: React.Dispatch<
		React.SetStateAction<{
			medications: number;
			doses: number;
			refills: number;
			shares: number;
		} | null>
	>;
	handleExport: (includeImages?: boolean) => Promise<void>;
	handleImportFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
	handleImportConfirm: () => Promise<void>;
	settingsChanged: boolean;

	// Modal helpers
	openMedDetail: (med: Medication) => void;
	closeMedDetail: () => void;
	openImageLightbox: () => void;
	closeImageLightbox: () => void;
	openScheduleLightbox: (imageUrl: string) => void;
	closeScheduleLightbox: () => void;
	openUserFilter: (person: string) => void;
	closeUserFilter: () => void;
}

// =============================================================================
// Context
// =============================================================================

const APP_CONTEXT_SINGLETON_KEY = "__MEDASSIST_APP_CONTEXT_SINGLETON__";

const AppContext = (() => {
	const globalRef = globalThis as typeof globalThis & {
		[APP_CONTEXT_SINGLETON_KEY]?: React.Context<AppContextValue | null>;
	};
	if (!globalRef[APP_CONTEXT_SINGLETON_KEY]) {
		globalRef[APP_CONTEXT_SINGLETON_KEY] = createContext<AppContextValue | null>(null);
	}
	return globalRef[APP_CONTEXT_SINGLETON_KEY];
})();

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

// =============================================================================
// Provider
// =============================================================================

export function AppProvider({ children }: { children: React.ReactNode }) {
	const { i18n } = useTranslation();
	const { user } = useAuth();

	// Compose hooks
	const medications = useMedications();
	const settingsHook = useSettings();
	const doses = useDoses();
	const collapsed = useCollapsedDays(user?.id);
	const share = useShare();
	const refill = useRefill();

	// Schedule UI state
	const [scheduleDays, setScheduleDays] = useState<number>(30);
	const [showPastDays, setShowPastDays] = useState(false);
	const [showFutureDays, setShowFutureDays] = useState(false);

	// Modal state
	const [selectedMed, setSelectedMed] = useState<Medication | null>(null);
	const [showImageLightbox, setShowImageLightbox] = useState(false);
	const [scheduleLightboxImage, setScheduleLightboxImage] = useState<string | null>(null);
	const [selectedUser, setSelectedUser] = useState<string | null>(null);

	// Export/Import state
	const [exporting, setExporting] = useState(false);
	const [importing, setImporting] = useState(false);
	const [showExportModal, setShowExportModal] = useState(false);
	const [showImportConfirm, setShowImportConfirm] = useState(false);
	const [pendingImportData, setPendingImportData] = useState<unknown>(null);
	const [importResult, setImportResult] = useState<{
		medications: number;
		doses: number;
		refills: number;
		shares: number;
	} | null>(null);

	// Load user-specific scheduleDays when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const storedDays = localStorage.getItem(userStorageKey(user.id, "scheduleDays"));
			setScheduleDays(storedDays ? Number(storedDays) : 30);
		}
	}, [user?.id]);

	// Load medications and settings when user changes
	useEffect(() => {
		medications.loadMeds();
		settingsHook.loadSettings();
	}, [medications.loadMeds, settingsHook.loadSettings]);

	// Update selectedMed when meds change (e.g., after refill)
	useEffect(() => {
		if (selectedMed) {
			const updated = medications.meds.find((m) => m.id === selectedMed.id);
			if (
				updated &&
				(updated.packCount !== selectedMed.packCount ||
					updated.looseTablets !== selectedMed.looseTablets ||
					updated.updatedAt !== selectedMed.updatedAt)
			) {
				setSelectedMed(updated);
			}
		}
	}, [medications.meds, selectedMed]);

	// Computed values - combine app language with timezone region for locale
	const systemLocale = getSystemLocale(i18n.language);
	const activeMeds = useMemo(() => medications.meds.filter((m) => !m.isObsolete), [medications.meds]);
	const schedule = useMemo(() => buildSchedulePreview(activeMeds, systemLocale, true), [activeMeds, systemLocale]);

	const coverage = useMemo(
		() =>
			calculateCoverage(
				activeMeds,
				schedule.events,
				systemLocale,
				settingsHook.settings.reminderDaysBefore,
				settingsHook.settings.stockCalculationMode,
				doses.takenDoses,
				doses.takenDoseTimestamps
			),
		[
			activeMeds,
			schedule.events,
			systemLocale,
			settingsHook.settings.reminderDaysBefore,
			settingsHook.settings.stockCalculationMode,
			doses.takenDoses,
			doses.takenDoseTimestamps,
		]
	);

	const depletionByMed = useMemo(
		() => Object.fromEntries(coverage.all.map((c) => [c.name, c.depletionTime])),
		[coverage.all]
	);

	const coverageByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c])), [coverage.all]);

	// Centralized stock thresholds for consistent status display across all components
	const stockThresholds: StockThresholds = useMemo(
		() => ({
			lowStockDays: settingsHook.settings.lowStockDays,
			normalStockDays: settingsHook.settings.normalStockDays,
			highStockDays: settingsHook.settings.highStockDays,
			criticalStockDays: settingsHook.settings.reminderDaysBefore, // Critical uses the reminder threshold
			expiryWarningDays: settingsHook.settings.expiryWarningDays,
		}),
		[
			settingsHook.settings.lowStockDays,
			settingsHook.settings.normalStockDays,
			settingsHook.settings.highStockDays,
			settingsHook.settings.reminderDaysBefore,
			settingsHook.settings.expiryWarningDays,
		]
	);

	const existingPeople = useMemo(() => {
		const allPeople = medications.meds.flatMap((m) => m.takenBy || []);
		return [...new Set(allPeople)].filter(Boolean).sort();
	}, [medications.meds]);

	// Get worst stock status for a day's medications
	const getDayStockStatus = useCallback(
		(dayMeds: { medName: string; lastWhen: number }[]): "success" | "warning" | "danger" => {
			const statuses = dayMeds.map((item) => {
				const cov = coverageByMed[item.medName];
				const depletionTime = depletionByMed[item.medName];

				// Will be out of stock by this day?
				if (typeof depletionTime === "number" && item.lastWhen > depletionTime) {
					return "danger";
				}

				if (!cov) return "success";
				const { daysLeft, medsLeft } = cov;

				// Currently out of stock
				if (medsLeft <= 0 || daysLeft === 0) return "danger";
				// No schedule (can't calculate)
				if (daysLeft === null) return "success";
				// Low stock: < lowStockDays (warning)
				if (daysLeft < settingsHook.settings.lowStockDays) return "warning";
				// Normal/High stock
				return "success";
			});
			const fallbackStatus = statuses.includes("warning") ? "warning" : "success";
			return statuses.includes("danger") ? "danger" : fallbackStatus;
		},
		[coverageByMed, depletionByMed, settingsHook.settings.lowStockDays]
	);

	const groupedSchedule = useMemo(() => {
		const days = new Map<string, { dateStr: string; date: Date; isPast: boolean; meds: Map<string, DayMedEntry> }>();
		// Limit past events to scheduleDays window to avoid overwhelming the UI.
		// Without this, medications with start dates far in the past generate thousands
		// of events that fill the display budget and push out today/future events.
		const pastCutoff = new Date();
		pastCutoff.setDate(pastCutoff.getDate() - scheduleDays);
		pastCutoff.setHours(0, 0, 0, 0);
		const pastCutoffMs = pastCutoff.getTime();
		schedule.events
			.filter((e) => !e.isPast || e.when >= pastCutoffMs)
			.forEach((event) => {
				const day = days.get(event.dateStr) ?? {
					dateStr: event.dateStr,
					date: new Date(event.when),
					isPast: event.isPast,
					meds: new Map(),
				};
				const medEntry = day.meds.get(event.medName) ?? {
					medName: event.medName,
					total: 0,
					doses: [],
					lastWhen: event.when,
				};
				medEntry.total += event.usage;
				medEntry.doses.push({
					id: event.id,
					timeStr: event.timeStr,
					when: event.when,
					usage: event.usage,
					takenBy: event.takenBy ? [event.takenBy] : [],
					intakeRemindersEnabled: event.intakeRemindersEnabled,
				});
				medEntry.lastWhen = Math.max(medEntry.lastWhen, event.when);
				day.meds.set(event.medName, medEntry);
				days.set(event.dateStr, day);
			});
		return Array.from(days.values()).map((d) => ({
			dateStr: d.dateStr,
			date: d.date,
			isPast: d.isPast,
			meds: Array.from(d.meds.values()),
		}));
	}, [schedule.events, scheduleDays]);

	const pastDays = useMemo(() => groupedSchedule.filter((d) => d.isPast), [groupedSchedule]);

	// Separate today from future days
	const todayDay = useMemo(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return (
			groupedSchedule.find((d) => {
				const dayDate = new Date(d.date);
				dayDate.setHours(0, 0, 0, 0);
				return dayDate.getTime() === today.getTime();
			}) || null
		);
	}, [groupedSchedule]);

	const futureDays = useMemo(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return groupedSchedule
			.filter((d) => {
				if (d.isPast) return false;
				const dayDate = new Date(d.date);
				dayDate.setHours(0, 0, 0, 0);
				return dayDate.getTime() > today.getTime();
			})
			.slice(0, scheduleDays);
	}, [groupedSchedule, scheduleDays]);

	const missedPastDoseIds = useMemo(
		() => computeMissedPastDoseIds(pastDays, activeMeds, doses.takenDoses, doses.dismissedDoses),
		[pastDays, activeMeds, doses.takenDoses, doses.dismissedDoses]
	);

	// Modal helpers with browser history support
	const openMedDetail = useCallback(
		(med: Medication) => {
			setSelectedMed(med);
			refill.setRefillHistoryExpanded(false);
			refill.loadRefillHistory(med.id);
			window.history.pushState({ modal: "medDetail", medId: med.id }, "");
		},
		[refill]
	);

	const closeMedDetail = useCallback(() => {
		if (selectedMed) {
			window.history.back();
		}
	}, [selectedMed]);

	const openImageLightbox = useCallback(() => {
		setShowImageLightbox(true);
		window.history.pushState({ modal: "imageLightbox" }, "");
	}, []);

	const closeImageLightbox = useCallback(() => {
		if (showImageLightbox) {
			window.history.back();
		}
	}, [showImageLightbox]);

	const openScheduleLightbox = useCallback((imageUrl: string) => {
		setScheduleLightboxImage(imageUrl);
		window.history.pushState({ modal: "scheduleLightbox" }, "");
	}, []);

	const closeScheduleLightbox = useCallback(() => {
		if (scheduleLightboxImage) {
			window.history.back();
		}
	}, [scheduleLightboxImage]);

	const openUserFilter = useCallback((person: string) => {
		setSelectedUser(person);
		window.history.pushState({ modal: "userFilter", person }, "");
	}, []);

	const closeUserFilter = useCallback(() => {
		if (selectedUser) {
			window.history.back();
		}
	}, [selectedUser]);

	// Wrapper to pass meds to openShareDialog
	const openShareDialog = useCallback(() => {
		share.openShareDialog(activeMeds);
	}, [share, activeMeds]);

	// Get t function for translations
	const { t } = useTranslation();

	// Export data to JSON file
	const handleExport = useCallback(
		async (includeImages: boolean = true) => {
			setExporting(true);
			try {
				const res = await fetch(`/api/export?includeSensitive=true&includeImages=${includeImages}`, {
					credentials: "include",
				});
				if (!res.ok) throw new Error("Export failed");
				const data = await res.json();

				// Create download
				const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				const now = new Date();
				const dateStr = now.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 13);
				const userPart = user?.username ? `-${user.username}` : "";
				a.href = url;
				a.download = `${t("exportImport.downloadFilename")}${userPart}-${dateStr}.json`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			} catch (err) {
				log.error("Export error:", err);
			}
			setExporting(false);
		},
		[t, user?.username]
	);

	// Handle file selection for import
	const handleImportFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = (event) => {
				try {
					const data = JSON.parse(event.target?.result as string);
					if (!data.version || !data.exportedAt) {
						alert(t("exportImport.invalidFile"));
						return;
					}
					setPendingImportData(data);
					setShowImportConfirm(true);
				} catch {
					alert(t("exportImport.invalidFile"));
				}
			};
			reader.readAsText(file);
			// Reset file input
			e.target.value = "";
		},
		[t]
	);

	// Confirm and execute import
	const handleImportConfirm = useCallback(async () => {
		if (!pendingImportData) return;
		setImporting(true);
		setShowImportConfirm(false);

		try {
			const res = await fetch("/api/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(pendingImportData),
			});

			// Get the response text first to handle non-JSON responses
			const text = await res.text();
			let data: { error?: string; message?: string; imported?: number } = {};
			try {
				data = text ? JSON.parse(text) : {};
			} catch {
				log.error("Import response parse error:", text);
				alert(`${t("exportImport.importError")}: Server returned invalid response`);
				return;
			}

			if (!res.ok) {
				alert(`${t("exportImport.importError")}: ${data.error || `HTTP ${res.status}`}`);
				return;
			}

			// Show success message in UI instead of browser alert
			setImportResult({
				medications: data.imported?.medications || 0,
				doses: data.imported?.doseHistory || 0,
				refills: data.imported?.refillHistory || 0,
				shares: data.imported?.shareLinks || 0,
			});

			// Reload all data
			medications.loadMeds();
			settingsHook.loadSettings();
			doses.loadTakenDoses();
		} catch (err) {
			log.error("Import error:", err);
			alert(t("exportImport.importError"));
		}

		setPendingImportData(null);
		setImporting(false);
	}, [pendingImportData, t, medications, settingsHook, doses]);

	// Compute settingsChanged
	const settingsChanged = useMemo(() => {
		const settings = settingsHook.settings;
		const savedSettings = settingsHook.savedSettings;
		return (
			settings.emailEnabled !== savedSettings.emailEnabled ||
			settings.notificationEmail !== savedSettings.notificationEmail ||
			settings.emailStockReminders !== savedSettings.emailStockReminders ||
			settings.emailIntakeReminders !== savedSettings.emailIntakeReminders ||
			settings.emailPrescriptionReminders !== savedSettings.emailPrescriptionReminders ||
			settings.reminderDaysBefore !== savedSettings.reminderDaysBefore ||
			settings.repeatDailyReminders !== savedSettings.repeatDailyReminders ||
			settings.lowStockDays !== savedSettings.lowStockDays ||
			settings.normalStockDays !== savedSettings.normalStockDays ||
			settings.highStockDays !== savedSettings.highStockDays ||
			settings.shoutrrrEnabled !== savedSettings.shoutrrrEnabled ||
			settings.shoutrrrUrl !== savedSettings.shoutrrrUrl ||
			settings.shoutrrrStockReminders !== savedSettings.shoutrrrStockReminders ||
			settings.shoutrrrIntakeReminders !== savedSettings.shoutrrrIntakeReminders ||
			settings.shoutrrrPrescriptionReminders !== savedSettings.shoutrrrPrescriptionReminders ||
			settings.skipRemindersForTakenDoses !== savedSettings.skipRemindersForTakenDoses ||
			settings.repeatRemindersEnabled !== savedSettings.repeatRemindersEnabled ||
			settings.reminderRepeatIntervalMinutes !== savedSettings.reminderRepeatIntervalMinutes ||
			settings.maxNaggingReminders !== savedSettings.maxNaggingReminders ||
			settings.stockCalculationMode !== savedSettings.stockCalculationMode ||
			settings.shareStockStatus !== savedSettings.shareStockStatus ||
			settings.upcomingTodayOnly !== savedSettings.upcomingTodayOnly ||
			settings.shareScheduleTodayOnly !== savedSettings.shareScheduleTodayOnly ||
			settings.expiryWarningDays !== savedSettings.expiryWarningDays
		);
	}, [settingsHook.settings, settingsHook.savedSettings]);

	// New dismissMissedDoses that uses medication-level dismissedUntil dates
	// This is robust against timestamp changes from schedule updates or timezone fixes
	const [clearingMissedState, setClearingMissedState] = useState(false);

	const dismissMissedDoses = useCallback(
		async (doseIds: string[]) => {
			if (doseIds.length === 0) return;

			// Extract unique medication IDs from dose IDs (format: medId-blisterIdx-timestamp[-person])
			const medIds = new Set<number>();
			for (const doseId of doseIds) {
				const parts = doseId.split("-");
				if (parts.length >= 1) {
					const medId = parseInt(parts[0], 10);
					if (!Number.isNaN(medId)) {
						medIds.add(medId);
					}
				}
			}

			if (medIds.size === 0) return;

			// Get today's date in YYYY-MM-DD format
			const today = new Date();
			const until = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

			setClearingMissedState(true);
			try {
				const res = await fetch("/api/medications/dismiss-until", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ medicationIds: Array.from(medIds), until }),
				});

				if (res.ok) {
					// Reload medications to get updated dismissedUntil values
					await medications.loadMeds();
					doses.setShowClearMissedConfirm(false);
				}
			} catch {
				// Error - dialog stays open
			} finally {
				setClearingMissedState(false);
			}
		},
		[medications, doses]
	);

	// Build context value
	const value: AppContextValue = useMemo(
		() => ({
			// From useMedications
			...medications,

			// From useSettings
			settings: settingsHook.settings,
			setSettings: settingsHook.setSettings,
			savedSettings: settingsHook.savedSettings,
			settingsLoading: settingsHook.settingsLoading,
			settingsSaving: settingsHook.settingsSaving,
			settingsSaved: settingsHook.settingsSaved,
			testingEmail: settingsHook.testingEmail,
			testEmailResult: settingsHook.testEmailResult,
			testingShoutrrr: settingsHook.testingShoutrrr,
			testShoutrrrResult: settingsHook.testShoutrrrResult,
			loadSettings: settingsHook.loadSettings,
			saveSettings: settingsHook.saveSettings,
			testEmail: settingsHook.testEmail,
			testShoutrrr: settingsHook.testShoutrrr,

			// From useDoses
			takenDoses: doses.takenDoses,
			setTakenDoses: doses.setTakenDoses,
			dismissedDoses: doses.dismissedDoses,
			clearingMissed: clearingMissedState,
			showClearMissedConfirm: doses.showClearMissedConfirm,
			setShowClearMissedConfirm: doses.setShowClearMissedConfirm,
			getDoseId: doses.getDoseId,
			isDoseTakenAutomatically: doses.isDoseTakenAutomatically,
			countTakenDoses: doses.countTakenDoses,
			markDoseTaken: doses.markDoseTaken,
			undoDoseTaken: doses.undoDoseTaken,
			dismissMissedDoses,

			// From useCollapsedDays
			manuallyCollapsedDays: collapsed.manuallyCollapsedDays,
			manuallyExpandedDays: collapsed.manuallyExpandedDays,
			toggleDayCollapse: collapsed.toggleDayCollapse,

			// From useShare
			showShareDialog: share.showShareDialog,
			sharePeople: share.sharePeople,
			shareSelectedPerson: share.shareSelectedPerson,
			setShareSelectedPerson: share.setShareSelectedPerson,
			shareSelectedDays: share.shareSelectedDays,
			setShareSelectedDays: share.setShareSelectedDays,
			shareGenerating: share.shareGenerating,
			shareLink: share.shareLink,
			setShareLink: share.setShareLink,
			shareCopied: share.shareCopied,
			setShareCopied: share.setShareCopied,
			openShareDialog,
			generateShareLink: share.generateShareLink,
			copyShareLink: share.copyShareLink,
			closeShareDialog: share.closeShareDialog,
			resetShareDialogState: share.resetShareDialogState,

			// From useRefill
			showRefillModal: refill.showRefillModal,
			setShowRefillModal: refill.setShowRefillModal,
			refillPacks: refill.refillPacks,
			setRefillPacks: refill.setRefillPacks,
			refillLoose: refill.refillLoose,
			setRefillLoose: refill.setRefillLoose,
			usePrescriptionRefill: refill.usePrescriptionRefill,
			setUsePrescriptionRefill: refill.setUsePrescriptionRefill,
			refillSaving: refill.refillSaving,
			refillHistory: refill.refillHistory,
			refillHistoryExpanded: refill.refillHistoryExpanded,
			setRefillHistoryExpanded: refill.setRefillHistoryExpanded,
			showEditStockModal: refill.showEditStockModal,
			setShowEditStockModal: refill.setShowEditStockModal,
			editStockFullBlisters: refill.editStockFullBlisters,
			setEditStockFullBlisters: refill.setEditStockFullBlisters,
			editStockPartialBlisterPills: refill.editStockPartialBlisterPills,
			setEditStockPartialBlisterPills: refill.setEditStockPartialBlisterPills,
			editStockLoosePills: refill.editStockLoosePills,
			setEditStockLoosePills: refill.setEditStockLoosePills,
			editStockSaving: refill.editStockSaving,
			editStockMedication: refill.editStockMedication,
			loadRefillHistory: refill.loadRefillHistory,
			submitRefill: refill.submitRefill,
			submitStockCorrection: refill.submitStockCorrection,
			openRefillModal: refill.openRefillModal,
			closeRefillModal: refill.closeRefillModal,
			openEditStockModal: refill.openEditStockModal,
			closeEditStockModal: refill.closeEditStockModal,

			// Computed values
			schedule,
			coverage,
			coverageByMed,
			depletionByMed,
			stockThresholds,
			existingPeople,
			groupedSchedule,
			pastDays,
			todayDay,
			futureDays,
			missedPastDoseIds,
			getDayStockStatus,

			// Schedule UI state
			scheduleDays,
			setScheduleDays,
			showPastDays,
			setShowPastDays,
			showFutureDays,
			setShowFutureDays,

			// Modal state
			selectedMed,
			setSelectedMed,
			showImageLightbox,
			setShowImageLightbox,
			scheduleLightboxImage,
			setScheduleLightboxImage,
			selectedUser,
			setSelectedUser,

			// Modal helpers
			openMedDetail,
			closeMedDetail,
			openImageLightbox,
			closeImageLightbox,
			openScheduleLightbox,
			closeScheduleLightbox,
			openUserFilter,
			closeUserFilter,

			// Export/Import
			exporting,
			importing,
			showExportModal,
			setShowExportModal,
			showImportConfirm,
			setShowImportConfirm,
			pendingImportData,
			setPendingImportData,
			importResult,
			setImportResult,
			handleExport,
			handleImportFileSelect,
			handleImportConfirm,
			settingsChanged,
		}),
		[
			medications,
			settingsHook,
			doses,
			collapsed,
			share,
			refill,
			schedule,
			coverage,
			coverageByMed,
			depletionByMed,
			stockThresholds,
			existingPeople,
			groupedSchedule,
			pastDays,
			todayDay,
			futureDays,
			missedPastDoseIds,
			getDayStockStatus,
			scheduleDays,
			showPastDays,
			showFutureDays,
			selectedMed,
			showImageLightbox,
			scheduleLightboxImage,
			selectedUser,
			openMedDetail,
			closeMedDetail,
			openImageLightbox,
			closeImageLightbox,
			openScheduleLightbox,
			closeScheduleLightbox,
			openUserFilter,
			closeUserFilter,
			openShareDialog,
			exporting,
			importing,
			showExportModal,
			showImportConfirm,
			pendingImportData,
			importResult,
			handleExport,
			handleImportFileSelect,
			handleImportConfirm,
			settingsChanged,
			clearingMissedState,
			dismissMissedDoses,
		]
	);

	return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// =============================================================================
// Hook
// =============================================================================

export function useAppContext(): AppContextValue {
	const context = useContext(AppContext);
	if (!context) {
		throw new Error("useAppContext must be used within an AppProvider");
	}
	return context;
}
