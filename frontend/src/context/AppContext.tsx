import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import {
	useCollapsedDays,
	useDoses,
	useIntakeJournal,
	useMedications,
	useRefill,
	useSettings,
	useShare,
} from "../hooks";
import {
	type Coverage,
	type FormState,
	getMedDisplayName,
	type Medication,
	type ScheduleEvent,
	type StockThresholds,
} from "../types";
import { getSystemLocale, setDefaultFormattingTimezone } from "../utils/formatters";
import { log } from "../utils/logger";
import { mergePersonTags } from "../utils/person-tags";
import { buildSchedulePreview, calculateCoverage, computeMissedPastDoseIds, getStockStatus } from "../utils/schedule";
import { useFeedback } from "./FeedbackContext";
import { ShareContextProvider } from "./ShareContext";

// =============================================================================
// Types
// =============================================================================

export type DoseInfo = {
	id: string;
	timeStr: string;
	when: number;
	usage: number;
	intakeUnit?: "ml" | "tsp" | "tbsp" | null;
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

export type ImportPreview = {
	version: string;
	exportedAt: string;
	includeSensitiveData: boolean;
	incoming: {
		medications: number;
		doseHistory: number;
		refillHistory: number;
		shareLinks: number;
		journalEntries: number;
		imageCount: number;
		hasSettings: boolean;
	};
	current: {
		medications: number;
		doseHistory: number;
		refillHistory: number;
		shareLinks: number;
		hasSettings: boolean;
	};
	warnings: {
		replacesExistingData: boolean;
		regeneratesShareLinks: boolean;
		containsImages: boolean;
		containsSensitiveData: boolean;
	};
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
	settingsLoadError: ReturnType<typeof useSettings>["settingsLoadError"];
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
	skippedDoses: Set<string>;
	dismissedDoses: Set<string>;
	getDoseId: (baseDoseId: string, person: string | null) => string;
	isDoseTakenAutomatically: (doseId: string) => boolean;
	countTakenDoses: (doses: Array<{ id: string; takenBy: string[] }>) => { total: number; taken: number };
	markDoseTaken: (doseId: string) => Promise<void>;
	markDoseSkipped: (doseId: string) => Promise<void>;
	undoDoseTaken: (doseId: string) => Promise<void>;
	undoDoseSkipped: (doseId: string) => Promise<void>;

	// From useIntakeJournal
	journalEditorOpen: boolean;
	journalHistoryOpen: boolean;
	journalTargetDoseId: string | null;
	journalEvent: ReturnType<typeof useIntakeJournal>["journalEvent"];
	journalEventLoading: boolean;
	journalEventSaving: boolean;
	journalEventDeleting: boolean;
	journalEventError: string | null;
	journalHistoryEntries: ReturnType<typeof useIntakeJournal>["journalHistoryEntries"];
	journalHistoryFilters: ReturnType<typeof useIntakeJournal>["journalHistoryFilters"];
	journalHistoryLoading: boolean;
	journalHistoryError: string | null;
	openJournalEditor: (doseId: string) => Promise<void>;
	closeJournalEditor: () => void;
	saveJournalNote: (note: string) => Promise<boolean>;
	deleteJournalNote: () => Promise<boolean>;
	openJournalHistory: () => void;
	closeJournalHistory: () => void;
	setJournalHistoryFilters: (patch: Partial<ReturnType<typeof useIntakeJournal>["journalHistoryFilters"]>) => void;
	reloadJournalHistory: () => Promise<void>;
	reopenJournalHistoryEntry: (doseId: string) => Promise<void>;

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
	shareSelectedExpiryDays: number | null;
	setShareSelectedExpiryDays: React.Dispatch<React.SetStateAction<number | null>>;
	shareAllowJournalNotes: boolean;
	setShareAllowJournalNotes: React.Dispatch<React.SetStateAction<boolean>>;
	shareAllowMarkTaken: boolean;
	setShareAllowMarkTaken: React.Dispatch<React.SetStateAction<boolean>>;
	shareGenerating: boolean;
	shareLink: string | null;
	setShareLink: React.Dispatch<React.SetStateAction<string | null>>;
	shareCopied: boolean;
	setShareCopied: React.Dispatch<React.SetStateAction<boolean>>;
	activeShareLinks: ReturnType<typeof useShare>["activeShareLinks"];
	activeSharesLoading: boolean;
	revokingShareToken: string | null;
	regeneratingShareToken: string | null;
	openShareDialog: () => void;
	generateShareLink: () => Promise<void>;
	revokeShareLink: (token: string) => Promise<boolean>;
	regenerateShareLink: (token: string) => Promise<boolean>;
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
	importPreview: ImportPreview | null;
	setImportPreview: React.Dispatch<React.SetStateAction<ImportPreview | null>>;
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
	handleExport: (includeImages?: boolean, includeSensitive?: boolean) => Promise<void>;
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
	const { user, authFetch } = useAuth();
	const { showFeedback } = useFeedback();

	// Compose hooks
	const medications = useMedications();
	const settingsHook = useSettings();
	const doses = useDoses();
	const intakeJournal = useIntakeJournal();
	const collapsed = useCollapsedDays(user?.id);
	const share = useShare();
	const refill = useRefill();

	// Schedule UI state
	const [scheduleDays, setScheduleDays] = useState<number>(30);
	const [showPastDays, setShowPastDays] = useState(false);
	const [showFutureDays, setShowFutureDays] = useState(false);

	// Modal state
	const [selectedMed, setSelectedMed] = useState<Medication | null>(null);
	const selectedMedIdRef = useRef<number | null>(null);
	const medDetailOpenedAtRef = useRef(0);
	const medDetailCloseInFlightRef = useRef(false);
	useEffect(() => {
		selectedMedIdRef.current = selectedMed?.id ?? null;
		if (!selectedMed) {
			medDetailCloseInFlightRef.current = false;
		}
	}, [selectedMed]);
	const [showImageLightbox, setShowImageLightbox] = useState(false);
	const imageLightboxOpenedAtRef = useRef(0);
	const imageLightboxCloseInFlightRef = useRef(false);
	const [scheduleLightboxImage, setScheduleLightboxImage] = useState<string | null>(null);
	const scheduleLightboxOpenedAtRef = useRef(0);
	const scheduleLightboxCloseInFlightRef = useRef(false);
	const [selectedUser, setSelectedUser] = useState<string | null>(null);
	useEffect(() => {
		if (!showImageLightbox) {
			imageLightboxCloseInFlightRef.current = false;
		}
	}, [showImageLightbox]);
	useEffect(() => {
		if (!scheduleLightboxImage) {
			scheduleLightboxCloseInFlightRef.current = false;
		}
	}, [scheduleLightboxImage]);

	// Export/Import state
	const [exporting, setExporting] = useState(false);
	const [importing, setImporting] = useState(false);
	const [showExportModal, setShowExportModal] = useState(false);
	const [showImportConfirm, setShowImportConfirm] = useState(false);
	const [pendingImportData, setPendingImportData] = useState<unknown>(null);
	const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
	const [importResult, setImportResult] = useState<{
		medications: number;
		doses: number;
		refills: number;
		shares: number;
	} | null>(null);

	useEffect(() => {
		setDefaultFormattingTimezone(settingsHook.settings.timezone || settingsHook.settings.serverTimezone || null);
	}, [settingsHook.settings.timezone, settingsHook.settings.serverTimezone]);

	// Load user-specific scheduleDays when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const storedDays = localStorage.getItem(userStorageKey(user.id, "scheduleDays"));
			setScheduleDays(storedDays ? Number(storedDays) : 30);
		} else {
			setScheduleDays(30);
		}
	}, [user?.id]);

	// Security boundary: clear user-scoped UI state immediately on user/session switches,
	// then load fresh data for the active identity.
	useEffect(() => {
		if (!user?.id) {
			setScheduleDays(30);
		}

		medications.clearMedicationsState();
		settingsHook.resetSettingsState();
		doses.clearDosesState();
		intakeJournal.resetJournalState();
		refill.clearRefillState();
		share.resetShareDialogState();

		setSelectedMed(null);
		setShowImageLightbox(false);
		setScheduleLightboxImage(null);
		setSelectedUser(null);
		setShowPastDays(false);
		setShowFutureDays(false);
		setShowExportModal(false);
		setShowImportConfirm(false);
		setPendingImportData(null);
		setImportResult(null);

		medications.loadMeds();
		settingsHook.loadSettings();
		doses.loadTakenDoses();
	}, [
		user?.id,
		medications.clearMedicationsState,
		medications.loadMeds,
		settingsHook.resetSettingsState,
		settingsHook.loadSettings,
		doses.clearDosesState,
		doses.loadTakenDoses,
		intakeJournal.resetJournalState,
		refill.clearRefillState,
		share.resetShareDialogState,
	]);

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

	const outOfStockMedicationIds = useMemo(
		() =>
			new Set(
				activeMeds.filter((med) => (coverageByMed[getMedDisplayName(med)]?.medsLeft ?? 1) <= 0).map((med) => med.id)
			),
		[activeMeds, coverageByMed]
	);

	const effectiveTakenDoses = useMemo(
		() =>
			new Set(
				Array.from(doses.takenDoses).filter((doseId) => {
					const medId = Number.parseInt(doseId.split("-")[0] ?? "", 10);
					return Number.isNaN(medId) || !outOfStockMedicationIds.has(medId);
				})
			),
		[doses.takenDoses, outOfStockMedicationIds]
	);

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
		return mergePersonTags(medications.meds.flatMap((medication) => medication.takenBy || []));
	}, [medications.meds]);

	// Get worst stock status for a day's medications
	const getDayStockStatus = useCallback(
		(dayMeds: { medName: string; lastWhen: number }[]): "success" | "warning" | "danger" => {
			const statuses = dayMeds.map((item) => {
				const cov = coverageByMed[item.medName];
				const med = activeMeds.find((m) => m.name === item.medName || m.genericName === item.medName);
				const depletionTime = depletionByMed[item.medName];

				// Will be out of stock by this day?
				if (typeof depletionTime === "number" && item.lastWhen > depletionTime) {
					return "danger";
				}

				if (!cov) return "success";
				const status = getStockStatus(cov.daysLeft, cov.medsLeft, stockThresholds, med?.packageType);
				if (status.className === "danger") return "danger";
				if (status.className === "warning") return "warning";
				return "success";
			});
			const fallbackStatus = statuses.includes("warning") ? "warning" : "success";
			return statuses.includes("danger") ? "danger" : fallbackStatus;
		},
		[coverageByMed, depletionByMed, activeMeds, stockThresholds]
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
					intakeUnit: event.intakeUnit ?? null,
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
		() => computeMissedPastDoseIds(pastDays, activeMeds, effectiveTakenDoses, doses.dismissedDoses),
		[pastDays, activeMeds, effectiveTakenDoses, doses.dismissedDoses]
	);

	// Modal helpers with browser history support
	const openMedDetail = useCallback(
		(med: Medication) => {
			if (selectedMedIdRef.current === med.id) return;
			selectedMedIdRef.current = med.id;
			medDetailOpenedAtRef.current = Date.now();
			medDetailCloseInFlightRef.current = false;
			setSelectedMed(med);
			refill.setRefillHistoryExpanded(false);
			refill.loadRefillHistory(med.id);
			window.history.pushState({ modal: "medDetail", medId: med.id }, "");
		},
		[refill]
	);

	const closeMedDetail = useCallback(() => {
		if (!selectedMed || medDetailCloseInFlightRef.current) return;

		// Ignore ultra-fast close requests caused by rapid double-click races
		if (Date.now() - medDetailOpenedAtRef.current < 320) return;

		const currentState = window.history.state as { modal?: string } | null;
		if (currentState?.modal !== "medDetail") {
			// State already popped by another event: close locally without another back step.
			selectedMedIdRef.current = null;
			setSelectedMed(null);
			return;
		}

		medDetailCloseInFlightRef.current = true;
		window.history.back();
	}, [selectedMed]);

	const openImageLightbox = useCallback(() => {
		if (showImageLightbox) return;
		imageLightboxOpenedAtRef.current = Date.now();
		imageLightboxCloseInFlightRef.current = false;
		setShowImageLightbox(true);
		window.history.pushState({ modal: "imageLightbox" }, "");
	}, [showImageLightbox]);

	const closeImageLightbox = useCallback(() => {
		if (!showImageLightbox || imageLightboxCloseInFlightRef.current) return;
		if (Date.now() - imageLightboxOpenedAtRef.current < 320) return;

		const currentState = window.history.state as { modal?: string } | null;
		if (currentState?.modal !== "imageLightbox") {
			setShowImageLightbox(false);
			return;
		}

		imageLightboxCloseInFlightRef.current = true;
		window.history.back();
	}, [showImageLightbox]);

	const openScheduleLightbox = useCallback(
		(imageUrl: string) => {
			if (scheduleLightboxImage) return;
			scheduleLightboxOpenedAtRef.current = Date.now();
			scheduleLightboxCloseInFlightRef.current = false;
			setScheduleLightboxImage(imageUrl);
			window.history.pushState({ modal: "scheduleLightbox" }, "");
		},
		[scheduleLightboxImage]
	);

	const closeScheduleLightbox = useCallback(() => {
		if (!scheduleLightboxImage || scheduleLightboxCloseInFlightRef.current) return;
		if (Date.now() - scheduleLightboxOpenedAtRef.current < 320) return;

		const currentState = window.history.state as { modal?: string } | null;
		if (currentState?.modal !== "scheduleLightbox") {
			setScheduleLightboxImage(null);
			return;
		}

		scheduleLightboxCloseInFlightRef.current = true;
		window.history.back();
	}, [scheduleLightboxImage]);

	const openUserFilter = useCallback(
		(person: string) => {
			if (selectedUser === person) return;
			setSelectedUser(person);
			window.history.pushState({ modal: "userFilter", person }, "");
		},
		[selectedUser]
	);

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
		async (includeImages: boolean = true, includeSensitive: boolean = false) => {
			setExporting(true);
			try {
				const res = await authFetch(`/api/export?includeSensitive=${includeSensitive}&includeImages=${includeImages}`);
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
		[authFetch, t, user?.username]
	);

	// Handle file selection for import
	const handleImportFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = async (event) => {
				try {
					const data = JSON.parse(event.target?.result as string);
					if (!data.version || !data.exportedAt) {
						setPendingImportData(null);
						setImportPreview(null);
						showFeedback({ message: t("exportImport.invalidFile"), tone: "error" });
						return;
					}

					const res = await authFetch("/api/import/preview", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(data),
					});

					const text = await res.text();
					let previewResponse: { error?: string; preview?: ImportPreview } = {};
					try {
						previewResponse = text ? JSON.parse(text) : {};
					} catch {
						log.error("Import preview response parse error:", text);
						showFeedback({
							message: `${t("exportImport.importError")}: Server returned invalid response`,
							tone: "error",
						});
						return;
					}

					if (!res.ok || !previewResponse.preview) {
						setPendingImportData(null);
						setImportPreview(null);
						if (previewResponse.error === "Invalid import data format") {
							showFeedback({ message: t("exportImport.invalidFile"), tone: "error" });
							return;
						}
						showFeedback({
							message: `${t("exportImport.importError")}: ${previewResponse.error || `HTTP ${res.status}`}`,
							tone: "error",
						});
						return;
					}

					setImportResult(null);
					setPendingImportData(data);
					setImportPreview(previewResponse.preview);
					setShowImportConfirm(true);
				} catch {
					setPendingImportData(null);
					setImportPreview(null);
					showFeedback({ message: t("exportImport.invalidFile"), tone: "error" });
				}
			};
			reader.readAsText(file);
			// Reset file input
			e.target.value = "";
		},
		[authFetch, showFeedback, t]
	);

	// Confirm and execute import
	const handleImportConfirm = useCallback(async () => {
		if (!pendingImportData) return;
		setImporting(true);
		setShowImportConfirm(false);

		try {
			const res = await authFetch("/api/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(pendingImportData),
			});

			// Get the response text first to handle non-JSON responses
			const text = await res.text();
			let data: {
				error?: string;
				message?: string;
				imported?:
					| {
							medications?: number;
							doseHistory?: number;
							refillHistory?: number;
							shareLinks?: number;
					  }
					| number;
			} = {};
			try {
				data = text ? JSON.parse(text) : {};
			} catch {
				log.error("Import response parse error:", text);
				showFeedback({
					message: `${t("exportImport.importError")}: Server returned invalid response`,
					tone: "error",
				});
				return;
			}

			if (!res.ok) {
				showFeedback({
					message: `${t("exportImport.importError")}: ${data.error || `HTTP ${res.status}`}`,
					tone: "error",
				});
				return;
			}

			// Show success message in UI instead of browser alert
			const importedCounts = typeof data.imported === "object" && data.imported !== null ? data.imported : null;
			setImportResult({
				medications: importedCounts?.medications || 0,
				doses: importedCounts?.doseHistory || 0,
				refills: importedCounts?.refillHistory || 0,
				shares: importedCounts?.shareLinks || 0,
			});

			// Reload all data
			medications.loadMeds();
			settingsHook.loadSettings();
			doses.loadTakenDoses();
		} catch (err) {
			log.error("Import error:", err);
			showFeedback({ message: t("exportImport.importError"), tone: "error" });
		} finally {
			setPendingImportData(null);
			setImportPreview(null);
			setImporting(false);
		}
	}, [authFetch, pendingImportData, t, medications, settingsHook, doses, showFeedback]);

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
			settings.shareMedicationOverview !== savedSettings.shareMedicationOverview ||
			settings.upcomingTodayOnly !== savedSettings.upcomingTodayOnly ||
			settings.shareScheduleTodayOnly !== savedSettings.shareScheduleTodayOnly ||
			settings.expiryWarningDays !== savedSettings.expiryWarningDays
		);
	}, [settingsHook.settings, settingsHook.savedSettings]);

	const shareValue = useMemo(
		() => ({
			showShareDialog: share.showShareDialog,
			sharePeople: share.sharePeople,
			shareSelectedPerson: share.shareSelectedPerson,
			setShareSelectedPerson: share.setShareSelectedPerson,
			shareSelectedDays: share.shareSelectedDays,
			setShareSelectedDays: share.setShareSelectedDays,
			shareSelectedExpiryDays: share.shareSelectedExpiryDays,
			setShareSelectedExpiryDays: share.setShareSelectedExpiryDays,
			shareAllowJournalNotes: share.shareAllowJournalNotes,
			setShareAllowJournalNotes: share.setShareAllowJournalNotes,
			shareAllowMarkTaken: share.shareAllowMarkTaken,
			setShareAllowMarkTaken: share.setShareAllowMarkTaken,
			shareGenerating: share.shareGenerating,
			shareLink: share.shareLink,
			setShareLink: share.setShareLink,
			shareCopied: share.shareCopied,
			setShareCopied: share.setShareCopied,
			activeShareLinks: share.activeShareLinks,
			activeSharesLoading: share.activeSharesLoading,
			revokingShareToken: share.revokingShareToken,
			regeneratingShareToken: share.regeneratingShareToken,
			openShareDialog,
			generateShareLink: share.generateShareLink,
			revokeShareLink: share.revokeShareLink,
			regenerateShareLink: share.regenerateShareLink,
			copyShareLink: share.copyShareLink,
			closeShareDialog: share.closeShareDialog,
			resetShareDialogState: share.resetShareDialogState,
		}),
		[share, openShareDialog]
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
			settingsLoadError: settingsHook.settingsLoadError,
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
			skippedDoses: doses.skippedDoses,
			dismissedDoses: doses.dismissedDoses,
			getDoseId: doses.getDoseId,
			isDoseTakenAutomatically: doses.isDoseTakenAutomatically,
			countTakenDoses: doses.countTakenDoses,
			markDoseTaken: doses.markDoseTaken,
			markDoseSkipped: doses.markDoseSkipped,
			undoDoseTaken: doses.undoDoseTaken,
			undoDoseSkipped: doses.undoDoseSkipped,

			// From useIntakeJournal
			journalEditorOpen: intakeJournal.journalEditorOpen,
			journalHistoryOpen: intakeJournal.journalHistoryOpen,
			journalTargetDoseId: intakeJournal.journalTargetDoseId,
			journalEvent: intakeJournal.journalEvent,
			journalEventLoading: intakeJournal.journalEventLoading,
			journalEventSaving: intakeJournal.journalEventSaving,
			journalEventDeleting: intakeJournal.journalEventDeleting,
			journalEventError: intakeJournal.journalEventError,
			journalHistoryEntries: intakeJournal.journalHistoryEntries,
			journalHistoryFilters: intakeJournal.journalHistoryFilters,
			journalHistoryLoading: intakeJournal.journalHistoryLoading,
			journalHistoryError: intakeJournal.journalHistoryError,
			openJournalEditor: intakeJournal.openJournalEditor,
			closeJournalEditor: intakeJournal.closeJournalEditor,
			saveJournalNote: intakeJournal.saveJournalNote,
			deleteJournalNote: intakeJournal.deleteJournalNote,
			openJournalHistory: intakeJournal.openJournalHistory,
			closeJournalHistory: intakeJournal.closeJournalHistory,
			setJournalHistoryFilters: intakeJournal.setJournalHistoryFilters,
			reloadJournalHistory: intakeJournal.reloadJournalHistory,
			reopenJournalHistoryEntry: intakeJournal.reopenJournalHistoryEntry,

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
			shareSelectedExpiryDays: share.shareSelectedExpiryDays,
			setShareSelectedExpiryDays: share.setShareSelectedExpiryDays,
			shareAllowJournalNotes: share.shareAllowJournalNotes,
			setShareAllowJournalNotes: share.setShareAllowJournalNotes,
			shareAllowMarkTaken: share.shareAllowMarkTaken,
			setShareAllowMarkTaken: share.setShareAllowMarkTaken,
			shareGenerating: share.shareGenerating,
			shareLink: share.shareLink,
			setShareLink: share.setShareLink,
			shareCopied: share.shareCopied,
			setShareCopied: share.setShareCopied,
			activeShareLinks: share.activeShareLinks,
			activeSharesLoading: share.activeSharesLoading,
			revokingShareToken: share.revokingShareToken,
			regeneratingShareToken: share.regeneratingShareToken,
			openShareDialog,
			generateShareLink: share.generateShareLink,
			revokeShareLink: share.revokeShareLink,
			regenerateShareLink: share.regenerateShareLink,
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
			importPreview,
			setImportPreview,
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
			intakeJournal,
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
			importPreview,
			importResult,
			handleExport,
			handleImportFileSelect,
			handleImportConfirm,
			settingsChanged,
		]
	);

	return (
		<AppContext.Provider value={value}>
			<ShareContextProvider value={shareValue}>{children}</ShareContextProvider>
		</AppContext.Provider>
	);
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
