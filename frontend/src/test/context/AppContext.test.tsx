import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useAppContext } from "../../context/AppContext";
import type { Medication } from "../../types";

const mockUseAuth = vi.fn();
const mockUseMedications = vi.fn();
const mockUseSettings = vi.fn();
const mockUseDoses = vi.fn();
const mockUseCollapsedDays = vi.fn();
const mockUseShare = vi.fn();
const mockUseRefill = vi.fn();
const mockBuildSchedulePreview = vi.fn();
const mockCalculateCoverage = vi.fn();
const mockComputeMissedPastDoseIds = vi.fn();

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en" },
	}),
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => mockUseAuth(),
}));

vi.mock("../../hooks", () => ({
	useMedications: () => mockUseMedications(),
	useSettings: () => mockUseSettings(),
	useDoses: () => mockUseDoses(),
	useCollapsedDays: () => mockUseCollapsedDays(),
	useShare: () => mockUseShare(),
	useRefill: () => mockUseRefill(),
}));

vi.mock("../../utils/formatters", () => ({
	getSystemLocale: () => "en-US",
}));

vi.mock("../../utils/schedule", () => ({
	buildSchedulePreview: (...args: unknown[]) => mockBuildSchedulePreview(...args),
	calculateCoverage: (...args: unknown[]) => mockCalculateCoverage(...args),
	computeMissedPastDoseIds: (...args: unknown[]) => mockComputeMissedPastDoseIds(...args),
	isDoseDismissed: vi.fn(() => false),
}));

const meds: Medication[] = [
	{
		id: 11,
		name: "Aspirin",
		takenBy: ["Max", "Anna"],
		packageType: "blister",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		looseTablets: 2,
		blisters: [],
		updatedAt: null,
	},
];

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

		mockUseAuth.mockReturnValue({ user: { id: 7, username: "owner" } });

		mockUseMedications.mockReturnValue({
			meds,
			setMeds: vi.fn(),
			loading: false,
			saving: false,
			setSaving: vi.fn(),
			uploadingImage: false,
			loadMeds,
			deleteMed: vi.fn(),
			uploadMedImage: vi.fn(),
			deleteMedImage: vi.fn(),
		});

		mockUseSettings.mockReturnValue({
			settings: {
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
				shareStockStatus: true,
				expiryWarningDays: 30,
			},
			setSettings: vi.fn(),
			savedSettings: {
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
				shareStockStatus: true,
				expiryWarningDays: 30,
			},
			settingsLoading: false,
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
		});

		mockUseDoses.mockReturnValue({
			takenDoses: new Set<string>(),
			setTakenDoses: vi.fn(),
			takenDoseTimestamps: new Map<string, number>(),
			dismissedDoses: new Set<string>(),
			showClearMissedConfirm: true,
			setShowClearMissedConfirm: vi.fn(),
			getDoseId: vi.fn((base: string, person: string | null) => (person ? `${base}-${person}` : base)),
			countTakenDoses: vi.fn(() => ({ total: 0, taken: 0 })),
			markDoseTaken: vi.fn(),
			undoDoseTaken: vi.fn(),
			loadTakenDoses,
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
			shareGenerating: false,
			shareLink: null,
			setShareLink: vi.fn(),
			shareCopied: false,
			setShareCopied: vi.fn(),
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
			editStockSaving: false,
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

	it("dismisses missed doses and posts unique medication IDs", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		await act(async () => {
			await result.current.dismissMissedDoses(["11-0-1730000000000", "11-2-1730000100000", "12-0-1730000200000"]);
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/medications/dismiss-until",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
			})
		);

		const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
		expect(body.medicationIds).toEqual([11, 12]);
		expect(mockUseMedications().loadMeds).toHaveBeenCalled();
		expect(mockUseDoses().setShowClearMissedConfirm).toHaveBeenCalledWith(false);
	});

	it("does not dismiss missed doses for empty/invalid IDs", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		await act(async () => {
			await result.current.dismissMissedDoses([]);
			await result.current.dismissMissedDoses(["invalid-dose-id"]);
		});

		expect(fetch).not.toHaveBeenCalledWith("/api/medications/dismiss-until", expect.anything());
	});

	it("imports data and triggers reload plus import result state", async () => {
		const { result } = renderHook(() => useAppContext(), { wrapper });

		act(() => {
			result.current.setPendingImportData({ version: "1", exportedAt: new Date().toISOString(), medications: [] });
		});

		await act(async () => {
			await result.current.handleImportConfirm();
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/import",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
			})
		);
		expect(mockUseMedications().loadMeds).toHaveBeenCalled();
		expect(mockUseSettings().loadSettings).toHaveBeenCalled();
		expect(mockUseDoses().loadTakenDoses).toHaveBeenCalled();
		expect(result.current.importResult).toEqual({ medications: 1, doses: 2, refills: 4, shares: 3 });
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

		expect(fetch).toHaveBeenCalledWith("/api/export?includeSensitive=true&includeImages=true", {
			credentials: "include",
		});
		expect(createObjectURL).toHaveBeenCalled();
		expect(click).toHaveBeenCalled();
		expect(appendChild).toHaveBeenCalled();
		expect(removeChild).toHaveBeenCalled();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-url");
	});

	it("handles invalid import JSON file", () => {
		const mockAlert = vi.fn();
		global.alert = mockAlert;

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

		expect(mockAlert).toHaveBeenCalledWith("exportImport.invalidFile");
	});

	it("parses valid import file and opens confirm modal", () => {
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

		expect(result.current.showImportConfirm).toBe(true);
		expect(result.current.pendingImportData).toEqual({
			version: "1",
			exportedAt: "2026-01-01T00:00:00.000Z",
			medications: [],
		});
	});

	it("computes day stock status as warning and danger for low/out stock", async () => {
		mockCalculateCoverage.mockReturnValue({
			all: [
				{
					name: "Aspirin",
					daysLeft: 2,
					medsLeft: 5,
					depletionTime: Date.now() + 100000,
				},
				{
					name: "Vitamin C",
					daysLeft: 0,
					medsLeft: 0,
					depletionTime: Date.now() - 100000,
				},
			],
			low: [],
		});

		const { result } = renderHook(() => useAppContext(), { wrapper });

		expect(result.current.getDayStockStatus([{ medName: "Aspirin", lastWhen: Date.now() }])).toBe("warning");
		expect(result.current.getDayStockStatus([{ medName: "Vitamin C", lastWhen: Date.now() }])).toBe("danger");
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

	it("shows import error alert when import API returns non-ok response", async () => {
		const mockAlert = vi.fn();
		global.alert = mockAlert;

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

		expect(mockAlert).toHaveBeenCalledWith("exportImport.importError: Import failed");
	});

	it("keeps clear-missed confirm open when dismiss request fails", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
		const { result } = renderHook(() => useAppContext(), { wrapper });

		await act(async () => {
			await result.current.dismissMissedDoses(["11-0-1730000000000"]);
		});

		expect(mockUseDoses().setShowClearMissedConfirm).not.toHaveBeenCalledWith(false);
	});
});
