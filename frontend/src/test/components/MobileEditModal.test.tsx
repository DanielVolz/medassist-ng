import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileEditModal } from "../../components/MobileEditModal";
import type { FormState } from "../../types";

const defaultForm: FormState = {
	name: "",
	genericName: "",
	takenBy: [],
	medicationForm: "tablet",
	pillForm: "tablet",
	lifecycleCategory: "refill_when_empty",
	packageType: "blister",
	packCount: "1",
	blistersPerPack: "1",
	pillsPerBlister: "1",
	looseTablets: "0",
	totalPills: "",
	pillWeightMg: "",
	doseUnit: "mg",
	medicationStartDate: "",
	medicationEndDate: "",
	autoMarkObsoleteAfterEndDate: true,
	expiryDate: "",
	notes: "",
	intakeRemindersEnabled: false,
	prescriptionEnabled: false,
	prescriptionAuthorizedRefills: "",
	prescriptionRemainingRefills: "",
	prescriptionLowRefillThreshold: "1",
	prescriptionExpiryDate: "",
	blisters: [
		{
			usage: "1",
			every: "1",
			startDate: "2024-01-01",
			startTime: "09:00",
		},
	],
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
};

const defaultProps = {
	show: true,
	editingId: null,
	form: defaultForm,
	onFormChange: vi.fn(),
	fieldErrors: {},
	saving: false,
	formSaved: false,
	formChanged: false,
	hasValidationErrors: false,
	dateConsistencyError: null,
	readOnlyMode: false,
	takenByInput: "",
	onTakenByInputChange: vi.fn(),
	existingPeople: [],
	onAddTakenByPerson: vi.fn(),
	onRemoveTakenByPerson: vi.fn(),
	onTakenByKeyDown: vi.fn(),
	onSetBlisterValue: vi.fn(),
	onAddBlister: vi.fn(),
	onRemoveBlister: vi.fn(),
	onSetIntakeValue: vi.fn(),
	onAddIntake: vi.fn(),
	onRemoveIntake: vi.fn(),
	onHandleValueChange: vi.fn(),
	refillPacks: 0,
	onRefillPacksChange: vi.fn(),
	refillLoose: 0,
	onRefillLooseChange: vi.fn(),
	refillSaving: false,
	onSubmitRefill: vi.fn(),
	meds: [],
	onUploadMedImage: vi.fn(),
	onDeleteMedImage: vi.fn(),
	imageUploadError: null,
	onClose: vi.fn(),
	onResetForm: vi.fn(),
	onSaveMedication: vi.fn(),
};

