import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MedicationsPage } from "../../pages/MedicationsPage";

const mockMeds = [
	{
		id: 1,
		name: "Aspirin",
		genericName: "Acetylsalicylic acid",
		packageType: "blister" as const,
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		looseTablets: 5,
		takenBy: ["John"],
		intakes: [
			{
				usage: 1,
				every: 1,
				start: "2024-01-01T09:00:00Z",
				takenBy: "",
				intakeRemindersEnabled: false,
			},
		],
		blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00Z" }],
		intakeRemindersEnabled: true,
		notes: "Take with food",
		expiryDate: "2025-12-31",
		imageUrl: null,
		updatedAt: "2024-01-15T10:00:00Z",
	},
];

const createMockContext = (overrides = {}) => ({
	meds: [],
	loading: false,
	saving: false,
	setSaving: vi.fn(),
	loadMeds: vi.fn(),
	deleteMed: vi.fn(),
	uploadMedImage: vi.fn(),
	deleteMedImage: vi.fn(),
	uploadingImage: false,
	existingPeople: [],
	refillPacks: "",
	setRefillPacks: vi.fn(),
	refillLoose: "",
	setRefillLoose: vi.fn(),
	refillSaving: false,
	submitRefill: vi.fn(),
	coverageByMed: {},
	...overrides,
});

const createMockFormHook = (overrides = {}) => ({
	form: {
		name: "",
		genericName: "",
		packageType: "blister" as const,
		packCount: "0",
		blistersPerPack: "0",
		pillsPerBlister: "1",
		looseTablets: "0",
		totalPills: "",
		takenBy: [],
		intakes: [
			{
				usage: "1",
				every: "1",
				startDate: "2024-01-01",
				startTime: "09:00",
				takenBy: "",
				intakeRemindersEnabled: false,
			},
		],
		expiryDate: "",
		notes: "",
		pillWeightMg: "",
		intakeRemindersEnabled: false,
		prescriptionEnabled: false,
		prescriptionAuthorizedRefills: "",
		prescriptionRemainingRefills: "",
		prescriptionLowRefillThreshold: "1",
		prescriptionExpiryDate: "",
		medicationStartDate: "",
		doseUnit: "mg" as const,
	},
	setForm: vi.fn(),
	editingId: null,
	setEditingId: vi.fn(),
	formSaved: false,
	setFormSaved: vi.fn(),
	formChanged: false,
	fieldErrors: {},
	hasValidationErrors: false,
	takenByInput: "",
	setTakenByInput: vi.fn(),
	addTakenByPerson: vi.fn(),
	removeTakenByPerson: vi.fn(),
	handleTakenByKeyDown: vi.fn(),
	handleValueChange: vi.fn(),
	addBlister: vi.fn(),
	removeBlister: vi.fn(),
	setBlisterValue: vi.fn(),
	addIntake: vi.fn(),
	removeIntake: vi.fn(),
	setIntakeValue: vi.fn(),
	resetForm: vi.fn(),
	startEdit: vi.fn(),
	showEditModal: false,
	setShowEditModal: vi.fn(),
	pendingImage: null,
	setPendingImage: vi.fn(),
	pendingImagePreview: null,
	setPendingImagePreview: vi.fn(),
	...overrides,
});

let mockContextValue = createMockContext();
let mockFormHookValue = createMockFormHook();
const fetchMock = vi.fn();

vi.mock("../../hooks", () => ({
	useMedicationForm: () => mockFormHookValue,
	useUnsavedChangesWarning: () => ({}),
	useModalHistory: vi.fn(),
}));

vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
	useUnsavedChanges: () => ({
		setHasUnsavedChanges: vi.fn(),
		hasUnsavedChanges: false,
		confirmNavigation: vi.fn().mockReturnValue(true),
	}),
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({ user: { id: 1, username: "testuser" }, isAuthenticated: true }),
}));

