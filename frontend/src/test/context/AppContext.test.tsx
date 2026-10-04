import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useAppContext } from "../../context/AppContext";
import type { Medication, ScheduleEvent } from "../../types";

const feedbackMock = vi.hoisted(() => ({ showFeedback: vi.fn() }));
const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
const mockUseAuth = vi.fn();
const mockUseAsNeededIntakes = vi.fn();
const mockUseMedications = vi.fn();
const mockUseSettings = vi.fn();
const mockUseDoses = vi.fn();
const mockUseIntakeJournal = vi.fn();
const mockUseCollapsedDays = vi.fn();
const mockUseShare = vi.fn();
const mockUseRefill = vi.fn();
const mockBuildSchedulePreview = vi.fn();
const mockCalculateCoverage = vi.fn();
const mockComputeMissedPastDoseIds = vi.fn();

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en-US" },
	}),
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => mockUseAuth(),
}));

vi.mock("../../hooks/useAsNeededIntakes", () => ({
	useAsNeededIntakes: () => mockUseAsNeededIntakes(),
}));

vi.mock("../../context/FeedbackContext", () => ({
	useFeedback: () => ({
		showFeedback: feedbackMock.showFeedback,
		dismissFeedback: vi.fn(),
		clearFeedback: vi.fn(),
	}),
}));

vi.mock("../../hooks/useCollapsedDays", () => ({
	useCollapsedDays: () => mockUseCollapsedDays(),
}));

vi.mock("../../hooks/useDoses", () => ({
	useDoses: () => mockUseDoses(),
}));

vi.mock("../../hooks/useIntakeJournal", () => ({
	useIntakeJournal: () => mockUseIntakeJournal(),
}));

vi.mock("../../hooks/useMedications", () => ({
	useMedications: () => mockUseMedications(),
}));

vi.mock("../../hooks/useRefill", () => ({
	useRefill: () => mockUseRefill(),
}));

vi.mock("../../hooks/useSettings", () => ({
	useSettings: () => mockUseSettings(),
}));

vi.mock("../../hooks/useShare", () => ({
	useShare: () => mockUseShare(),
}));

vi.mock("../../utils/formatters", () => ({
	getSystemLocale: () => "en-US",
	setDefaultFormattingTimezone: vi.fn(),
}));

vi.mock("../../utils/schedule", async () => {
	const actual = await vi.importActual<typeof import("../../utils/schedule")>("../../utils/schedule");
	return {
		...actual,
		buildSchedulePreview: (...args: unknown[]) => mockBuildSchedulePreview(...args),
		calculateCoverage: (...args: unknown[]) => mockCalculateCoverage(...args),
		computeMissedPastDoseIds: (...args: unknown[]) => mockComputeMissedPastDoseIds(...args),
		isDoseDismissed: vi.fn(() => false),
	};
});

const meds: Medication[] = [
	{
		id: 11,
		name: "Aspirin",
		takenBy: ["Max", "Anna", "max"],
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		looseTablets: 2,
		blisters: [],
		updatedAt: null,
	},
];

const defaultSettings = {
	emailEnabled: false,
	notificationEmail: "",
	reminderDaysBefore: 7,
	repeatDailyReminders: false,
	skipRemindersForTakenDoses: false,
	repeatRemindersEnabled: false,
	reminderRepeatIntervalMinutes: 30,
	maxNaggingReminders: 5,
	lowStockDays: 10,
	normalStockDays: 30,
	highStockDays: 60,
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
	shareMedicationOverview: false,
	expiryWarningDays: 30,
};

const wrapper = ({ children }: { children: React.ReactNode }) => <AppProvider>{children}</AppProvider>;

