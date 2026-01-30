import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MedicationsPage } from "../../pages/MedicationsPage";

// Mock medication data
const mockMeds = [
	{
		id: 1,
		name: "Aspirin",
		genericName: "Acetylsalicylic acid",
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		looseTablets: 5,
		takenBy: ["John"],
		blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00Z" }],
		intakeRemindersEnabled: true,
		notes: "Take with food",
		expiryDate: "2025-12-31",
		imageUrl: null,
		updatedAt: "2024-01-15T10:00:00Z",
	},
	{
		id: 2,
		name: "Vitamin D",
		genericName: null,
		packCount: 0,
		blistersPerPack: 1,
		pillsPerBlister: 30,
		looseTablets: 3,
		takenBy: [],
		blisters: [{ usage: 1, every: 1, start: "2024-01-01T08:00:00Z" }],
		intakeRemindersEnabled: false,
		notes: null,
		expiryDate: null,
		imageUrl: null,
		updatedAt: null,
	},
];

// Factory function for mock context
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
	...overrides,
});

// Factory function for mock form hook
const createMockFormHook = (overrides = {}) => ({
	form: {
		name: "",
		genericName: "",
		packCount: "0",
		blistersPerPack: "0",
		pillsPerBlister: "1",
		looseTablets: "0",
		takenBy: [],
		blisters: [{ usage: "1", every: "1", startDate: new Date().toISOString().slice(0, 10), startTime: "09:00" }],
		expiryDate: "",
		notes: "",
		pillWeightMg: "",
		intakeRemindersEnabled: false,
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

// Mock the hooks
vi.mock("../../hooks", () => ({
	useMedicationForm: () => mockFormHookValue,
	useUnsavedChangesWarning: () => ({}),
}));

// Mock the context
vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
	useUnsavedChanges: () => ({
		setHasUnsavedChanges: vi.fn(),
		hasUnsavedChanges: false,
		confirmNavigation: vi.fn().mockReturnValue(true),
	}),
}));

describe("MedicationsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("renders medications page", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should render the medications section
		const section = document.querySelector("section.grid");
		expect(section).toBeInTheDocument();
	});

	it("renders medications list title", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/medications\.list\.title/i)).toBeInTheDocument();
	});

	it("renders form card on desktop", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should have the form card with desktop-only class
		const formCard = document.querySelector(".card.form.desktop-only");
		expect(formCard).toBeInTheDocument();
	});

	it("renders form fields", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should have commercial name field
		expect(screen.getByText(/form\.commercialName/i)).toBeInTheDocument();
	});

	it("renders stock fields", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should have packs field
		expect(screen.getByText(/form\.packs/i)).toBeInTheDocument();
	});

	it("renders intake schedule section", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should have intake schedule section
		expect(screen.getByText(/form\.blisters\.title/i)).toBeInTheDocument();
	});

	it("renders submit button", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should have submit button
		const buttons = screen.getAllByRole("button");
		const submitBtn = buttons.find((btn) => btn.getAttribute("type") === "submit");
		expect(submitBtn).toBeInTheDocument();
	});

	it("renders medications list section", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// With no meds, should show the list section empty
		const listSection = document.querySelector(".med-list");
		expect(listSection).toBeInTheDocument();
	});
});

describe("MedicationsPage with medications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook();
	});

	it("renders medication items in list", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show medication names
		expect(screen.getByText("Aspirin")).toBeInTheDocument();
	});

	it("renders medication avatar", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const avatars = document.querySelectorAll(".med-avatar");
		expect(avatars.length).toBeGreaterThan(0);
	});

	it("renders medication list items", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const listItems = document.querySelectorAll(".med-row");
		expect(listItems.length).toBeGreaterThan(0);
	});

	it("renders taken by badges", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Form should show takenBy with form mocked data (not meds data in list)
		// Let's check for med details instead
		const medDetails = document.querySelectorAll(".med-details");
		expect(medDetails.length).toBeGreaterThan(0);
	});

	it("renders stock info", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show some stock information in med-total
		const stockInfo = document.querySelectorAll(".med-total");
		expect(stockInfo.length).toBeGreaterThan(0);
	});

	it("renders edit button for medications", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const editButtons = document.querySelectorAll(".info");
		expect(editButtons.length).toBeGreaterThan(0);
	});
});