vi.mock("../../components", async () => {
	const actual = await vi.importActual<typeof import("../../components")>("../../components");
	return {
		...actual,
		MedicationAvatar: ({ name }: { name: string }) => <span data-testid={`avatar-${name}`}></span>,
		DateInput: ({ value, onChange }: { value: string; onChange: (e: { target: { value: string } }) => void }) => (
			<input value={value} onChange={onChange} />
		),
		Lightbox: () => null,
		ConfirmModal: ({
			title,
			message,
			confirmLabel,
			cancelLabel,
			onConfirm,
			onCancel,
		}: {
			title: string;
			message: string;
			confirmLabel: string;
			cancelLabel: string;
			onConfirm: () => void;
			onCancel: () => void;
		}) => (
			<div data-testid="confirm-modal">
				<h3>{title}</h3>
				<p>{message}</p>
				<button type="button" onClick={onConfirm}>
					{confirmLabel}
				</button>
				<button type="button" onClick={onCancel}>
					{cancelLabel}
				</button>
			</div>
		),
		MobileEditModal: () => null,
		ReportModal: ({ isOpen }: { isOpen: boolean }) =>
			isOpen ? <div data-testid="report-modal-open">Report Modal</div> : null,
	};
});

function renderPage(initialEntry = "/medications") {
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<MedicationsPage />
		</MemoryRouter>
	);
}

function openNewMedicationForm() {
	const newButton = document.querySelector(".card-head .btn.primary") as HTMLButtonElement | null;
	expect(newButton).toBeInTheDocument();
	fireEvent.click(newButton as HTMLButtonElement);
}

describe("MedicationsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
		Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
		fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
		vi.stubGlobal("fetch", fetchMock);
	});

	it("renders list-first view with new button", () => {
		renderPage();
		expect(screen.getByText(/medications\.list\.title/i)).toBeInTheDocument();
		// Button text and form heading both contain "form.newEntry" in the DOM
		expect(screen.getAllByText(/form\.newEntry/i).length).toBeGreaterThanOrEqual(1);
	});

	it("opens form after clicking new button", () => {
		renderPage();
		openNewMedicationForm();
		expect(screen.getByText(/form\.commercialName/i)).toBeInTheDocument();
		expect(screen.getByText(/form\.genericName/i)).toBeInTheDocument();
	});

	it("renders medication start and end dates as one desktop date pair group", () => {
		renderPage();
		openNewMedicationForm();

		const datePairGroup = document.querySelector(".date-pair-group");
		expect(datePairGroup).toBeInTheDocument();

		const dateFields = Array.from(datePairGroup?.querySelectorAll(".date-pair-field") ?? []);
		expect(dateFields).toHaveLength(2);
		expect(dateFields[0]).toHaveTextContent("form.medicationStartDate");
		expect(dateFields[1]).toHaveTextContent("form.medicationEndDate");
	});

	it("shows submit button in form mode", () => {
		renderPage();
		openNewMedicationForm();
		const submit = document.querySelector('button[type="submit"]');
		expect(submit).toBeInTheDocument();
	});

	it("switches desktop form tabs", () => {
		renderPage();
		openNewMedicationForm();

		const stockTab = screen.getByRole("tab", { name: "form.sections.stock" });
		const scheduleTab = screen.getByRole("tab", { name: "form.sections.schedule" });

		fireEvent.click(stockTab);
		expect(stockTab).toHaveAttribute("aria-selected", "true");

		fireEvent.click(scheduleTab);
		expect(scheduleTab).toHaveAttribute("aria-selected", "true");
	});

	it("opens report modal from list actions", () => {
		renderPage();
		fireEvent.click(screen.getByText("report.button"));
		expect(screen.getByTestId("report-modal-open")).toBeInTheDocument();
	});
});