describe("useAppContext", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		vi.spyOn(window.history, "pushState").mockImplementation(() => {});
		vi.spyOn(window.history, "back").mockImplementation(() => {});
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("90");

		const loadMeds = vi.fn();
		const loadSettings = vi.fn();
		const loadTakenDoses = vi.fn();

		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
		mockUseAuth.mockReturnValue({ user: { id: 7, username: "owner" }, authFetch: authFetchMock });
		mockUseAsNeededIntakes.mockReturnValue({
			recordAsNeededIntake: vi.fn(async () => ({ event: {}, inventory: {} })),
			undoAsNeededIntake: vi.fn(async () => undefined),
		});

		mockUseMedications.mockReturnValue({
			meds,
			setMeds: vi.fn(),
			loading: false,
			saving: false,
			setSaving: vi.fn(),
			uploadingImage: false,
			clearMedicationsState: vi.fn(),
			loadMeds,
			deleteMed: vi.fn(),
			uploadMedImage: vi.fn(),
			deleteMedImage: vi.fn(),
		});

		mockUseSettings.mockReturnValue({
			settings: { ...defaultSettings },
			setSettings: vi.fn(),
			savedSettings: { ...defaultSettings },
			settingsLoading: false,
			settingsLoadError: null,
			settingsSaving: false,
			settingsSaved: false,
			testingEmail: false,
			testEmailResult: null,
			setTestEmailResult: vi.fn(),
			testingShoutrrr: false,
			testShoutrrrResult: null,
			setTestShoutrrrResult: vi.fn(),
			loadSettings,
			saveSettings: vi.fn(),
			testEmail: vi.fn(),
			testShoutrrr: vi.fn(),
			hasUnsavedChanges: false,
			resetSettingsState: vi.fn(),
		});

		mockUseDoses.mockReturnValue({
			takenDoses: new Set<string>(),
			setTakenDoses: vi.fn(),
			takenDoseTimestamps: new Map<string, number>(),
			dismissedDoses: new Set<string>(),
			clearDosesState: vi.fn(),
			getDoseId: vi.fn((base: string, person: string | null) => (person ? `${base}-${person}` : base)),
			isDoseTakenAutomatically: vi.fn(() => false),
			countTakenDoses: vi.fn(() => ({ total: 0, taken: 0 })),
			markDoseTaken: vi.fn(),
			undoDoseTaken: vi.fn(),
			loadTakenDoses,
		});

		mockUseIntakeJournal.mockReturnValue({
			journalEditorOpen: false,
			journalHistoryOpen: false,
			journalTargetDoseId: null,
			journalEvent: null,
			journalEventLoading: false,
			journalEventSaving: false,
			journalEventDeleting: false,
			journalEventError: null,
			journalHistoryEntries: [],
			journalHistoryFilters: {
				medicationId: null,
				from: "",
				until: "",
			},
			journalHistoryLoading: false,
			journalHistoryError: null,
			openJournalEditor: vi.fn(),
			closeJournalEditor: vi.fn(),
			saveJournalNote: vi.fn(async () => true),
			deleteJournalNote: vi.fn(async () => true),
			openJournalHistory: vi.fn(),
			closeJournalHistory: vi.fn(),
			setJournalHistoryFilters: vi.fn(),
			reloadJournalHistory: vi.fn(async () => {}),
			reopenJournalHistoryEntry: vi.fn(async () => {}),
			resetJournalState: vi.fn(),
		});

		mockUseCollapsedDays.mockReturnValue({
			manuallyCollapsedDays: new Set<string>(),
			manuallyExpandedDays: new Set<string>(),
			toggleDayCollapse: vi.fn(),
		});

		mockUseShare.mockReturnValue({
			showShareDialog: false,
			sharePeople: ["Anna", "Max"],
			shareSelectedPerson: "Anna",
			setShareSelectedPerson: vi.fn(),
			shareSelectedDays: 30,
			setShareSelectedDays: vi.fn(),
			shareSelectedExpiryDays: null,
			setShareSelectedExpiryDays: vi.fn(),
			shareAllowJournalNotes: false,
			setShareAllowJournalNotes: vi.fn(),
			shareAllowMarkTaken: false,
			setShareAllowMarkTaken: vi.fn(),
			shareGenerating: false,
			shareLink: null,
			setShareLink: vi.fn(),
			shareCopied: false,
			setShareCopied: vi.fn(),
			activeShareLinks: [],
			activeSharesLoading: false,
			revokingShareToken: null,
			regeneratingShareToken: null,
			revokeShareLink: vi.fn(),
			regenerateShareLink: vi.fn(),
			openShareDialog: vi.fn(),
			generateShareLink: vi.fn(),
			copyShareLink: vi.fn(),
			closeShareDialog: vi.fn(),
			resetShareDialogState: vi.fn(),
		});

		mockUseRefill.mockReturnValue({
			showRefillModal: false,
			setShowRefillModal: vi.fn(),
			refillPacks: 1,
			setRefillPacks: vi.fn(),
			refillLoose: 0,
			setRefillLoose: vi.fn(),
			usePrescriptionRefill: false,
			setUsePrescriptionRefill: vi.fn(),
			refillSaving: false,
			refillHistory: [],
			refillHistoryExpanded: false,
			setRefillHistoryExpanded: vi.fn(),
			showEditStockModal: false,
			setShowEditStockModal: vi.fn(),
			editStockFullBlisters: 0,
			setEditStockFullBlisters: vi.fn(),
			editStockPartialBlisterPills: 0,
			setEditStockPartialBlisterPills: vi.fn(),
			editStockLoosePills: 0,
			setEditStockLoosePills: vi.fn(),
			editStockSaving: false,
			editStockMedication: null,
			clearRefillState: vi.fn(),
			loadRefillHistory: vi.fn(),
			submitRefill: vi.fn(),
			submitStockCorrection: vi.fn(),
			openRefillModal: vi.fn(),
			closeRefillModal: vi.fn(),
			openEditStockModal: vi.fn(),
			closeEditStockModal: vi.fn(),
		});

		mockBuildSchedulePreview.mockReturnValue({ events: [] });
		mockCalculateCoverage.mockReturnValue({ all: [], low: [] });
		mockComputeMissedPastDoseIds.mockReturnValue([]);

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
			text: () => Promise.resolve('{"imported":{"medications":1,"doseHistory":2,"refillHistory":4,"shareLinks":3}}'),
		});
	});

	it("throws if used outside AppProvider", () => {
		expect(() => renderHook(() => useAppContext())).toThrow("useAppContext must be used within an AppProvider");
	});

	it("loads initial values and composes computed fields", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		await waitFor(() => {
			expect(result.current.scheduleDays).toBe(90);
		});

		expect(mockUseMedications().loadMeds).toHaveBeenCalled();
		expect(mockUseSettings().loadSettings).toHaveBeenCalled();
		expect(result.current.existingPeople).toEqual(["Anna", "Max"]);
		expect(result.current.stockThresholds.lowStockDays).toBe(10);
		expect(result.current.settingsChanged).toBe(false);
	});

	it("derives coverage from active medications and excludes empty-stock taken doses from missed-dose input", () => {
		const obsolete = { ...meds[0], id: 22, isObsolete: true };
		mockUseMedications.mockReturnValue({ ...mockUseMedications(), meds: [...meds, obsolete] });
		const takenDoses = new Set(["11-0-1", "22-0-1", "legacy-dose"]);
		const takenDoseTimestamps = new Map([["11-0-1", 123]]);
		mockUseDoses.mockReturnValue({ ...mockUseDoses(), takenDoses, takenDoseTimestamps });
		const entry = { name: "Aspirin", medsLeft: 0, depletionTime: 456 };
		mockCalculateCoverage.mockReturnValue({ all: [entry], low: [entry] });
		const { result } = renderHook(() => useAppContext(), { wrapper });
		expect(mockBuildSchedulePreview).toHaveBeenCalledWith(meds, "en-US", true);
		expect(mockCalculateCoverage).toHaveBeenLastCalledWith(
			meds,
			[],
			"en-US",
			7,
			"automatic",
			takenDoses,
			takenDoseTimestamps
		);
		expect(result.current.coverageByMed.Aspirin).toEqual(entry);
		expect(result.current.depletionByMed.Aspirin).toBe(456);
		expect(mockComputeMissedPastDoseIds).toHaveBeenLastCalledWith(
			[],
			meds,
			new Set(["22-0-1", "legacy-dose"]),
			mockUseDoses().dismissedDoses
		);
		// People include obsolete medications, as before.
		expect(result.current.existingPeople).toEqual(["Anna", "Max"]);
	});

	it("bounds past and future days while preserving dose grouping and today", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("2");
		const day = (offset: number) => {
			const date = new Date();
			date.setHours(12, 0, 0, 0);
			date.setDate(date.getDate() + offset);
			return date;
		};
		const event = (offset: number, id: string, usage = 1): ScheduleEvent => ({
			id,
			medName: "Aspirin",
			dateStr: `day-${offset}`,
			when: day(offset).getTime(),
			timeStr: "12:00",
			usage,
			isPast: offset < 0,
			takenBy: "Max",
			intakeRemindersEnabled: true,
		});
		mockBuildSchedulePreview.mockReturnValue({
			events: [
				event(-3, "old"),
				event(-2, "boundary"),
				event(0, "today-a"),
				event(0, "today-b", 2),
				event(1, "future-a"),
				event(2, "future-b"),
				event(3, "future-c"),
			],
		});
		const { result } = renderHook(() => useAppContext(), { wrapper });
		expect(result.current.pastDays.map((d) => d.dateStr)).toEqual(["day--2"]);
		expect(result.current.futureDays.map((d) => d.dateStr)).toEqual(["day-1", "day-2"]);
		expect(result.current.todayDay?.meds[0].total).toBe(3);
		expect(result.current.todayDay?.meds[0].doses.map((dose) => dose.id)).toEqual(["today-a", "today-b"]);
		expect(result.current.todayDay?.meds[0].doses[0]).toMatchObject({ takenBy: ["Max"], intakeUnit: null });
		expect(result.current.todayDay?.meds[0].lastWhen).toBe(day(0).getTime());
		act(() => result.current.setScheduleDays(1));
		expect(result.current.pastDays).toEqual([]);
		expect(result.current.futureDays.map((d) => d.dateStr)).toEqual(["day-1"]);
	});

	it("silently refreshes medications after taking or undoing an as-needed intake", async () => {
		const recordAsNeededIntake = vi.fn(async () => ({ event: {}, inventory: {} }));
		const undoAsNeededIntake = vi.fn(async () => undefined);
		mockUseAsNeededIntakes.mockReturnValue({ recordAsNeededIntake, undoAsNeededIntake });
		const { result } = renderHook(() => useAppContext(), { wrapper });

		await act(async () => {
			await result.current.recordAsNeededIntake({
				medicationId: 11,
				quantity: 1,
				person: null,
				idempotencyKey: "intent-key",
			});
			await result.current.undoAsNeededIntake("event-11");
		});

		expect(mockUseMedications().loadMeds).toHaveBeenCalledWith({ silent: true });
		expect(mockUseMedications().loadMeds).toHaveBeenCalledTimes(3);
	});

	it("marks settings as changed when shareMedicationOverview differs", async () => {
		const settingsValue = mockUseSettings();
		mockUseSettings.mockReturnValue({
			...settingsValue,
			settings: {
				...settingsValue.settings,
				shareMedicationOverview: true,
			},
			savedSettings: {
				...settingsValue.savedSettings,
				shareMedicationOverview: false,
			},
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		await waitFor(() => {
			expect(result.current.settingsChanged).toBe(true);
		});
	});

	it("marks settings as changed when timezone differs", async () => {
		const settingsValue = mockUseSettings();
		mockUseSettings.mockReturnValue({
			...settingsValue,
			settings: {
				...settingsValue.settings,
				timezone: "Europe/Berlin",
			},
			savedSettings: {
				...settingsValue.savedSettings,
				timezone: "",
			},
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		await waitFor(() => {
			expect(result.current.settingsChanged).toBe(true);
		});
	});

	it("does not mark settings as changed for scheduler metadata refreshes", async () => {
		const settingsValue = mockUseSettings();
		mockUseSettings.mockReturnValue({
			...settingsValue,
			settings: {
				...settingsValue.settings,
				lastAutoEmailSent: "2026-06-06T08:00:00.000Z",
				lastNotificationType: "stock",
				lastStockReminderChannel: "both",
			},
			savedSettings: {
				...settingsValue.savedSettings,
				lastAutoEmailSent: null,
				lastNotificationType: null,
				lastStockReminderChannel: null,
			},
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		await waitFor(() => {
			expect(result.current.settingsChanged).toBe(false);
		});
	});

	it("exposes the settings load error from useSettings", async () => {
		const settingsValue = mockUseSettings();
		mockUseSettings.mockReturnValue({
			...settingsValue,
			settingsLoadError: "forbidden",
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		await waitFor(() => {
			expect(result.current.settingsLoadError).toBe("forbidden");
		});
	});

	it("clears user-scoped state and reloads data when authenticated user changes", async () => {
		const { result, rerender } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.openImageLightbox();
			result.current.openUserFilter("Max");
			result.current.setShowImportConfirm(true);
			result.current.setPendingImportData({ version: "1" });
			result.current.setImportResult({ medications: 1, doses: 1, refills: 0, shares: 0 });
		});

		const clearMedicationsStateBefore = mockUseMedications().clearMedicationsState.mock.calls.length;
		const resetSettingsStateBefore = mockUseSettings().resetSettingsState.mock.calls.length;
		const clearDosesStateBefore = mockUseDoses().clearDosesState.mock.calls.length;
		const clearRefillStateBefore = mockUseRefill().clearRefillState.mock.calls.length;
		const resetShareDialogStateBefore = mockUseShare().resetShareDialogState.mock.calls.length;

		mockUseAuth.mockReturnValue({ user: { id: 8, username: "other-user" }, authFetch: authFetchMock });
		rerender();

		await waitFor(() => {
			expect(mockUseMedications().clearMedicationsState).toHaveBeenCalledTimes(clearMedicationsStateBefore + 1);
			expect(mockUseSettings().resetSettingsState).toHaveBeenCalledTimes(resetSettingsStateBefore + 1);
			expect(mockUseDoses().clearDosesState).toHaveBeenCalledTimes(clearDosesStateBefore + 1);
			expect(mockUseRefill().clearRefillState).toHaveBeenCalledTimes(clearRefillStateBefore + 1);
			expect(mockUseShare().resetShareDialogState).toHaveBeenCalledTimes(resetShareDialogStateBefore + 1);
		});

		expect(result.current.selectedUser).toBeNull();
		expect(result.current.showImageLightbox).toBe(false);
		expect(result.current.showImportConfirm).toBe(false);
		expect(result.current.pendingImportData).toBeNull();
		expect(result.current.importResult).toBeNull();
	});

	it("wraps share dialog opener with current medications", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.openShareDialog();
		});

		expect(mockUseShare().openShareDialog).toHaveBeenCalledWith(meds);
	});

	it("opens and closes modal helpers via browser history", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.openImageLightbox();
			result.current.openScheduleLightbox("image.png");
			result.current.openUserFilter("Max");
			result.current.openMedDetail(meds[0]);
		});

		expect(window.history.pushState).toHaveBeenCalled();
		expect(mockUseRefill().loadRefillHistory).toHaveBeenCalledWith(11);

		act(() => {
			result.current.closeImageLightbox();
			result.current.closeScheduleLightbox();
			result.current.closeUserFilter();
			result.current.closeMedDetail();
		});

		expect(window.history.back).toHaveBeenCalled();
	});

	it("closes an AppContext modal when browser back pops the modal history entry", () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.openImageLightbox();
		});

		expect(result.current.showImageLightbox).toBe(true);

		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(result.current.showImageLightbox).toBe(false);
	});

	it("uses modal history for direct AppContext modal close", () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.openUserFilter("Max");
		});

		expect(result.current.selectedUser).toBe("Max");

		act(() => {
			result.current.closeUserFilter();
		});

		expect(result.current.selectedUser).toBeNull();
		expect(window.history.back).toHaveBeenCalledTimes(1);
	});

	it("deduplicates detail opens and refreshes selected stock without another history entry", () => {
		const { result, rerender } = renderHook(() => useAppContext(), { wrapper });
		act(() => {
			result.current.openMedDetail(meds[0]);
			result.current.openMedDetail(meds[0]);
		});
		expect(mockUseRefill().loadRefillHistory).toHaveBeenCalledTimes(1);
		expect(window.history.pushState).toHaveBeenCalledTimes(1);
		expect(window.history.pushState).toHaveBeenCalledWith({ modal: "medDetail", medId: 11 }, "");

		const updated = { ...meds[0], packCount: 3 };
		mockUseMedications.mockReturnValue({ ...mockUseMedications(), meds: [updated] });
		rerender();
		expect(result.current.selectedMed).toEqual(updated);
		expect(window.history.pushState).toHaveBeenCalledTimes(1);
	});

	it("preserves detail under a nested image lightbox when browser back closes the top modal", () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });
		act(() => result.current.openMedDetail(meds[0]));
		act(() => result.current.openImageLightbox());
		act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(result.current.showImageLightbox).toBe(false);
		expect(result.current.selectedMed).toEqual(meds[0]);
		act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(result.current.selectedMed).toBeNull();
	});

	it("clears all extracted modal state on an identity switch", () => {
		const { result, rerender } = renderHook(() => useAppContext(), { wrapper });
		act(() => {
			result.current.openMedDetail(meds[0]);
			result.current.openImageLightbox();
			result.current.openScheduleLightbox("private.png");
			result.current.openUserFilter("Max");
		});
		mockUseAuth.mockReturnValue({ ...mockUseAuth(), user: { id: 2 } });
		rerender();
		expect(result.current.selectedMed).toBeNull();
		expect(result.current.showImageLightbox).toBe(false);
		expect(result.current.scheduleLightboxImage).toBeNull();
		expect(result.current.selectedUser).toBeNull();
	});

	it("imports data and triggers reload plus import result state", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.setPendingImportData({ version: "1", exportedAt: new Date().toISOString(), medications: [] });
		});

		await act(async () => {
			await result.current.handleImportConfirm();
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/import",
			expect.objectContaining({
				method: "POST",
			})
		);
		expect(mockUseMedications().loadMeds).toHaveBeenCalled();
		expect(mockUseSettings().loadSettings).toHaveBeenCalled();
		expect(mockUseDoses().loadTakenDoses).toHaveBeenCalled();
		expect(result.current.importResult).toEqual({
			medications: 1,
			doses: 2,
			asNeededIntakes: 0,
			refills: 4,
			shares: 3,
		});
	});

	it("exports data and triggers JSON download", async () => {
		const click = vi.fn();
		const appendChild = vi.spyOn(document.body, "appendChild");
		const removeChild = vi.spyOn(document.body, "removeChild");
		const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export-url");
		const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

		const originalCreateElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
			const element = originalCreateElement(tagName);
			if (tagName === "a") {
				Object.defineProperty(element, "click", { value: click, configurable: true });
			}
			return element;
		});

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ version: "1", medications: [] }),
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		await act(async () => {
			await result.current.handleExport(true);
		});

		expect(authFetchMock).toHaveBeenCalledWith("/api/export?includeSensitive=false&includeImages=true");
		expect(createObjectURL).toHaveBeenCalled();
		expect(click).toHaveBeenCalled();
		expect(appendChild).toHaveBeenCalled();
		expect(removeChild).toHaveBeenCalled();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-url");
	});

	it("exports sensitive data only when explicitly requested", async () => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sensitive-export-url");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ version: "1", medications: [] }),
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		await act(async () => {
			await result.current.handleExport(false, true);
		});

		expect(authFetchMock).toHaveBeenCalledWith("/api/export?includeSensitive=true&includeImages=false");
	});

	it("handles invalid import JSON file", () => {
		class MockFileReader {
			onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
			readAsText = vi.fn(() => {
				this.onload?.({ target: { result: "not-json" } } as unknown as ProgressEvent<FileReader>);
			});
		}
		vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);

		const { result } = renderHook(() => useAppContext(), { wrapper });
		const file = new File(["bad"], "bad.json", { type: "application/json" });

		act(() => {
			result.current.handleImportFileSelect({
				target: { files: [file], value: "file" },
			} as unknown as React.ChangeEvent<HTMLInputElement>);
		});

		expect(feedbackMock.showFeedback).toHaveBeenCalledWith({ message: "exportImport.invalidFile", tone: "error" });
	});

	it("parses valid import file and opens confirm modal", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			text: () =>
				Promise.resolve(
					JSON.stringify({
						preview: {
							version: "1",
							exportedAt: "2026-01-01T00:00:00.000Z",
							includeSensitiveData: true,
							incoming: {
								medications: 0,
								doseHistory: 0,
								refillHistory: 0,
								shareLinks: 0,
								journalEntries: 0,
								imageCount: 0,
								hasSettings: false,
							},
							current: {
								medications: 1,
								doseHistory: 0,
								refillHistory: 0,
								shareLinks: 0,
								hasSettings: true,
							},
							warnings: {
								replacesExistingData: true,
								regeneratesShareLinks: false,
								containsImages: false,
								containsSensitiveData: true,
							},
						},
					})
				),
		});

		class MockFileReader {
			onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
			readAsText = vi.fn(() => {
				this.onload?.({
					target: {
						result: JSON.stringify({ version: "1", exportedAt: "2026-01-01T00:00:00.000Z", medications: [] }),
					},
				} as unknown as ProgressEvent<FileReader>);
			});
		}
		vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);

		const { result } = renderHook(() => useAppContext(), { wrapper });
		const file = new File(["ok"], "ok.json", { type: "application/json" });

		act(() => {
			result.current.handleImportFileSelect({
				target: { files: [file], value: "file" },
			} as unknown as React.ChangeEvent<HTMLInputElement>);
		});

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith(
				"/api/import/preview",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify({ version: "1", exportedAt: "2026-01-01T00:00:00.000Z", medications: [] }),
				})
			);
			expect(result.current.showImportConfirm).toBe(true);
			expect(result.current.pendingImportData).toEqual({
				version: "1",
				exportedAt: "2026-01-01T00:00:00.000Z",
				medications: [],
			});
		});
	});

	it("does not navigate back when closing modals that are not open", () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.closeImageLightbox();
			result.current.closeScheduleLightbox();
			result.current.closeUserFilter();
			result.current.closeMedDetail();
		});

		expect(window.history.back).not.toHaveBeenCalled();
	});

	it("shows a localized fallback without exposing generic import API errors", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 500,
			text: () => Promise.resolve('{"error":"Import failed"}'),
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.setPendingImportData({ version: "1", exportedAt: new Date().toISOString(), medications: [] });
		});

		await act(async () => {
			await result.current.handleImportConfirm();
		});

		expect(feedbackMock.showFeedback).toHaveBeenCalledTimes(1);
		expect(feedbackMock.showFeedback).toHaveBeenCalledWith({
			message: "exportImport.importError",
			tone: "error",
		});
	});
});