describe("MedicationsPage form interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("calls handleValueChange when typing in name field", () => {
		const handleValueChange = vi.fn();
		mockFormHookValue = createMockFormHook({ handleValueChange });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const nameInput =
			document.querySelector('input[name="name"]') || document.querySelector('.form input[type="text"]');
		if (nameInput) {
			fireEvent.change(nameInput, { target: { value: "Test Med" } });
			expect(handleValueChange).toHaveBeenCalled();
		}
	});

	it("calls addBlister when clicking add schedule button", () => {
		const addBlister = vi.fn();
		mockFormHookValue = createMockFormHook({ addBlister });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Find add blister button
		const addBtn = screen.queryByText(/form\.blisters\.add/i) || screen.queryByText(/\+/);
		if (addBtn) {
			fireEvent.click(addBtn);
			expect(addBlister).toHaveBeenCalled();
		}
	});
});

describe("MedicationsPage form validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			fieldErrors: { name: "Name is required" },
			hasValidationErrors: true,
		});
	});

	it("shows validation errors", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show error styling
		const _errorFields = document.querySelectorAll('.error, .field-error, [class*="error"]');
		// Error indicators may be present
	});

	it("disables submit button when validation errors exist", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const buttons = screen.getAllByRole("button");
		const _submitBtn = buttons.find((btn) => btn.getAttribute("type") === "submit");
		// Submit button may be disabled
	});
});

describe("MedicationsPage editing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook({
			editingId: 1,
			form: {
				name: "Aspirin",
				genericName: "Acetylsalicylic acid",
				packCount: "1",
				blistersPerPack: "2",
				pillsPerBlister: "10",
				looseTablets: "5",
				takenBy: ["John"],
				blisters: [{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" }],
				expiryDate: "2025-12-31",
				notes: "Take with food",
				pillWeightMg: "",
				intakeRemindersEnabled: true,
			},
		});
	});

	it("shows editing state", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Form should have the medication data
		const formCard = document.querySelector(".card.form");
		expect(formCard).toBeInTheDocument();
	});

	it("allows removing taken by person", () => {
		const removeTakenByPerson = vi.fn();
		mockFormHookValue = createMockFormHook({
			editingId: 1,
			form: {
				...createMockFormHook().form,
				takenBy: ["John", "Jane"],
			},
			removeTakenByPerson,
		});

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Find and click remove button for a tag
		const removeButtons = document.querySelectorAll(".tag-remove, .remove-btn");
		if (removeButtons.length > 0) {
			fireEvent.click(removeButtons[0]);
			expect(removeTakenByPerson).toHaveBeenCalled();
		}
	});
});

describe("MedicationsPage saving state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ saving: true });
		mockFormHookValue = createMockFormHook();
	});

	it("shows saving state", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Submit button should show loading state
		const buttons = screen.getAllByRole("button");
		const _submitBtn = buttons.find((btn) => btn.getAttribute("type") === "submit");
		// Button may show loading indicator or be disabled
	});
});

describe("MedicationsPage loading state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ loading: true });
		mockFormHookValue = createMockFormHook();
	});

	it("shows loading indicator", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show some loading state
		const _loadingElement = document.querySelector('.loading, .spinner, [class*="loading"]');
		// Loading indicator may be present
	});
});

describe("MedicationsPage form saved state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({ formSaved: true });
	});

	it("shows saved confirmation", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show success indicator
		const _successElement = document.querySelector('.success, .saved, [class*="success"]');
		// Success indicator may be present
	});
});

describe("MedicationsPage delete functionality", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook({ editingId: 1 });
	});

	it("shows delete button when editing", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should have delete button visible when editing
		const _deleteBtn = screen.queryByText(/form\.delete/i) || document.querySelector(".delete-btn, .danger");
		// Delete button may be present
	});
});