describe("MedicationsPage with items", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook();
	});

	it("renders medication rows", () => {
		renderPage();
		expect(screen.getByText("Aspirin")).toBeInTheDocument();
		const rows = document.querySelectorAll(".med-row");
		expect(rows.length).toBeGreaterThan(0);
	});

	it("calls startEdit from list action", () => {
		const startEdit = vi.fn();
		mockFormHookValue = createMockFormHook({ startEdit });
		fetchMock.mockResolvedValue({ ok: true, json: async () => mockMeds });
		renderPage();
		const editButton = document.querySelector(".med-actions .info") as HTMLButtonElement | null;
		expect(editButton).toBeInTheDocument();
		fireEvent.click(editButton as HTMLButtonElement);
		expect(startEdit).toHaveBeenCalledTimes(1);
	});

	it("opens edit flow from editMedId query parameter", async () => {
		const startEdit = vi.fn();
		mockFormHookValue = createMockFormHook({ startEdit });
		fetchMock.mockResolvedValue({ ok: true, json: async () => mockMeds });

		renderPage("/medications?editMedId=1");

		await waitFor(() => {
			expect(startEdit).toHaveBeenCalledTimes(1);
		});
	});

	it("opens unsaved confirm and continues edit after confirmation", async () => {
		const startEdit = vi.fn();
		const resetForm = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			coverageByMed: {
				Aspirin: { medsLeft: 12.4 },
			},
		});
		mockFormHookValue = createMockFormHook({
			formChanged: true,
			startEdit,
			resetForm,
		});

		renderPage();
		const editButton = document.querySelector(".med-actions .info") as HTMLButtonElement;
		fireEvent.click(editButton);

		expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();
		fireEvent.click(screen.getByText("common.unsavedChanges.leave"));

		await waitFor(() => {
			expect(resetForm).toHaveBeenCalledTimes(1);
			expect(startEdit).toHaveBeenCalledTimes(1);
		});
	});

	it("marks medication obsolete after confirmation", async () => {
		mockContextValue = createMockContext({ meds: mockMeds });
		fetchMock.mockImplementation((url: string) => {
			if (url === "/api/medications/1/obsolete") {
				return Promise.resolve({ ok: true, json: async () => ({}) });
			}
			if (url === "/api/medications?includeObsolete=true") {
				return Promise.resolve({ ok: true, json: async () => mockMeds });
			}
			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		fireEvent.click(screen.getByText("medications.list.markObsolete"));
		expect(screen.getByTestId("confirm-modal")).toBeInTheDocument();

		const confirmButtons = screen.getAllByText("medications.list.markObsolete");
		fireEvent.click(confirmButtons[confirmButtons.length - 1]);

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith("/api/medications/1/obsolete", {
				method: "POST",
				credentials: "include",
			});
		});
	});

	it("reactivates obsolete medication from obsolete section", async () => {
		const obsoleteMed = { ...mockMeds[0], id: 2, isObsolete: true, obsoleteAt: "2025-01-01T00:00:00Z" };
		mockContextValue = createMockContext({ meds: [obsoleteMed] });
		fetchMock.mockImplementation((url: string) => {
			if (url === "/api/medications/2/reactivate") {
				return Promise.resolve({ ok: true, json: async () => ({}) });
			}
			if (url === "/api/medications?includeObsolete=true") {
				return Promise.resolve({ ok: true, json: async () => [obsoleteMed] });
			}
			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		fireEvent.click(screen.getByText("medications.list.reactivate"));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledWith("/api/medications/2/reactivate", {
				method: "POST",
				credentials: "include",
			});
		});
	});

	it("toggles obsolete section visibility and persists state", async () => {
		const obsoleteMed = { ...mockMeds[0], id: 2, isObsolete: true, obsoleteAt: "2025-01-01T00:00:00Z" };
		mockContextValue = createMockContext({ meds: [obsoleteMed] });

		renderPage();
		expect(screen.getByText("medications.list.reactivate")).toBeInTheDocument();

		const obsoleteToggleButton = document.querySelector(".med-group-head-toggle") as HTMLButtonElement;
		expect(obsoleteToggleButton).toBeInTheDocument();
		fireEvent.click(obsoleteToggleButton);

		await waitFor(() => {
			expect(screen.queryByText("medications.list.reactivate")).not.toBeInTheDocument();
		});

		fireEvent.click(obsoleteToggleButton);
		expect(screen.getByText("medications.list.reactivate")).toBeInTheDocument();
	});
});

describe("MedicationsPage form interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("calls handleValueChange when typing name", () => {
		const handleValueChange = vi.fn();
		mockFormHookValue = createMockFormHook({ handleValueChange });
		renderPage();
		openNewMedicationForm();
		const nameInput =
			(document.querySelector('input[name="name"]') as HTMLInputElement | null) ??
			(document.querySelector(".card.form input[type='text']") as HTMLInputElement | null);
		expect(nameInput).toBeInTheDocument();
		fireEvent.change(nameInput as HTMLInputElement, { target: { value: "Test Med" } });
		expect(handleValueChange).toHaveBeenCalled();
	});

	it("opens mobile edit flow when creating new entry on mobile viewport", () => {
		const resetForm = vi.fn();
		mockFormHookValue = createMockFormHook({
			resetForm,
		});
		Object.defineProperty(window, "innerWidth", { value: 375, writable: true });
		const pushStateSpy = vi.spyOn(window.history, "pushState");

		renderPage();
		openNewMedicationForm();

		expect(resetForm).toHaveBeenCalledTimes(1);
		expect(pushStateSpy).toHaveBeenCalledWith({ modal: "edit" }, "");
	});
});