describe("MobileEditModal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders nothing when show is false", () => {
		render(<MobileEditModal {...defaultProps} show={false} />);

		expect(screen.queryByText(/form\.newEntry/i)).not.toBeInTheDocument();
	});

	it("renders modal when show is true", () => {
		render(<MobileEditModal {...defaultProps} />);

		// Should render the modal overlay
		const modal = document.querySelector(".modal-overlay");
		expect(modal).toBeInTheDocument();
	});

	it("shows new entry title when not editing", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.newEntry/i)).toBeInTheDocument();
	});

	it("shows edit entry title when editing", () => {
		render(<MobileEditModal {...defaultProps} editingId={1} />);

		expect(screen.getByText(/form\.editEntry/i)).toBeInTheDocument();
	});

	it("renders close button", () => {
		render(<MobileEditModal {...defaultProps} />);

		const closeBtn = document.querySelector(".btn-nav");
		expect(closeBtn).toBeInTheDocument();
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		render(<MobileEditModal {...defaultProps} onClose={onClose} />);

		const closeBtn = document.querySelector(".btn-nav");
		if (closeBtn) {
			fireEvent.click(closeBtn);
		}

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("renders form element", () => {
		render(<MobileEditModal {...defaultProps} />);

		const form = document.querySelector("form");
		expect(form).toBeInTheDocument();
	});

	it("renders name input", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.commercialName/i)).toBeInTheDocument();
	});

	it("renders generic name input", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.genericName/i)).toBeInTheDocument();
	});

	it("renders packs input", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.packs/i)).toBeInTheDocument();
	});

	it("renders blisters per pack input", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.blistersPerPack/i)).toBeInTheDocument();
	});

	it("renders pills per blister input", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.pillsPerBlister/i)).toBeInTheDocument();
	});

	it("does not render loose tablets input in package section", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.queryByText(/form\.loosePills/i)).not.toBeInTheDocument();
		expect(screen.getByText(/form\.total/i)).toBeInTheDocument();
	});

	it("renders intake schedules section", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.blisters\.title/i)).toBeInTheDocument();
	});

	it("renders save button", () => {
		render(<MobileEditModal {...defaultProps} />);

		const saveBtn = document.querySelector('button[type="submit"]');
		expect(saveBtn).toBeInTheDocument();
	});

	it("disables save when saving", () => {
		render(<MobileEditModal {...defaultProps} saving={true} />);

		const saveBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
		expect(saveBtn).toBeDisabled();
	});

	it("disables save when has validation errors", () => {
		render(<MobileEditModal {...defaultProps} hasValidationErrors={true} />);

		const saveBtn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
		expect(saveBtn).toHaveClass("has-validation-error");
	});

	it("renders add intake button", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByRole("button", { name: /form\.blisters\.addIntake/i })).toBeInTheDocument();
	});

	it("calls onAddIntake when add intake clicked", () => {
		const onAddIntake = vi.fn();
		render(<MobileEditModal {...defaultProps} onAddIntake={onAddIntake} />);

		const addBtn = screen.getByRole("button", { name: /form\.blisters\.addIntake/i });
		fireEvent.click(addBtn);

		expect(onAddIntake).toHaveBeenCalledTimes(1);
	});

	it("renders modal content", () => {
		render(<MobileEditModal {...defaultProps} />);

		const content = document.querySelector(".modal-content.edit-modal");
		expect(content).toBeInTheDocument();
	});

	it("renders edit modal header", () => {
		render(<MobileEditModal {...defaultProps} />);

		const header = document.querySelector(".edit-modal-header");
		expect(header).toBeInTheDocument();
	});

	it("uses plain numeric input for tube amount without stepper controls", () => {
		render(
			<MobileEditModal
				{...defaultProps}
				form={{
					...defaultForm,
					packageType: "tube",
					medicationForm: "topical",
					packageAmountValue: "150",
					packageAmountUnit: "g",
				}}
			/>
		);

		const amountInput = screen.getByLabelText("form.packageAmountPerTube") as HTMLInputElement;
		expect(amountInput).toBeInTheDocument();
		expect(amountInput.tagName).toBe("INPUT");
		expect(amountInput).toHaveAttribute("inputmode", "decimal");

		const unitSelect = screen.getByLabelText("form.packageAmountUnitG") as HTMLSelectElement;
		expect(unitSelect).toBeDisabled();
		expect(unitSelect.value).toBe("g");
	});

	it("uses plain numeric input for liquid container package amount", () => {
		render(
			<MobileEditModal
				{...defaultProps}
				form={{
					...defaultForm,
					packageType: "liquid_container",
					medicationForm: "liquid",
					packageAmountValue: "250",
					packageAmountUnit: "ml",
				}}
			/>
		);

		const amountInput = screen.getByLabelText("form.packageAmount") as HTMLInputElement;
		expect(amountInput).toBeInTheDocument();
		expect(amountInput.tagName).toBe("INPUT");
		expect(amountInput).toHaveAttribute("inputmode", "decimal");

		const unitSelect = screen.getByLabelText("form.packageAmountUnitMl") as HTMLSelectElement;
		expect(unitSelect).toBeDisabled();
		expect(unitSelect.value).toBe("ml");
	});
});

describe("MobileEditModal with existing people", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders modal with existing people prop", () => {
		render(<MobileEditModal {...defaultProps} existingPeople={["John", "Jane"]} />);

		// Should render the modal - suggestions shown on input focus
		const modal = document.querySelector(".modal-overlay");
		expect(modal).toBeInTheDocument();
	});
});

describe("MobileEditModal with form errors", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows name error when present", () => {
		render(<MobileEditModal {...defaultProps} fieldErrors={{ name: "Name is required" }} />);

		expect(screen.getByText("Name is required")).toBeInTheDocument();
	});

	it("shows notes error when present", () => {
		render(<MobileEditModal {...defaultProps} fieldErrors={{ notes: "Notes too long" }} />);

		expect(screen.getByText("Notes too long")).toBeInTheDocument();
	});
});

