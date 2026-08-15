import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../../pages/SettingsPage";

const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

const changeLanguageMock = vi.fn();

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string) => key,
			i18n: {
				language: "en",
				changeLanguage: changeLanguageMock,
			},
		}),
	};
});

const createMockContext = (overrides = {}) => ({
	settings: {
		emailEnabled: false,
		notificationEmail: "",
		reminderDaysBefore: 7,
		repeatDailyReminders: false,
		lowStockDays: 30,
		normalStockDays: 90,
		highStockDays: 180,
		shoutrrrEnabled: false,
		shoutrrrUrl: "",
		emailStockReminders: false,
		emailIntakeReminders: false,
		emailPrescriptionReminders: false,
		shoutrrrStockReminders: false,
		shoutrrrIntakeReminders: false,
		shoutrrrPrescriptionReminders: false,
		skipRemindersForTakenDoses: false,
		repeatRemindersEnabled: false,
		reminderRepeatIntervalMinutes: 30,
		maxNaggingReminders: 5,
		language: "en",
		timezone: "Europe/Berlin",
		serverTimezone: "Europe/Berlin",
		availableTimezones: ["Europe/Berlin", "UTC"],
		stockCalculationMode: "automatic",
		smtpHost: "",
		smtpPort: 587,
		smtpUser: "",
		smtpFrom: "",
		smtpSecure: false,
		hasSmtpPassword: false,
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
	},
	setSettings: vi.fn(),
	loadSettings: vi.fn(),
	settingsLoading: false,
	settingsLoadError: null,
	settingsSaving: false,
	settingsSaved: false,
	saveSettings: vi.fn((e?: Event) => e?.preventDefault?.()),
	settingsChanged: false,
	testEmail: vi.fn(),
	testingEmail: false,
	testEmailResult: null,
	testShoutrrr: vi.fn(),
	testingShoutrrr: false,
	testShoutrrrResult: null,
	exporting: false,
	importing: false,
	showExportModal: false,
	setShowExportModal: vi.fn(),
	handleExport: vi.fn(),
	handleImportFileSelect: vi.fn(),
	showImportConfirm: false,
	setShowImportConfirm: vi.fn(),
	pendingImportData: null,
	setPendingImportData: vi.fn(),
	importPreview: null,
	setImportPreview: vi.fn(),
	handleImportConfirm: vi.fn(),
	importResult: null,
	setImportResult: vi.fn(),
	meds: [],
	...overrides,
});

let mockContextValue = createMockContext();
const fetchMock = vi.fn();

vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({ authFetch: authFetchMock }),
}));

interface MockExportModalProps {
	isOpen: boolean;
	onClose: () => void;
	onExport: (includeImages: boolean, includeSensitive: boolean) => void;
}

const createImportPreview = (overrides = {}) => ({
	version: "1.6",
	exportedAt: "2026-05-17T10:00:00.000Z",
	includeSensitiveData: false,
	incoming: {
		medications: 1,
		doseHistory: 2,
		refillHistory: 3,
		shareLinks: 4,
		journalEntries: 1,
		imageCount: 0,
		hasSettings: true,
	},
	current: {
		medications: 1,
		doseHistory: 0,
		refillHistory: 0,
		shareLinks: 0,
		hasSettings: false,
	},
	warnings: {
		replacesExistingData: true,
		regeneratesShareLinks: true,
		containsImages: false,
		containsSensitiveData: false,
	},
	...overrides,
});

vi.mock("../../components/ExportModal", () => ({
	default: ({ isOpen, onClose, onExport }: MockExportModalProps) =>
		isOpen ? (
			<div>
				<button type="button" onClick={() => onExport(true, false)}>
					export-modal-export
				</button>
				<button type="button" onClick={onClose}>
					export-modal-close
				</button>
			</div>
		) : null,
}));

function renderPage() {
	render(
		<MemoryRouter>
			<SettingsPage />
		</MemoryRouter>
	);
}