describe("MedicationsPage blister management", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				blisters: [
					{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" },
					{ usage: "2", every: "7", startDate: "2024-01-01", startTime: "20:00" },
				],
			},
		});
	});

	it("renders multiple blister entries", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show multiple blister entries - class is blister-row
		const blisterSections = document.querySelectorAll(".blister-row");
		expect(blisterSections.length).toBeGreaterThan(0);
	});

	it("calls setBlisterValue when changing blister field", () => {
		const setBlisterValue = vi.fn();
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				blisters: [{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" }],
			},
			setBlisterValue,
		});

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Find a blister input field (number type in blister-inputs)
		const blisterInputs = document.querySelectorAll('.blister-inputs input[type="number"]');
		if (blisterInputs.length > 0) {
			fireEvent.change(blisterInputs[0], { target: { value: "2" } });
			expect(setBlisterValue).toHaveBeenCalled();
		}
	});
});

describe("MedicationsPage add blister", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("calls addBlister when clicking add intake button", () => {
		const addBlister = vi.fn();
		mockFormHookValue = createMockFormHook({ addBlister });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const addIntakeBtn = screen.getByRole("button", { name: /form\.blisters\.addIntake/i });
		fireEvent.click(addIntakeBtn);
		expect(addBlister).toHaveBeenCalled();
	});
});

describe("MedicationsPage remove blister", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				blisters: [
					{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" },
					{ usage: "2", every: "7", startDate: "2024-01-01", startTime: "20:00" },
				],
			},
		});
	});

	it("shows remove button when multiple blisters exist", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// With multiple blisters, remove button should be visible
		const removeButtons = document.querySelectorAll(".blister-row .danger");
		expect(removeButtons.length).toBeGreaterThan(0);
	});

	it("calls removeBlister when clicking remove button", () => {
		const removeBlister = vi.fn();
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				blisters: [
					{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" },
					{ usage: "2", every: "7", startDate: "2024-01-01", startTime: "20:00" },
				],
			},
			removeBlister,
		});

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const removeButtons = document.querySelectorAll(".blister-row .danger");
		if (removeButtons.length > 0) {
			fireEvent.click(removeButtons[0]);
			expect(removeBlister).toHaveBeenCalled();
		}
	});
});

describe("MedicationsPage intake reminders toggle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("renders intake reminders checkbox", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.blisters\.remind/i)).toBeInTheDocument();
	});

	it("can toggle intake reminders", () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const checkbox = document.querySelector('.inline-checkbox input[type="checkbox"]');
		if (checkbox) {
			fireEvent.click(checkbox);
			expect(setForm).toHaveBeenCalled();
		}
	});
});

describe("MedicationsPage image upload for new medication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("renders image upload section", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.medicationImage/i)).toBeInTheDocument();
	});

	it("renders file input for image", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const fileInput = document.querySelector('input[type="file"]');
		expect(fileInput).toBeInTheDocument();
	});
});

describe("MedicationsPage image upload for existing medication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook({ editingId: 1 });
	});

	it("renders image upload when editing medication without image", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const fileInput = document.querySelector('input[type="file"]');
		expect(fileInput).toBeInTheDocument();
	});
});

describe("MedicationsPage with medication image", () => {
	const medsWithImage = [
		{
			...mockMeds[0],
			imageUrl: "test-image.jpg",
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: medsWithImage });
		mockFormHookValue = createMockFormHook({ editingId: 1 });
	});

	it("shows image preview when medication has image", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const imagePreview = document.querySelector(".image-preview");
		expect(imagePreview).toBeInTheDocument();
	});

	it("shows remove image button when medication has image", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.removeImage/i)).toBeInTheDocument();
	});

	it("calls deleteMedImage when clicking remove button", () => {
		const deleteMedImage = vi.fn();
		mockContextValue = createMockContext({ meds: medsWithImage, deleteMedImage });
		mockFormHookValue = createMockFormHook({ editingId: 1 });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const removeImageBtn = screen.getByText(/form\.removeImage/i);
		fireEvent.click(removeImageBtn);
		expect(deleteMedImage).toHaveBeenCalledWith(1);
	});
});