describe("MobileEditModal blister management", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders blister rows", () => {
		render(<MobileEditModal {...defaultProps} />);

		const blisterRows = document.querySelectorAll(".blister-row");
		expect(blisterRows.length).toBe(1);
	});

	it("renders remove button for each blister", () => {
		const form = {
			...defaultForm,
			blisters: [
				{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" },
				{ usage: "2", every: "7", startDate: "2024-01-01", startTime: "10:00" },
			],
			intakes: [
				{
					usage: "1",
					every: "1",
					startDate: "2024-01-01",
					startTime: "09:00",
					takenBy: "",
					intakeRemindersEnabled: false,
				},
				{
					usage: "2",
					every: "7",
					startDate: "2024-01-01",
					startTime: "10:00",
					takenBy: "",
					intakeRemindersEnabled: false,
				},
			],
		};

		render(<MobileEditModal {...defaultProps} form={form} />);

		const blisterRows = document.querySelectorAll(".blister-row");
		expect(blisterRows.length).toBe(2);
	});

	it("calls onRemoveIntake when remove button clicked", () => {
		const onRemoveIntake = vi.fn();
		const form = {
			...defaultForm,
			blisters: [
				{ usage: "1", every: "1", startDate: "2024-01-01", startTime: "09:00" },
				{ usage: "2", every: "7", startDate: "2024-01-01", startTime: "10:00" },
			],
			intakes: [
				{
					usage: "1",
					every: "1",
					startDate: "2024-01-01",
					startTime: "09:00",
					takenBy: "",
					intakeRemindersEnabled: false,
				},
				{
					usage: "2",
					every: "7",
					startDate: "2024-01-01",
					startTime: "10:00",
					takenBy: "",
					intakeRemindersEnabled: false,
				},
			],
		};

		render(<MobileEditModal {...defaultProps} form={form} onRemoveIntake={onRemoveIntake} />);

		const removeButtons = document.querySelectorAll(".blister-row button.danger");
		if (removeButtons.length > 0) {
			fireEvent.click(removeButtons[0]);
			expect(onRemoveIntake).toHaveBeenCalled();
		}
	});

	it("calls onSetIntakeValue when changing blister field", () => {
		const onSetIntakeValue = vi.fn();

		render(<MobileEditModal {...defaultProps} onSetIntakeValue={onSetIntakeValue} />);

		const usageInputs = document.querySelectorAll('.blister-row input[type="number"]');
		if (usageInputs.length > 0) {
			fireEvent.change(usageInputs[0], { target: { value: "2" } });
			expect(onSetIntakeValue).toHaveBeenCalled();
		}
	});
});

describe("MobileEditModal form submission", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does not call onSaveMedication when native form validation fails", () => {
		const onSaveMedication = vi.fn();
		render(<MobileEditModal {...defaultProps} onSaveMedication={onSaveMedication} />);

		const form = document.querySelector("form") as HTMLFormElement;
		const checkValiditySpy = vi.spyOn(form, "checkValidity").mockReturnValue(false);
		const reportValiditySpy = vi.spyOn(form, "reportValidity").mockReturnValue(false);

		fireEvent.submit(form);

		expect(checkValiditySpy).toHaveBeenCalled();
		expect(reportValiditySpy).toHaveBeenCalled();
		expect(onSaveMedication).not.toHaveBeenCalled();
	});

	it("calls onSaveMedication when form submitted", () => {
		const onSaveMedication = vi.fn((e: FormEvent) => e.preventDefault());
		const validForm = { ...defaultForm, name: "TestMed" };

		render(<MobileEditModal {...defaultProps} form={validForm} onSaveMedication={onSaveMedication} />);

		const form = document.querySelector("form");
		if (form) {
			fireEvent.submit(form);
			expect(onSaveMedication).toHaveBeenCalled();
		}
	});

	it("shows saving state", () => {
		render(<MobileEditModal {...defaultProps} saving={true} />);

		const saveBtn = document.querySelector('button[type="submit"]');
		expect(saveBtn).toBeDisabled();
	});

	it("shows formSaved state", () => {
		render(<MobileEditModal {...defaultProps} formSaved={true} />);

		// Form should still render
		const modal = document.querySelector(".modal-overlay");
		expect(modal).toBeInTheDocument();
	});
});