function checkboxForSetting(label: string) {
	const labelText = screen.getByText(label);
	const row = labelText.closest("div")?.parentElement;
	const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;

	expect(checkbox).toBeInTheDocument();
	return checkbox as HTMLInputElement;
}

describe("SettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContextValue = createMockContext();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
		fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
		vi.stubGlobal("fetch", fetchMock);
	});

	it("renders settings form container", () => {
		renderPage();
		expect(screen.getByTestId("settings-page")).toBeInTheDocument();
	});

	it("renders loading text while settings are loading", () => {
		mockContextValue = createMockContext({ settingsLoading: true });
		renderPage();
		expect(screen.getByText("settings.loading")).toBeInTheDocument();
	});

	it("renders major sections", () => {
		renderPage();
		expect(screen.getByText(/settings\.language\.title/i)).toBeInTheDocument();
		expect(screen.getByText(/settings\.notifications\.title/i)).toBeInTheDocument();
		expect(screen.getByText(/settings\.stock\.title/i)).toBeInTheDocument();
		expect(screen.getByText(/exportImport\.title/i)).toBeInTheDocument();
	});

	it("wires stock calculation radios with ids and matching labels", () => {
		renderPage();

		const modeGroup = screen.getByTestId("settings-calculation-mode");
		const automatic = modeGroup.querySelector('input[type="radio"][value="automatic"]') as HTMLInputElement | null;
		const manual = modeGroup.querySelector('input[type="radio"][value="manual"]') as HTMLInputElement | null;

		expect(automatic?.id).toBeTruthy();
		expect(manual?.id).toBeTruthy();
		expect(modeGroup.querySelector(`label[for="${automatic?.id}"]`)).toBeInTheDocument();
		expect(modeGroup.querySelector(`label[for="${manual?.id}"]`)).toBeInTheDocument();
	});

	it("keeps the export action inside the danger zone card", () => {
		renderPage();

		const dangerZoneCard = screen.getByTestId("settings-danger-zone-card");
		expect(dangerZoneCard).toContainElement(screen.getByText("exportImport.export"));
	});

	it("renders language select and switches language", () => {
		renderPage();
		const select = screen.getByTestId("settings-language-select").querySelector("select") as HTMLSelectElement | null;
		expect(select).toBeInTheDocument();
		fireEvent.change(select as HTMLSelectElement, { target: { value: "de" } });
		expect(changeLanguageMock).toHaveBeenCalledWith("de");
		expect(authFetchMock).toHaveBeenCalledWith("/api/settings/language", expect.objectContaining({ method: "PUT" }));
	});

	it("serializes rapid language changes and persists the final selection last", async () => {
		let resolveFirstSave: (response: Response) => void = () => {};
		authFetchMock
			.mockImplementationOnce(
				() =>
					new Promise<Response>((resolve) => {
						resolveFirstSave = resolve;
					})
			)
			.mockResolvedValueOnce({ ok: true } as Response);

		renderPage();
		const select = screen.getByTestId("settings-language-select").querySelector("select") as HTMLSelectElement | null;
		expect(select).toBeInTheDocument();

		fireEvent.change(select as HTMLSelectElement, { target: { value: "de" } });
		fireEvent.change(select as HTMLSelectElement, { target: { value: "en" } });

		expect(authFetchMock).toHaveBeenCalledTimes(1);
		expect(JSON.parse((authFetchMock.mock.calls[0]?.[1]?.body as string) ?? "{}")).toEqual({ language: "de" });

		await act(async () => {
			resolveFirstSave({ ok: true } as Response);
			await Promise.resolve();
		});

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledTimes(2);
		});
		expect(JSON.parse((authFetchMock.mock.calls[1]?.[1]?.body as string) ?? "{}")).toEqual({ language: "en" });
		expect(changeLanguageMock).toHaveBeenCalledWith("de");
		expect(changeLanguageMock).toHaveBeenCalledWith("en");
	});

	it("reloads persisted settings when the final language save fails", async () => {
		const loadSettings = vi.fn();
		mockContextValue = createMockContext({ loadSettings });
		authFetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

		renderPage();
		const select = screen.getByTestId("settings-language-select").querySelector("select") as HTMLSelectElement | null;
		expect(select).toBeInTheDocument();

		fireEvent.change(select as HTMLSelectElement, { target: { value: "de" } });

		await waitFor(() => {
			expect(loadSettings).toHaveBeenCalledTimes(1);
		});
	});

	it("generates an API key through authFetch and shows the returned token", async () => {
		fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ token: "new-token-123" }) });

		renderPage();
		fireEvent.click(screen.getByText("settings.apiKey.generateButton"));

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/auth/api-keys",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ name: "Default API Key", scope: "write" }),
			})
		);

		expect(await screen.findByDisplayValue("new-token-123")).toBeInTheDocument();
	});

	it("updates timeline toggles through setSettings", () => {
		const setSettings = vi.fn();
		mockContextValue = createMockContext({
			setSettings,
			settings: {
				...createMockContext().settings,
				swapDashboardMainSections: false,
				upcomingTodayOnly: false,
				shareScheduleTodayOnly: false,
			},
		});

		renderPage();

		const swapToggle = checkboxForSetting("settings.timeline.swapDashboardSections");
		const upcomingToggle = checkboxForSetting("settings.timeline.upcomingTodayOnly");
		const overviewToggle = checkboxForSetting("settings.timeline.shareMedicationOverview");
		const sharedToggle = checkboxForSetting("settings.timeline.shareScheduleTodayOnly");

		fireEvent.click(swapToggle);
		fireEvent.click(upcomingToggle);
		fireEvent.click(overviewToggle);
		fireEvent.click(sharedToggle);

		expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ swapDashboardMainSections: true }));
		expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ upcomingTodayOnly: true }));
		expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ shareMedicationOverview: true }));
		expect(setSettings).toHaveBeenCalledWith(expect.objectContaining({ shareScheduleTodayOnly: true }));
	});

	it("opens export modal when export action is clicked", () => {
		const setShowExportModal = vi.fn();
		mockContextValue = createMockContext({ setShowExportModal });

		renderPage();
		fireEvent.click(screen.getByText("exportImport.export"));

		expect(setShowExportModal).toHaveBeenCalledWith(true);
	});

	it("triggers export modal close callback", () => {
		const setShowExportModal = vi.fn();
		mockContextValue = createMockContext({
			showExportModal: true,
			setShowExportModal,
		});

		renderPage();
		fireEvent.click(screen.getByText("export-modal-close"));

		expect(setShowExportModal).toHaveBeenCalledWith(false);
	});

	it("triggers export modal export callback", () => {
		const handleExport = vi.fn();
		mockContextValue = createMockContext({
			showExportModal: true,
			handleExport,
		});

		renderPage();
		fireEvent.click(screen.getByText("export-modal-export"));

		expect(handleExport).toHaveBeenCalledTimes(1);
	});

	it("calls testEmail when email test button is clicked", () => {
		const testEmail = vi.fn();
		mockContextValue = createMockContext({
			testEmail,
			settings: {
				...createMockContext().settings,
				smtpHost: "smtp.example.com",
				emailEnabled: true,
				notificationEmail: "a@example.com",
			},
		});

		renderPage();
		fireEvent.click(screen.getByText("common.test"));
		expect(testEmail).toHaveBeenCalledTimes(1);
	});

	it("shows the settings load failure reason in the email section", () => {
		mockContextValue = createMockContext({
			settingsLoadError: "forbidden",
			settings: {
				...createMockContext().settings,
				smtpHost: "smtp.example.com",
			},
		});

		renderPage();

		expect(screen.getByText("settings.email.loadErrorForbidden")).toBeInTheDocument();
		expect(screen.queryByText("settings.email.serverNotConfigured")).not.toBeInTheDocument();
	});

	it("keeps the email toggle enabled when SMTP host is present", () => {
		mockContextValue = createMockContext({
			settings: {
				...createMockContext().settings,
				smtpHost: "smtp.example.com",
			},
		});

		renderPage();

		expect(screen.queryByText("settings.email.serverNotConfigured")).not.toBeInTheDocument();
		const emailHeading = screen
			.getAllByText("settings.notifications.email")
			.find((element) => element.tagName === "H3");
		expect(emailHeading).toBeDefined();
		const emailToggle = emailHeading?.parentElement?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
		expect(emailToggle).not.toBeNull();
		expect(emailToggle).not.toBeDisabled();
	});

	it("calls testShoutrrr when push test button is clicked", () => {
		const testShoutrrr = vi.fn();
		mockContextValue = createMockContext({
			testShoutrrr,
			settings: {
				...createMockContext().settings,
				shoutrrrEnabled: true,
				shoutrrrUrl: "https://ntfy.sh/topic",
			},
		});

		renderPage();
		const testButtons = screen.getAllByText("common.test");
		fireEvent.click(testButtons[testButtons.length - 1]);
		expect(testShoutrrr).toHaveBeenCalledTimes(1);
	});

	it("clears import success banner when close is clicked", () => {
		const setImportResult = vi.fn();
		mockContextValue = createMockContext({
			setImportResult,
			importResult: {
				medications: 1,
				doses: 2,
				refills: 3,
				shares: 4,
			},
		});

		renderPage();
		fireEvent.click(screen.getByRole("button", { name: "common.close" }));
		expect(setImportResult).toHaveBeenCalledWith(null);
	});

	it("includes the v1.9 as-needed result count in the import success summary", () => {
		mockContextValue = createMockContext({
			importResult: {
				medications: 1,
				doses: 2,
				asNeededIntakes: 3,
				refills: 4,
				shares: 5,
			},
		});

		renderPage();
		expect(screen.getByText("exportImport.importSuccessDetails")).toBeInTheDocument();
	});

	it("opens hidden import file input when import action is clicked", () => {
		renderPage();

		const importInput = document.getElementById("import-file-input") as HTMLInputElement;
		const clickSpy = vi.spyOn(importInput, "click");

		fireEvent.click(screen.getByText("exportImport.import"));

		expect(clickSpy).toHaveBeenCalledTimes(1);
	});

	it("cancels import confirm and clears pending import", () => {
		const setShowImportConfirm = vi.fn();
		const setPendingImportData = vi.fn();
		const setImportPreview = vi.fn();
		mockContextValue = createMockContext({
			setShowImportConfirm,
			setPendingImportData,
			setImportPreview,
			showImportConfirm: true,
			importPreview: createImportPreview(),
			meds: [{ id: 1 }],
		});

		renderPage();
		fireEvent.click(screen.getByText("exportImport.cancelButton"));
		expect(setShowImportConfirm).toHaveBeenCalledWith(false);
		expect(setPendingImportData).toHaveBeenCalledWith(null);
		expect(setImportPreview).toHaveBeenCalledWith(null);
	});

	it("renders notification matrix with toggle switches", () => {
		renderPage();
		const matrix = screen.getByTestId("settings-notification-matrix");
		expect(matrix).toBeInTheDocument();
		const toggles = within(matrix).getAllByRole("checkbox");
		expect(toggles.length).toBeGreaterThan(0);
	});

	it("renders stock thresholds with three text inputs", () => {
		renderPage();
		const thresholdGroup = [
			screen.getByTestId("settings-threshold-critical"),
			screen.getByTestId("settings-threshold-low"),
			screen.getByTestId("settings-threshold-high"),
		];
		const inputs = thresholdGroup.flatMap((group) => Array.from(group.querySelectorAll('input[type="text"]')));
		expect(inputs.length).toBe(3);
	});

	it("renders calculation mode radio options", () => {
		renderPage();
		const modeGroup = screen.getByTestId("settings-calculation-mode");
		expect(modeGroup).toBeInTheDocument();
		expect(within(modeGroup).getAllByRole("radio")).toHaveLength(2);
	});

	it("renders threshold validation message when critical/low/high order is invalid", () => {
		mockContextValue = createMockContext({
			settings: {
				...createMockContext().settings,
				reminderDaysBefore: 30,
				lowStockDays: 20,
				highStockDays: 10,
			},
		});

		renderPage();
		expect(screen.getByText("settings.stock.thresholdValidation")).toBeInTheDocument();
	});

	it("renders email and push test result messages", () => {
		mockContextValue = createMockContext({
			settings: {
				...createMockContext().settings,
				emailEnabled: true,
				notificationEmail: "a@example.com",
				smtpHost: "smtp.example.com",
				shoutrrrEnabled: true,
				shoutrrrUrl: "https://ntfy.sh/topic",
			},
			testEmailResult: { success: true, message: "email ok" },
			testShoutrrrResult: { success: false, message: "push failed" },
		});

		renderPage();
		expect(screen.getByText("email ok")).toBeInTheDocument();
		expect(screen.getByText("push failed")).toBeInTheDocument();
	});

	it("renders import confirm for existing data and handles confirm", () => {
		const handleImportConfirm = vi.fn();
		mockContextValue = createMockContext({
			handleImportConfirm,
			showImportConfirm: true,
			importPreview: createImportPreview(),
			meds: [{ id: 1 }],
		});

		renderPage();
		expect(screen.getByText("exportImport.confirmImport")).toBeInTheDocument();
		expect(screen.getByText("exportImport.reviewDescription")).toBeInTheDocument();
		expect(screen.getByText(/exportImport\.confirmImportWarning/i)).toBeInTheDocument();

		fireEvent.click(screen.getByText("exportImport.confirmButton"));
		expect(handleImportConfirm).toHaveBeenCalledTimes(1);
	});

	it("renders import confirm for empty state and handles cancel", () => {
		const setShowImportConfirm = vi.fn();
		const setPendingImportData = vi.fn();
		const setImportPreview = vi.fn();
		mockContextValue = createMockContext({
			setShowImportConfirm,
			setPendingImportData,
			setImportPreview,
			showImportConfirm: true,
			importPreview: createImportPreview({
				current: {
					medications: 0,
					doseHistory: 0,
					refillHistory: 0,
					shareLinks: 0,
					hasSettings: false,
				},
				warnings: {
					replacesExistingData: false,
					regeneratesShareLinks: false,
					containsImages: false,
					containsSensitiveData: false,
				},
			}),
			meds: [],
		});

		renderPage();
		expect(screen.getByText("exportImport.confirmImportEmpty")).toBeInTheDocument();
		expect(screen.getByText("exportImport.reviewDescriptionEmpty")).toBeInTheDocument();
		expect(screen.getByText("exportImport.confirmImportEmptyMessage")).toBeInTheDocument();

		fireEvent.click(screen.getByText("exportImport.cancelButton"));
		expect(setShowImportConfirm).toHaveBeenCalledWith(false);
		expect(setPendingImportData).toHaveBeenCalledWith(null);
		expect(setImportPreview).toHaveBeenCalledWith(null);
	});

	it("offers backup-first from the import review modal", () => {
		const handleExport = vi.fn();
		mockContextValue = createMockContext({
			handleExport,
			showImportConfirm: true,
			importPreview: createImportPreview(),
			meds: [{ id: 1 }],
		});

		renderPage();
		fireEvent.click(screen.getByText("exportImport.backupFirst"));
		expect(handleExport).toHaveBeenCalledWith(true, false);
	});
});