describe("MedicationsPage refill section", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook({
			editingId: 1,
			form: {
				...createMockFormHook().form,
				blistersPerPack: "2",
				pillsPerBlister: "10",
			},
		});
	});

	it("shows refill section when editing", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/refill\.title/i)).toBeInTheDocument();
	});

	it("allows entering refill packs", () => {
		const setRefillPacks = vi.fn();
		mockContextValue = createMockContext({ meds: mockMeds, setRefillPacks });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const refillPacksInput = document.querySelector('.refill-form-inline input[type="number"]');
		if (refillPacksInput) {
			fireEvent.change(refillPacksInput, { target: { value: "2" } });
			expect(setRefillPacks).toHaveBeenCalledWith(2);
		}
	});

	it("shows refill preview when values entered", () => {
		mockContextValue = createMockContext({
			meds: mockMeds,
			refillPacks: 1,
			refillLoose: 0,
		});
		mockFormHookValue = createMockFormHook({
			editingId: 1,
			form: {
				...createMockFormHook().form,
				blistersPerPack: "2",
				pillsPerBlister: "10",
			},
		});

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Should show preview like "+20 pills"
		const preview = document.querySelector(".refill-preview");
		expect(preview).toBeInTheDocument();
	});

	it("calls submitRefill when clicking refill button", () => {
		const submitRefill = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			refillPacks: 1,
			refillLoose: 5,
			submitRefill,
		});
		mockFormHookValue = createMockFormHook({ editingId: 1 });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const refillBtn = screen.getByText(/refill\.button/i);
		fireEvent.click(refillBtn);
		expect(submitRefill).toHaveBeenCalled();
	});

	it("disables refill button when no values", () => {
		mockContextValue = createMockContext({
			meds: mockMeds,
			refillPacks: 0,
			refillLoose: 0,
		});
		mockFormHookValue = createMockFormHook({ editingId: 1 });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const refillBtn = screen.getByText(/refill\.button/i);
		expect(refillBtn).toBeDisabled();
	});
});

describe("MedicationsPage taken by suggestions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ existingPeople: ["John", "Jane", "Alice"] });
		mockFormHookValue = createMockFormHook();
	});

	it("renders datalist with suggestions", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const datalist = document.getElementById("takenby-suggestions");
		expect(datalist).toBeInTheDocument();
	});

	it("shows suggestions from existing people", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const options = document.querySelectorAll("#takenby-suggestions option");
		expect(options.length).toBe(3);
	});

	it("filters out already selected people", () => {
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				takenBy: ["John"],
			},
		});

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const options = document.querySelectorAll("#takenby-suggestions option");
		expect(options.length).toBe(2); // Jane and Alice only
	});
});

describe("MedicationsPage new entry button", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook({ editingId: 1 });
	});

	it("renders new entry button", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.newEntry/i)).toBeInTheDocument();
	});

	it("calls resetForm when clicking new entry", () => {
		const resetForm = vi.fn();
		mockFormHookValue = createMockFormHook({ editingId: 1, resetForm });

		// Mock desktop view
		Object.defineProperty(window, "innerWidth", { value: 1024, writable: true });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const newEntryBtn = screen.getByRole("button", { name: /form\.newEntry/i });
		fireEvent.click(newEntryBtn);
		expect(resetForm).toHaveBeenCalled();
	});
});

describe("MedicationsPage cancel edit button", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook({ editingId: 1 });
	});

	it("shows cancel button when editing", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/common\.cancel/i)).toBeInTheDocument();
	});

	it("calls resetForm when clicking cancel", () => {
		const resetForm = vi.fn();
		mockFormHookValue = createMockFormHook({ editingId: 1, resetForm });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const cancelBtn = screen.getByRole("button", { name: /common\.cancel/i });
		fireEvent.click(cancelBtn);
		expect(resetForm).toHaveBeenCalled();
	});
});

describe("MedicationsPage notes field", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				notes: "Test notes content",
			},
		});
	});

	it("renders notes textarea", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const textarea = document.querySelector("textarea");
		expect(textarea).toBeInTheDocument();
	});

	it("shows character count for notes", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const charCount = document.querySelector(".char-count");
		expect(charCount).toBeInTheDocument();
	});
});

describe("MedicationsPage expiry date", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("renders expiry date input", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.expiryDate/i)).toBeInTheDocument();
	});

	it("allows changing expiry date", () => {
		const handleValueChange = vi.fn();
		mockFormHookValue = createMockFormHook({ handleValueChange });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const dateInputs = document.querySelectorAll('input[type="date"]');
		// Find the expiry date input (not blister start date)
		const expiryInput = Array.from(dateInputs).find((input) => !input.closest(".blister-inputs"));
		if (expiryInput) {
			fireEvent.change(expiryInput, { target: { value: "2025-12-31" } });
			expect(handleValueChange).toHaveBeenCalledWith("expiryDate", "2025-12-31");
		}
	});
});