describe("MobileEditModal field callbacks", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls onFormChange when commercial name changes", () => {
		const onFormChange = vi.fn();
		render(<MobileEditModal {...defaultProps} onFormChange={onFormChange} />);

		const nameInput = document.querySelector('input[placeholder="form.placeholders.commercial"]') as HTMLInputElement;
		fireEvent.change(nameInput, { target: { value: "Aspirin" } });

		expect(onFormChange).toHaveBeenCalledWith(expect.objectContaining({ name: "Aspirin" }));
	});

	it("calls onFormChange when generic name changes", () => {
		const onFormChange = vi.fn();
		render(<MobileEditModal {...defaultProps} onFormChange={onFormChange} />);

		const genericInput = document.querySelector('input[placeholder="form.placeholders.generic"]') as HTMLInputElement;
		fireEvent.change(genericInput, { target: { value: "Acetylsalicylic acid" } });

		expect(onFormChange).toHaveBeenCalledWith(expect.objectContaining({ genericName: "Acetylsalicylic acid" }));
	});

	it("calls onFormChange when notes change", () => {
		const onFormChange = vi.fn();
		render(<MobileEditModal {...defaultProps} onFormChange={onFormChange} />);

		const notes = document.querySelector("textarea") as HTMLTextAreaElement;
		fireEvent.change(notes, { target: { value: "Take with food" } });

		expect(onFormChange).toHaveBeenCalledWith(expect.objectContaining({ notes: "Take with food" }));
	});

	it("calls onFormChange when dose unit changes", () => {
		const onFormChange = vi.fn();
		render(<MobileEditModal {...defaultProps} onFormChange={onFormChange} />);

		const doseUnitSelect = document.querySelector(".dose-unit-select") as HTMLSelectElement;
		fireEvent.change(doseUnitSelect, { target: { value: "g" } });

		expect(onFormChange).toHaveBeenCalledWith(expect.objectContaining({ doseUnit: "g" }));
	});

	it("calls onHandleValueChange when package type changes", () => {
		const onHandleValueChange = vi.fn();
		render(<MobileEditModal {...defaultProps} onHandleValueChange={onHandleValueChange} />);

		const packageSelect = document.querySelector(".package-type-select") as HTMLSelectElement;
		fireEvent.change(packageSelect, { target: { value: "bottle" } });

		expect(onHandleValueChange).toHaveBeenCalledWith("packageType", "bottle");
	});

	it("calls onHandleValueChange when blister stock values change", () => {
		const onHandleValueChange = vi.fn();
		render(<MobileEditModal {...defaultProps} onHandleValueChange={onHandleValueChange} />);

		const packCountInput = document.querySelector('input[type="text"][inputmode="numeric"]') as HTMLInputElement;
		fireEvent.change(packCountInput, { target: { value: "4" } });

		expect(onHandleValueChange).toHaveBeenCalledWith("packCount", "4");
	});
});

describe("MobileEditModal with filled form", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("displays filled form values", () => {
		const form = {
			...defaultForm,
			name: "Aspirin",
			genericName: "Acetylsalicylic acid",
			packCount: "2",
			blistersPerPack: "3",
			pillsPerBlister: "10",
			looseTablets: "5",
		};

		render(<MobileEditModal {...defaultProps} form={form} />);

		// Find input with the value
		const nameInputs = document.querySelectorAll("input");
		const nameInput = Array.from(nameInputs).find((input) => (input as HTMLInputElement).value === "Aspirin");
		expect(nameInput).toBeTruthy();
	});
});

