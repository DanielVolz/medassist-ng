import { fireEvent, render, screen } from "@testing-library/react";
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

vi.mock("../../hooks", () => ({
	useMedicationForm: () => mockFormHookValue,
	useUnsavedChangesWarning: () => ({}),
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

function renderPage() {
	render(
		<MemoryRouter>
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

	it("shows submit button in form mode", () => {
		renderPage();
		openNewMedicationForm();
		const submit = document.querySelector('button[type="submit"]');
		expect(submit).toBeInTheDocument();
	});
});

describe("MedicationsPage with items", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		renderPage();
		const editButton = document.querySelector(".med-actions .info") as HTMLButtonElement | null;
		expect(editButton).toBeInTheDocument();
		fireEvent.click(editButton as HTMLButtonElement);
		expect(startEdit).toHaveBeenCalledTimes(1);
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
});