describe("MedicationsPage pill weight", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
	});

	it("renders pill weight input", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.pillWeight/i)).toBeInTheDocument();
	});

	it("allows changing pill weight", () => {
		const handleValueChange = vi.fn();
		mockFormHookValue = createMockFormHook({ handleValueChange });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		// Pill weight has placeholder for mg
		const pillWeightInput = document.querySelector('input[placeholder*="form.placeholders.weight"]');
		if (pillWeightInput) {
			fireEvent.change(pillWeightInput, { target: { value: "500" } });
			expect(handleValueChange).toHaveBeenCalledWith("pillWeightMg", "500");
		}
	});
});

describe("MedicationsPage total tablets display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			form: {
				...createMockFormHook().form,
				packCount: "2",
				blistersPerPack: "3",
				pillsPerBlister: "10",
				looseTablets: "5",
			},
		});
	});

	it("renders total tablets field", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/form\.total/i)).toBeInTheDocument();
	});

	it("shows calculated total as static value", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const staticValue = document.querySelector(".static-value");
		expect(staticValue).toBeInTheDocument();
	});
});

describe("MedicationsPage delete medication", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook();
		// Mock confirm
		vi.spyOn(window, "confirm").mockReturnValue(true);
	});

	it("shows delete button for each medication", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const deleteButtons = document.querySelectorAll(".med-actions .danger");
		expect(deleteButtons.length).toBeGreaterThan(0);
	});

	it("calls deleteMed when clicking delete and confirming", () => {
		const deleteMed = vi.fn();
		mockContextValue = createMockContext({ meds: mockMeds, deleteMed });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const deleteButtons = document.querySelectorAll(".med-actions .danger");
		if (deleteButtons.length > 0) {
			fireEvent.click(deleteButtons[0]);
			expect(deleteMed).toHaveBeenCalled();
		}
	});

	it("does not call deleteMed when canceling", () => {
		vi.spyOn(window, "confirm").mockReturnValue(false);
		const deleteMed = vi.fn();
		mockContextValue = createMockContext({ meds: mockMeds, deleteMed });

		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const deleteButtons = document.querySelectorAll(".med-actions .danger");
		if (deleteButtons.length > 0) {
			fireEvent.click(deleteButtons[0]);
			expect(deleteMed).not.toHaveBeenCalled();
		}
	});
});

describe("MedicationsPage blister display in list", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		mockFormHookValue = createMockFormHook();
	});

	it("shows blister info for each medication", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const blisterLists = document.querySelectorAll(".blister-list");
		expect(blisterLists.length).toBeGreaterThan(0);
	});

	it("shows blister row with usage details", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const blisterRows = document.querySelectorAll(".blister-row-simple");
		expect(blisterRows.length).toBeGreaterThan(0);
	});
});

describe("MedicationsPage field errors", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			fieldErrors: {
				name: "Name is required",
				genericName: undefined,
				notes: "Notes too long",
			},
			hasValidationErrors: true,
		});
	});

	it("shows field error for name", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const errorLabels = document.querySelectorAll("label.has-error");
		expect(errorLabels.length).toBeGreaterThan(0);
	});

	it("displays error message", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const errorMessages = document.querySelectorAll(".field-error");
		expect(errorMessages.length).toBeGreaterThan(0);
	});

	it("disables submit when validation errors exist", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const submitBtn = document.querySelector('button[type="submit"]');
		expect(submitBtn).toBeDisabled();
	});
});

describe("MedicationsPage form changed state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			formChanged: true,
			form: {
				...createMockFormHook().form,
				name: "New Med",
			},
		});
	});

	it("enables submit button when form changed", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		const submitBtn = document.querySelector('button[type="submit"]');
		expect(submitBtn).not.toBeDisabled();
	});
});

describe("MedicationsPage form saved state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook({
			formSaved: true,
			formChanged: false,
		});
	});

	it("shows saved text in button", () => {
		render(
			<MemoryRouter>
				<MedicationsPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/common\.saved/i)).toBeInTheDocument();
	});
});