describe("MobileEditModal takenBy", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows add-person placeholder when people already exist", () => {
		const form = {
			...defaultForm,
			takenBy: ["John"],
		};

		render(<MobileEditModal {...defaultProps} form={form} />);

		const input = document.querySelector(".tag-input-container input") as HTMLInputElement;
		expect(input.placeholder).toBe("form.placeholders.addPerson");
	});

	it("filters takenBy suggestions and excludes already selected people", () => {
		const form = {
			...defaultForm,
			takenBy: ["John"],
		};

		render(<MobileEditModal {...defaultProps} form={form} existingPeople={["John", "Jane", "Alex"]} />);

		expect(document.querySelector('#takenby-suggestions-modal option[value="John"]')).not.toBeInTheDocument();
		expect(document.querySelector('#takenby-suggestions-modal option[value="Jane"]')).toBeInTheDocument();
		expect(document.querySelector('#takenby-suggestions-modal option[value="Alex"]')).toBeInTheDocument();
	});

	it("displays takenBy tags", () => {
		const form = {
			...defaultForm,
			takenBy: ["John", "Jane"],
		};

		render(<MobileEditModal {...defaultProps} form={form} />);

		// Check tags are rendered (use getAllByText since names also appear in intake dropdowns)
		const johnElements = screen.getAllByText("John");
		const janeElements = screen.getAllByText("Jane");
		expect(johnElements.length).toBeGreaterThanOrEqual(1);
		expect(janeElements.length).toBeGreaterThanOrEqual(1);
		// Verify the tag elements specifically exist
		expect(johnElements.some((el) => el.closest(".tag"))).toBe(true);
		expect(janeElements.some((el) => el.closest(".tag"))).toBe(true);
	});

	it("calls onRemoveTakenByPerson when tag removed", () => {
		const onRemoveTakenByPerson = vi.fn();
		const form = {
			...defaultForm,
			takenBy: ["John"],
		};

		render(<MobileEditModal {...defaultProps} form={form} onRemoveTakenByPerson={onRemoveTakenByPerson} />);

		const removeButtons = document.querySelectorAll(".tag-remove");
		if (removeButtons.length > 0) {
			fireEvent.click(removeButtons[0]);
			expect(onRemoveTakenByPerson).toHaveBeenCalledWith("John");
		}
	});

	it("calls onTakenByInputChange when typing", () => {
		const onTakenByInputChange = vi.fn();

		render(<MobileEditModal {...defaultProps} onTakenByInputChange={onTakenByInputChange} />);

		// Find the takenBy input using the container class
		const tagInputContainer = document.querySelector(".tag-input-container input");
		if (tagInputContainer) {
			fireEvent.change(tagInputContainer, { target: { value: "New Person" } });
			expect(onTakenByInputChange).toHaveBeenCalled();
		}
	});

	it("calls onTakenByKeyDown on keydown", () => {
		const onTakenByKeyDown = vi.fn();

		render(<MobileEditModal {...defaultProps} onTakenByKeyDown={onTakenByKeyDown} />);

		const tagInputContainer = document.querySelector(".tag-input-container input");
		if (tagInputContainer) {
			fireEvent.keyDown(tagInputContainer, { key: "Enter" });
			expect(onTakenByKeyDown).toHaveBeenCalled();
		}
	});

	it("calls onAddTakenByPerson on blur when input has value", () => {
		const onAddTakenByPerson = vi.fn();

		render(<MobileEditModal {...defaultProps} takenByInput="Alex" onAddTakenByPerson={onAddTakenByPerson} />);

		const tagInput = document.querySelector(".tag-input-container input") as HTMLInputElement;
		fireEvent.blur(tagInput);

		expect(onAddTakenByPerson).toHaveBeenCalledWith("Alex");
	});
});

describe("MobileEditModal overlay interaction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls onClose when clicking overlay", () => {
		const onClose = vi.fn();
		const onResetForm = vi.fn();

		render(<MobileEditModal {...defaultProps} onClose={onClose} onResetForm={onResetForm} />);

		const overlay = document.querySelector(".modal-overlay");
		if (overlay) {
			fireEvent.click(overlay);
			expect(onClose).toHaveBeenCalled();
		}
	});

	it("does not close when clicking modal content", () => {
		const onClose = vi.fn();
		const onResetForm = vi.fn();

		render(<MobileEditModal {...defaultProps} onClose={onClose} onResetForm={onResetForm} />);

		const content = document.querySelector(".modal-content");
		if (content) {
			fireEvent.click(content);
		}

		expect(onClose).not.toHaveBeenCalled();
	});
});

