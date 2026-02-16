import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../../pages/SettingsPage";

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
		stockCalculationMode: "automatic",
		shareStockStatus: true,
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
	settingsLoading: false,
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
	handleImportConfirm: vi.fn(),
	importResult: null,
	setImportResult: vi.fn(),
	meds: [],
	...overrides,
});

let mockContextValue = createMockContext();

vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
}));

function renderPage() {
	render(
		<MemoryRouter>
			<SettingsPage />
		</MemoryRouter>
	);
}

describe("SettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContextValue = createMockContext();
	});

	it("renders settings form container", () => {
		renderPage();
		expect(document.querySelector(".settings-form")).toBeInTheDocument();
	});

	it("renders major sections", () => {
		renderPage();
		expect(screen.getByText(/settings\.language\.title/i)).toBeInTheDocument();
		expect(screen.getByText(/settings\.notifications\.title/i)).toBeInTheDocument();
		expect(screen.getByText(/settings\.stock\.title/i)).toBeInTheDocument();
		expect(screen.getByText(/exportImport\.title/i)).toBeInTheDocument();
	});

	it("renders language select and switches language", () => {
		renderPage();
		const select = document.querySelector(".language-select") as HTMLSelectElement | null;
		expect(select).toBeInTheDocument();
		fireEvent.change(select as HTMLSelectElement, { target: { value: "de" } });
		expect(changeLanguageMock).toHaveBeenCalledWith("de");
	});

	it("renders notification matrix with toggle switches", () => {
		renderPage();
		expect(document.querySelector(".notification-matrix")).toBeInTheDocument();
		const toggles = document.querySelectorAll(".toggle-switch");
		expect(toggles.length).toBeGreaterThan(0);
	});

	it("renders stock thresholds with three text inputs", () => {
		renderPage();
		const thresholdGroup = document.querySelector(".threshold-chips-group");
		expect(thresholdGroup).toBeInTheDocument();
		const inputs = thresholdGroup?.querySelectorAll('input[type="text"]') ?? [];
		expect(inputs.length).toBe(3);
	});

	it("renders calculation mode radio cards", () => {
		renderPage();
		const modeGroup = document.querySelector(".calculation-mode-group");
		expect(modeGroup).toBeInTheDocument();
		expect(modeGroup?.querySelectorAll(".radio-card").length).toBe(2);
	});
});