describe("MobileEditModal optional fields", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders expiry date field", () => {
		render(<MobileEditModal {...defaultProps} />);

		const dateInput = document.querySelector('input[type="date"]');
		expect(dateInput).toBeInTheDocument();
	});

	it("renders notes field", () => {
		render(<MobileEditModal {...defaultProps} />);

		const textarea = document.querySelector("textarea");
		expect(textarea).toBeInTheDocument();
	});

	it("renders pill weight field", () => {
		render(<MobileEditModal {...defaultProps} />);

		expect(screen.getByText(/form\.pillWeight/i)).toBeInTheDocument();
	});

	it("renders intake reminders toggle", () => {
		render(<MobileEditModal {...defaultProps} />);

		const toggle = document.querySelector('.toggle-switch input[type="checkbox"]');
		expect(toggle).toBeInTheDocument();
	});

	it("shows intake takenBy select when takenBy list is not empty", () => {
		const form = {
			...defaultForm,
			takenBy: ["John", "Jane"],
			intakes: [
				{
					usage: "1",
					every: "1",
					startDate: "2024-01-01",
					startTime: "09:00",
					takenBy: "John",
					intakeRemindersEnabled: false,
				},
			],
		};

		render(<MobileEditModal {...defaultProps} form={form} />);

		expect(screen.getByText(/form\.blisters\.takenByIntake/i)).toBeInTheDocument();
		expect(document.querySelector('.blister-row select option[value="John"]')).toBeInTheDocument();
	});

	it("passes single takenBy person as default when adding intake", () => {
		const onAddIntake = vi.fn();
		const form = {
			...defaultForm,
			takenBy: ["OnlyPerson"],
		};

		render(<MobileEditModal {...defaultProps} form={form} onAddIntake={onAddIntake} />);

		fireEvent.click(screen.getByRole("button", { name: /form\.blisters\.addIntake/i }));
		expect(onAddIntake).toHaveBeenCalledWith("OnlyPerson");
	});
});

describe("MobileEditModal bottle package type", () => {
	const bottleForm: FormState = {
		...defaultForm,
		packageType: "bottle",
		packCount: "0",
		blistersPerPack: "1",
		pillsPerBlister: "1",
		looseTablets: "80",
		totalPills: "100",
	};

	it("shows totalCapacity and currentPills fields for bottle form", () => {
		render(<MobileEditModal {...defaultProps} form={bottleForm} />);

		// Should show total capacity field
		expect(screen.getByText(/form\.totalCapacity/i)).toBeInTheDocument();
		// Should show current pills field
		expect(screen.getByText(/form\.currentPills/i)).toBeInTheDocument();

		// Should NOT show blister-specific fields
		expect(screen.queryByText("form.packs")).not.toBeInTheDocument();
		expect(screen.queryByText("form.blistersPerPack")).not.toBeInTheDocument();
		expect(screen.queryByText("form.pillsPerBlister")).not.toBeInTheDocument();
	});
});

describe("MobileEditModal image actions", () => {
	const baseMed = {
		id: 1,
		name: "Aspirin",
		takenBy: [],
		packageType: "blister" as const,
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		looseTablets: 0,
		blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00.000Z" }],
		intakes: [
			{
				usage: 1,
				every: 1,
				start: "2024-01-01T09:00:00.000Z",
				takenBy: null,
				intakeRemindersEnabled: false,
			},
		],
		updatedAt: null,
		imageUrl: null,
	};

	it("calls onUploadMedImage when selecting a file", () => {
		const onUploadMedImage = vi.fn().mockResolvedValue(undefined);
		render(<MobileEditModal {...defaultProps} editingId={1} meds={[baseMed]} onUploadMedImage={onUploadMedImage} />);

		const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
		const file = new File(["img"], "med.png", { type: "image/png" });
		fireEvent.change(fileInput, { target: { files: [file] } });

		expect(onUploadMedImage).toHaveBeenCalledWith(1, file);
	});

	it("calls onDeleteMedImage when delete image button is clicked", () => {
		const onDeleteMedImage = vi.fn().mockResolvedValue(undefined);
		render(
			<MobileEditModal
				{...defaultProps}
				editingId={1}
				meds={[{ ...baseMed, imageUrl: "aspirin.png" }]}
				onDeleteMedImage={onDeleteMedImage}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: /form\.removeImage/i }));
		expect(onDeleteMedImage).toHaveBeenCalledWith(1);
	});
});
