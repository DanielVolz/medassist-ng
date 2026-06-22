import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEDICATION_FORM_FIELD_LIMITS } from "../../hooks/medicationFormModel";
import { MedicationsPage } from "../../pages/MedicationsPage";

const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

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

vi.mock("../../hooks", async () => {
	const actual = await vi.importActual<typeof import("../../hooks")>("../../hooks");
	return {
		...actual,
		useMedicationForm: () => mockFormHookValue,
		useUnsavedChangesWarning: () => ({}),
		useModalHistory: vi.fn(),
	};
});

vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
	useUnsavedChanges: () => ({
		setHasUnsavedChanges: vi.fn(),
		hasUnsavedChanges: false,
		confirmNavigation: vi.fn().mockReturnValue(true),
	}),
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({ user: { id: 1, username: "testuser" }, isAuthenticated: true, authFetch: authFetchMock }),
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

vi.mock("../../components/medications/MedicationDialogs", () => ({
	MedicationDialogs: ({
		showUnsavedConfirm,
		unsavedConfirmLabel,
		onConfirmClose,
		showObsoleteConfirm,
		obsoleteConfirmLabel,
		onConfirmMarkObsolete,
		showDeleteConfirm,
		deleteConfirmLabel,
		onConfirmDelete,
		lightboxImage,
		showReportModal,
	}: {
		showUnsavedConfirm: boolean;
		unsavedConfirmLabel: string;
		onConfirmClose: () => void;
		showObsoleteConfirm: boolean;
		obsoleteConfirmLabel: string;
		onConfirmMarkObsolete: () => void;
		showDeleteConfirm: boolean;
		deleteConfirmLabel: string;
		onConfirmDelete: () => void;
		lightboxImage: { src: string; alt: string } | null;
		showReportModal: boolean;
	}) => (
		<>
			{showUnsavedConfirm ? (
				<div data-testid="confirm-modal">
					<button type="button" onClick={onConfirmClose}>
						{unsavedConfirmLabel}
					</button>
				</div>
			) : null}
			{showObsoleteConfirm ? (
				<div data-testid="confirm-modal">
					<button type="button" onClick={onConfirmMarkObsolete}>
						{obsoleteConfirmLabel}
					</button>
				</div>
			) : null}
			{showDeleteConfirm ? (
				<div data-testid="confirm-modal">
					<button type="button" onClick={onConfirmDelete}>
						{deleteConfirmLabel}
					</button>
				</div>
			) : null}
			{lightboxImage ? <div data-testid="lightbox-open">{`${lightboxImage.src}|${lightboxImage.alt}`}</div> : null}
			{showReportModal ? <div data-testid="report-modal-open">Report Modal</div> : null}
		</>
	),
}));

function renderPage(initialEntry = "/medications") {
	render(
		<MemoryRouter initialEntries={[initialEntry]}>
			<MedicationsPage />
		</MemoryRouter>
	);
}

function openNewMedicationForm() {
	const newButton = screen.getByRole("button", { name: "form.newEntry" });
	expect(newButton).toBeInTheDocument();
	fireEvent.click(newButton);
}

function getEnrichmentPackageButtons() {
	return Array.from(document.querySelectorAll<HTMLButtonElement>(".medication-enrichment-package-choice-button"));
}

function createMedicationEnrichmentSearchResults(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		code: `RX-RESULT-${index + 1}`,
		name: `Result ${index + 1}`,
		genericName: `Generic ${index + 1}`,
		authorisationHolder: null,
		therapeuticArea: null,
		matchType: "brand" as const,
		genericStatus: "unknown" as const,
		authorisationDate: null,
		source: "rxnorm" as const,
		packageOptions: [],
	}));
}

function createGroupedOpenFdaMedicationEnrichmentResults(count: number, name: string) {
	return Array.from({ length: count }, (_, index) => ({
		code: `OPENFDA-${name}-${index + 1}`,
		name,
		genericName: "dimethyl fumarate",
		authorisationHolder: null,
		therapeuticArea: null,
		matchType: "brand" as const,
		genericStatus: "unknown" as const,
		authorisationDate: null,
		source: "openfda" as const,
		packageOptions: [],
	}));
}

describe("MedicationsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
		Object.defineProperty(window, "innerWidth", { value: 1200, writable: true });
		Object.defineProperty(Element.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		});
		Object.defineProperty(window, "requestAnimationFrame", {
			configurable: true,
			value: (callback: FrameRequestCallback) => {
				callback(0);
				return 1;
			},
		});
		Object.defineProperty(window, "cancelAnimationFrame", {
			configurable: true,
			value: vi.fn(),
		});
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

	it("shows the shared required-name errors on desktop edit submit", async () => {
		mockFormHookValue = createMockFormHook({
			hasValidationErrors: true,
			fieldErrors: {
				name: "common.validation.nameOrGenericRequired",
				genericName: "common.validation.nameOrGenericRequired",
			},
		});

		renderPage();
		openNewMedicationForm();
		fireEvent.submit(document.querySelector("form") as HTMLFormElement);

		await waitFor(() => {
			expect(screen.getAllByText("common.validation.nameOrGenericRequired")).toHaveLength(2);
		});
	});

	it("uses shared max-length limits for desktop edit fields", () => {
		renderPage();
		openNewMedicationForm();

		expect(screen.getByPlaceholderText("form.placeholders.commercial")).toHaveAttribute(
			"maxlength",
			String(MEDICATION_FORM_FIELD_LIMITS.name.max)
		);
		expect(screen.getByPlaceholderText("form.placeholders.generic")).toHaveAttribute(
			"maxlength",
			String(MEDICATION_FORM_FIELD_LIMITS.genericName.max)
		);
		expect(screen.getByPlaceholderText("form.placeholders.takenBy")).toHaveAttribute(
			"maxlength",
			String(MEDICATION_FORM_FIELD_LIMITS.takenBy.max)
		);

		fireEvent.click(screen.getByRole("tab", { name: "form.sections.stock" }));
		expect(screen.getByPlaceholderText("form.placeholders.notes")).toHaveAttribute(
			"maxlength",
			String(MEDICATION_FORM_FIELD_LIMITS.notes.max)
		);
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

	it("shows weekday controls and validation error in the desktop schedule form", () => {
		mockFormHookValue = createMockFormHook({
			formChanged: true,
			form: {
				...createMockFormHook().form,
				name: "Weekday Med",
				intakes: [
					{
						usage: "1",
						every: "1",
						startDate: "2024-01-01",
						startTime: "09:00",
						scheduleMode: "weekdays" as const,
						weekdays: [],
						takenBy: "",
						intakeRemindersEnabled: false,
					},
				],
			},
		});

		renderPage();
		openNewMedicationForm();
		fireEvent.click(screen.getByRole("tab", { name: "form.sections.schedule" }));

		expect(screen.getByText("form.blisters.weekdaysRequired")).toBeInTheDocument();
		expect(screen.getByText("form.blisters.weekdays")).toBeInTheDocument();
		expect(screen.queryByLabelText("form.blisters.everyDays")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "common.save" })).toBeEnabled();
	});

	it("toggles weekday selections in the desktop schedule form", () => {
		const setIntakeValue = vi.fn();
		mockFormHookValue = createMockFormHook({
			setIntakeValue,
			form: {
				...createMockFormHook().form,
				name: "Weekday Med",
				intakes: [
					{
						usage: "1",
						every: "1",
						startDate: "2024-01-01",
						startTime: "09:00",
						scheduleMode: "weekdays" as const,
						weekdays: ["wed"] as const,
						takenBy: "",
						intakeRemindersEnabled: false,
					},
				],
			},
		});

		renderPage();
		openNewMedicationForm();
		fireEvent.click(screen.getByRole("tab", { name: "form.sections.schedule" }));
		fireEvent.click(screen.getByRole("button", { name: "form.blisters.weekdaysLong.mon" }));

		expect(setIntakeValue).toHaveBeenCalledWith(0, "weekdays", ["mon", "wed"]);
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
		const rows = screen.getAllByTestId("medication-row");
		expect(rows.length).toBeGreaterThan(0);
	});

	it("opens the medication image lightbox from the list avatar", () => {
		const medicationWithImage = { ...mockMeds[0], imageUrl: "aspirin.webp" };
		mockContextValue = createMockContext({ meds: [medicationWithImage] });

		renderPage();
		fireEvent.click(screen.getByRole("button", { name: "Aspirin" }));

		expect(screen.getByTestId("lightbox-open")).toHaveTextContent("/api/images/aspirin.webp|Aspirin");
	});

	it("calls startEdit from list action", () => {
		const startEdit = vi.fn();
		mockFormHookValue = createMockFormHook({ startEdit });
		fetchMock.mockResolvedValue({ ok: true, json: async () => mockMeds });
		renderPage();
		fireEvent.click(screen.getAllByRole("button", { name: "common.edit" })[0]);
		expect(startEdit).toHaveBeenCalledTimes(1);
	});

	it("prefers the latest context medication data when opening edit", () => {
		const startEdit = vi.fn();
		const contextMedication = { ...mockMeds[0], takenBy: ["Alice", "Bob"] };
		const staleFetchedMedication = { ...mockMeds[0], takenBy: [] };

		mockContextValue = createMockContext({
			meds: [contextMedication],
			existingPeople: ["Alice", "Bob"],
		});
		mockFormHookValue = createMockFormHook({ startEdit });
		fetchMock.mockResolvedValue({ ok: true, json: async () => [staleFetchedMedication] });

		renderPage();

		fireEvent.click(screen.getAllByRole("button", { name: "common.edit" })[0]);

		expect(startEdit).toHaveBeenCalledWith(
			expect.objectContaining({ id: 1, takenBy: ["Alice", "Bob"] }),
			expect.any(Function)
		);
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

	it("opens read-only view from viewMedId query parameter", async () => {
		const startEdit = vi.fn();
		mockFormHookValue = createMockFormHook({ startEdit });
		fetchMock.mockResolvedValue({ ok: true, json: async () => mockMeds });

		renderPage("/medications?viewMedId=1");

		await waitFor(() => {
			expect(startEdit).toHaveBeenCalledTimes(1);
		});

		expect(screen.getByText("common.close")).toBeInTheDocument();
		expect(screen.queryByText("common.save")).not.toBeInTheDocument();
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
		fireEvent.click(screen.getAllByRole("button", { name: "common.edit" })[0]);

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
			expect(authFetchMock).toHaveBeenCalledWith("/api/medications/1/obsolete", {
				method: "POST",
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
			expect(authFetchMock).toHaveBeenCalledWith("/api/medications/2/reactivate", {
				method: "POST",
			});
		});
	});

	it("toggles obsolete section visibility and persists state", async () => {
		const obsoleteMed = { ...mockMeds[0], id: 2, isObsolete: true, obsoleteAt: "2025-01-01T00:00:00Z" };
		mockContextValue = createMockContext({ meds: [obsoleteMed] });

		renderPage();
		expect(screen.getByText("medications.list.reactivate")).toBeInTheDocument();

		const obsoleteToggleButton = screen.getByRole("button", {
			name: /medications\.list\.obsoleteTitle/,
			expanded: true,
		});
		expect(obsoleteToggleButton).toBeInTheDocument();
		fireEvent.click(obsoleteToggleButton);

		await waitFor(() => {
			expect(screen.queryByText("medications.list.reactivate")).not.toBeInTheDocument();
		});

		fireEvent.click(
			screen.getByRole("button", {
				name: /medications\.list\.obsoleteTitle/,
				expanded: false,
			})
		);
		expect(screen.getByText("medications.list.reactivate")).toBeInTheDocument();
	});
});

describe("MedicationsPage form interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockContextValue = createMockContext();
		mockFormHookValue = createMockFormHook();
		fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
		vi.stubGlobal("fetch", fetchMock);
	});

	it("updates form state when typing name", () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });
		renderPage();
		openNewMedicationForm();
		const nameInput = screen.getByPlaceholderText("form.placeholders.commercial") as HTMLInputElement;
		expect(nameInput).toBeInTheDocument();
		fireEvent.change(nameInput as HTMLInputElement, { target: { value: "Test Med" } });
		expect(setForm).toHaveBeenCalledWith(expect.objectContaining({ name: "Test Med" }));
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

	it("renders the shared medication enrichment section after generic name on desktop", () => {
		renderPage();
		openNewMedicationForm();

		const genericNameLabel = screen.getByText("form.genericName");
		const enrichmentTitle = screen.getByText("form.enrichment.title");

		expect(genericNameLabel.compareDocumentPosition(enrichmentTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(screen.getByText("form.enrichment.collapsedHint")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "form.enrichment.toggleShow" })).toBeInTheDocument();
	});

	it("searches and applies medication enrichment suggestions through the desktop form", async () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Aspirin",
						normalizedQuery: "aspirin",
						hasMore: url.includes("limit=6"),
						results: [
							{
								code: "RX-ASPIRIN",
								name: "Aspirin",
								genericName: "Acetylsalicylic acid",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "ingredient",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "rxnorm",
								packageOptions: [],
							},
							{
								code: "EMA-ASPIRIN",
								name: "Aspirin 500 mg tablets",
								genericName: "Acetylsalicylic acid",
								authorisationHolder: "Bayer",
								therapeuticArea: "Pain",
								matchType: "brand",
								genericStatus: "original",
								authorisationDate: "2024-02-01",
								source: "ema",
								packageOptions: [],
							},
							...(url.includes("limit=12")
								? [
										{
											code: "NDC-ASPIRIN",
											name: "Bayer Aspirin",
											genericName: "Acetylsalicylic acid",
											authorisationHolder: null,
											therapeuticArea: null,
											matchType: "brand",
											genericStatus: "unknown",
											authorisationDate: null,
											source: "openfda",
											packageOptions: [],
										},
									]
								: []),
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						selection: {
							name: "Aspirin",
							genericName: "Acetylsalicylic acid",
							therapeuticArea: "Pain",
							indication: "Pain relief",
							atcCode: "N02BA01",
							source: "rxnorm",
						},
						suggestions: {
							name: "Aspirin",
							genericName: "Acetylsalicylic acid",
							medicationForm: "tablet",
							strengthOptions: [{ label: "500 mg", pillWeightMg: 500, doseUnit: "mg" }],
							packageOptions: [
								{
									label: "2 blisters in 1 carton / 10 tablets in 1 blister",
									description: "2 blisters in 1 carton / 10 tablets in 1 blister",
									packageType: "blister",
									packCount: 1,
									blistersPerPack: 2,
									pillsPerBlister: 10,
									totalPills: 20,
									looseTablets: 0,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
							],
						},
						meta: {
							rxNormMatched: true,
							openFdaMatched: false,
							partial: false,
							note: null,
						},
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "  Aspirin  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Aspirin&limit=6");
		});

		await screen.findByText("Aspirin 500 mg tablets");
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Aspirin&limit=12");
		});

		await screen.findByText("Bayer Aspirin");
		expect(screen.queryByRole("button", { name: "form.enrichment.showMoreAction" })).not.toBeInTheDocument();
		fireEvent.click(screen.getAllByRole("button", { name: "form.enrichment.applyAction" })[0]);

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/enrich", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "Aspirin",
					name: "Aspirin",
					genericName: "Acetylsalicylic acid",
					code: "RX-ASPIRIN",
					source: "rxnorm",
				}),
			});
			expect(setForm).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Aspirin",
					genericName: "Acetylsalicylic acid",
					medicationForm: "tablet",
					pillForm: "tablet",
					packageType: "blister",
					packCount: "1",
					blistersPerPack: "2",
					pillsPerBlister: "10",
					totalPills: "",
					looseTablets: "0",
					pillWeightMg: "500",
					doseUnit: "mg",
				})
			);
		});

		expect(screen.getByText("form.enrichment.appliedStrength")).toBeInTheDocument();
	});

	it("shows the translated auth-required lookup message for search 401 responses", async () => {
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: false,
					status: 401,
					json: async () => ({ error: "Authentication required to use medication lookup" }),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Aspirin" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Aspirin&limit=6");
		});

		expect(await screen.findByText("form.enrichment.authRequired")).toBeInTheDocument();
		expect(screen.queryByText("Authentication required to use medication lookup")).not.toBeInTheDocument();
		expect(screen.queryByText("form.enrichment.noResults")).not.toBeInTheDocument();
	});

	it("hides the load-more button when a load-more request returns no additional results", async () => {
		const initialResults = createMedicationEnrichmentSearchResults(6);

		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Aspirin",
						normalizedQuery: "aspirin",
						hasMore: true,
						results: initialResults,
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Aspirin" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByText("Result 6");
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Aspirin&limit=12");
		});

		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "form.enrichment.showMoreAction" })).not.toBeInTheDocument();
		});
	});

	it("hides the load-more button when the UI reaches the maximum enrichment result limit", async () => {
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				const params = new URL(url, "http://localhost").searchParams;
				const limit = Number(params.get("limit") ?? "0");

				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Aspirin",
						normalizedQuery: "aspirin",
						hasMore: true,
						results: createMedicationEnrichmentSearchResults(limit),
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Aspirin" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByText("Result 6");

		for (const expectedLimit of [12, 18, 20]) {
			fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

			await waitFor(() => {
				expect(authFetchMock).toHaveBeenCalledWith(
					`/api/medication-enrichment/search?q=Aspirin&limit=${expectedLimit}`
				);
			});
		}

		await screen.findByText("Result 20");
		expect(screen.queryByRole("button", { name: "form.enrichment.showMoreAction" })).not.toBeInTheDocument();
	});

	it("keeps a visible loading state while more lookup results are being fetched", async () => {
		let resolveLoadMore!: (value: {
			ok: boolean;
			json: () => Promise<{
				query: string;
				normalizedQuery: string;
				hasMore: boolean;
				results: ReturnType<typeof createMedicationEnrichmentSearchResults>;
			}>;
		}) => void;

		fetchMock.mockImplementation((url: string) => {
			if (url === "/api/medication-enrichment/search?q=Aspirin&limit=6") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Aspirin",
						normalizedQuery: "aspirin",
						hasMore: true,
						results: createMedicationEnrichmentSearchResults(6),
					}),
				});
			}

			if (url === "/api/medication-enrichment/search?q=Aspirin&limit=12") {
				return new Promise<{
					ok: boolean;
					json: () => Promise<{
						query: string;
						normalizedQuery: string;
						hasMore: boolean;
						results: ReturnType<typeof createMedicationEnrichmentSearchResults>;
					}>;
				}>((resolve) => {
					resolveLoadMore = resolve;
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Aspirin" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByText("Result 6");
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Aspirin&limit=12");
		});

		expect(screen.getByRole("button", { name: "form.enrichment.loadingMoreResults" })).toBeDisabled();
		expect(screen.queryByRole("status")).not.toBeInTheDocument();

		resolveLoadMore({
			ok: true,
			json: async () => ({
				query: "Aspirin",
				normalizedQuery: "aspirin",
				hasMore: false,
				results: createMedicationEnrichmentSearchResults(12),
			}),
		});

		await screen.findByText("Result 12");
		expect(screen.queryByRole("button", { name: "form.enrichment.loadingMoreResults" })).not.toBeInTheDocument();
	});

	it("loads past grouped duplicate pages so one show-more click yields a visible new result", async () => {
		fetchMock.mockImplementation((url: string) => {
			if (url === "/api/medication-enrichment/search?q=Tecfidera&limit=6") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Tecfidera",
						normalizedQuery: "tecfidera",
						hasMore: true,
						results: [...createGroupedOpenFdaMedicationEnrichmentResults(6, "Tecfidera")],
					}),
				});
			}

			if (url === "/api/medication-enrichment/search?q=Tecfidera&limit=12") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Tecfidera",
						normalizedQuery: "tecfidera",
						hasMore: true,
						results: [...createGroupedOpenFdaMedicationEnrichmentResults(12, "Tecfidera")],
					}),
				});
			}

			if (url === "/api/medication-enrichment/search?q=Tecfidera&limit=18") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Tecfidera",
						normalizedQuery: "tecfidera",
						hasMore: false,
						results: [
							...createGroupedOpenFdaMedicationEnrichmentResults(12, "Tecfidera"),
							...createMedicationEnrichmentSearchResults(6),
						],
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Tecfidera" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findAllByText("Tecfidera");
		expect(screen.queryByText("Result 1")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.showMoreAction" }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Tecfidera&limit=12");
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/search?q=Tecfidera&limit=18");
		});

		await screen.findByText("Result 1");
		expect(screen.queryByRole("button", { name: "form.enrichment.showMoreAction" })).not.toBeInTheDocument();
	});

	it("sorts strength suggestions numerically ascending before rendering them", async () => {
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Ibuprofen",
						normalizedQuery: "ibuprofen",
						hasMore: false,
						results: [
							{
								code: "RX-IBUPROFEN-STRENGTHS",
								name: "Ibuprofen",
								genericName: "Ibuprofen",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "brand",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "rxnorm",
								packageOptions: [],
							},
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						selection: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							therapeuticArea: null,
							indication: null,
							atcCode: null,
							source: "rxnorm",
						},
						suggestions: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							medicationForm: "tablet",
							strengthOptions: [
								{ label: "500 mg", pillWeightMg: 500, doseUnit: "mg" },
								{ label: "25 mg", pillWeightMg: 25, doseUnit: "mg" },
								{ label: "1000 mg", pillWeightMg: 1000, doseUnit: "mg" },
								{ label: "75 mg", pillWeightMg: 75, doseUnit: "mg" },
							],
							packageOptions: [],
						},
						meta: {
							rxNormMatched: true,
							openFdaMatched: false,
							partial: false,
							note: null,
						},
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Ibuprofen" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByRole("button", { name: "form.enrichment.applyAction" });
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.applyAction" }));

		await waitFor(() => {
			const strengthLabels = Array.from(
				document.querySelectorAll<HTMLButtonElement>(".medication-enrichment-strength-list > button")
			).map((button) => button.textContent);

			expect(strengthLabels).toEqual(["25 mg", "75 mg", "500 mg", "1000 mg"]);
		});
	});

	it("applies multi-package suggestions for bottle, liquid, and tube flows", async () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Ibuprofen",
						normalizedQuery: "ibuprofen",
						hasMore: false,
						results: [
							{
								code: "NDC-IBU",
								name: "Ibuprofen",
								genericName: "Ibuprofen",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "brand",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "openfda",
								packageOptions: [
									{
										label: "60 tablets in 1 bottle",
										description: "60 tablets in 1 bottle",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 60,
										looseTablets: 60,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
								],
							},
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						selection: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							therapeuticArea: null,
							indication: null,
							atcCode: null,
							source: "openfda",
						},
						suggestions: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							medicationForm: "tablet",
							strengthOptions: [],
							packageOptions: [
								{
									label: "60 tablets in 1 bottle (00093-7424-56)",
									description: "60 tablets in 1 bottle (00093-7424-56)",
									packageType: "bottle",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 60,
									looseTablets: 60,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
								{
									label: "250 mL in 1 bottle (00536-1167-01)",
									description: "250 mL in 1 bottle (00536-1167-01)",
									packageType: "liquid_container",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 250,
									looseTablets: 250,
									packageAmountValue: 250,
									packageAmountUnit: "ml",
								},
								{
									label: "15 g in 1 tube",
									description: "15 g in 1 tube",
									packageType: "tube",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 15,
									looseTablets: 15,
									packageAmountValue: 15,
									packageAmountUnit: "g",
								},
							],
						},
						meta: {
							rxNormMatched: false,
							openFdaMatched: true,
							partial: false,
							note: null,
						},
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Ibuprofen" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));
		await screen.findByRole("button", { name: "form.enrichment.applyAction" });

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.applyAction" }));

		await waitFor(() => {
			expect(getEnrichmentPackageButtons()).toHaveLength(3);
		});

		const packageButtons = getEnrichmentPackageButtons();
		fireEvent.click(packageButtons[0]);
		fireEvent.click(packageButtons[1]);
		fireEvent.click(packageButtons[2]);

		const bottleUpdater = setForm.mock.calls[1]?.[0] as (
			form: ReturnType<typeof createMockFormHook>["form"]
		) => unknown;
		const liquidUpdater = setForm.mock.calls[2]?.[0] as (
			form: ReturnType<typeof createMockFormHook>["form"]
		) => unknown;
		const tubeUpdater = setForm.mock.calls[3]?.[0] as (form: ReturnType<typeof createMockFormHook>["form"]) => unknown;
		const baseForm = createMockFormHook().form;

		expect(bottleUpdater(baseForm)).toMatchObject({
			packageType: "bottle",
			packCount: "1",
			blistersPerPack: "1",
			pillsPerBlister: "1",
			totalPills: "60",
			looseTablets: "60",
		});
		expect(liquidUpdater(baseForm)).toMatchObject({
			packageType: "liquid_container",
			packCount: "1",
			totalPills: "250",
			looseTablets: "250",
			packageAmountValue: "250",
			packageAmountUnit: "ml",
			medicationForm: "liquid",
		});
		expect(tubeUpdater(baseForm)).toMatchObject({
			packageType: "tube",
			packCount: "1",
			totalPills: "15",
			looseTablets: "15",
			packageAmountValue: "15",
			packageAmountUnit: "g",
			medicationForm: "topical",
		});
	});

	it("auto-applies the matching inline package option after enrich returns multi-package suggestions", async () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Ibuprofen",
						normalizedQuery: "ibuprofen",
						hasMore: false,
						results: [
							{
								code: "NDC-IBU",
								name: "Ibuprofen",
								genericName: "Ibuprofen",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "brand",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "openfda",
								packageOptions: [
									{
										label: "60 tablets in 1 bottle (00093-7424-56)",
										description: "60 tablets in 1 bottle (00093-7424-56)",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 60,
										looseTablets: 60,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
									{
										label: "250 mL in 1 bottle (00536-1167-01)",
										description: "250 mL in 1 bottle (00536-1167-01)",
										packageType: "liquid_container",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 250,
										looseTablets: 250,
										packageAmountValue: 250,
										packageAmountUnit: "ml",
									},
								],
							},
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						selection: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							therapeuticArea: null,
							indication: null,
							atcCode: null,
							source: "openfda",
						},
						suggestions: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							medicationForm: "tablet",
							strengthOptions: [],
							packageOptions: [
								{
									label: "60 tablets in 1 bottle",
									description: "60 tablets in 1 bottle",
									packageType: "bottle",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 60,
									looseTablets: 60,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
								{
									label: "250 mL in 1 bottle",
									description: "250 mL in 1 bottle",
									packageType: "liquid_container",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 250,
									looseTablets: 250,
									packageAmountValue: 250,
									packageAmountUnit: "ml",
								},
							],
						},
						meta: {
							rxNormMatched: false,
							openFdaMatched: true,
							partial: false,
							note: null,
						},
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Ibuprofen" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByRole("button", { name: "form.enrichment.details.showAction" });
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));
		fireEvent.click(getEnrichmentPackageButtons()[1]);

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/enrich", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "Ibuprofen",
					name: "Ibuprofen",
					genericName: "Ibuprofen",
					code: "NDC-IBU",
					source: "openfda",
				}),
			});
			expect(setForm).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Ibuprofen",
					genericName: "Ibuprofen",
					packageType: "liquid_container",
					packCount: "1",
					totalPills: "250",
					looseTablets: "250",
					packageAmountValue: "250",
					packageAmountUnit: "ml",
					medicationForm: "liquid",
				})
			);
		});

		expect(screen.getByText("form.enrichment.appliedPackage")).toBeInTheDocument();
		expect(getEnrichmentPackageButtons()).toHaveLength(2);
	});

	it("clears applied strength feedback when the enrichment package size is changed", async () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Ibuprofen",
						normalizedQuery: "ibuprofen",
						hasMore: false,
						results: [
							{
								code: "NDC-IBU-STRENGTH",
								name: "Ibuprofen",
								genericName: "Ibuprofen",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "brand",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "openfda",
								packageOptions: [
									{
										label: "60 tablets in 1 bottle (00093-7424-56)",
										description: "60 tablets in 1 bottle (00093-7424-56)",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 60,
										looseTablets: 60,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
									{
										label: "120 tablets in 1 bottle (00093-7424-57)",
										description: "120 tablets in 1 bottle (00093-7424-57)",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 120,
										looseTablets: 120,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
								],
							},
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						selection: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							therapeuticArea: null,
							indication: null,
							atcCode: null,
							source: "openfda",
						},
						suggestions: {
							name: "Ibuprofen",
							genericName: "Ibuprofen",
							medicationForm: "tablet",
							strengthOptions: [
								{ label: "200 mg", pillWeightMg: 200, doseUnit: "mg" },
								{ label: "400 mg", pillWeightMg: 400, doseUnit: "mg" },
							],
							packageOptions: [
								{
									label: "60 tablets in 1 bottle",
									description: "60 tablets in 1 bottle",
									packageType: "bottle",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 60,
									looseTablets: 60,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
								{
									label: "120 tablets in 1 bottle",
									description: "120 tablets in 1 bottle",
									packageType: "bottle",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 120,
									looseTablets: 120,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
							],
						},
						meta: {
							rxNormMatched: false,
							openFdaMatched: true,
							partial: false,
							note: null,
						},
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Ibuprofen" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByRole("button", { name: "form.enrichment.details.showAction" });
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));

		const initialPackageButtons = getEnrichmentPackageButtons();
		expect(initialPackageButtons).toHaveLength(2);
		fireEvent.click(initialPackageButtons[0]);

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/enrich", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "Ibuprofen",
					name: "Ibuprofen",
					genericName: "Ibuprofen",
					code: "NDC-IBU-STRENGTH",
					source: "openfda",
				}),
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "400 mg" }));
		expect(screen.getByText("form.enrichment.appliedStrength")).toBeInTheDocument();

		const activePackageButtons = getEnrichmentPackageButtons();
		expect(activePackageButtons).toHaveLength(2);
		fireEvent.click(activePackageButtons[1]);

		await waitFor(() => {
			expect(screen.queryByText("form.enrichment.appliedStrength")).not.toBeInTheDocument();
		});
		expect(screen.getByText("form.enrichment.appliedPackage")).toBeInTheDocument();
	});

	it("shows the selected package as pending while enrichment details are still loading", async () => {
		const setForm = vi.fn();
		let resolveEnrichment!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
		mockFormHookValue = createMockFormHook({ setForm });
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Ibuprofen",
						normalizedQuery: "ibuprofen",
						hasMore: false,
						results: [
							{
								code: "NDC-PENDING-PACKAGE",
								name: "Ibuprofen",
								genericName: "Ibuprofen",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "brand",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "openfda",
								packageOptions: [
									{
										label: "60 capsules in 1 bottle",
										description: "60 capsules in 1 bottle",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 60,
										looseTablets: 60,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
									{
										label: "90 capsules in 1 bottle",
										description: "90 capsules in 1 bottle",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 90,
										looseTablets: 90,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
								],
							},
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
					resolveEnrichment = resolve;
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Ibuprofen" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByRole("button", { name: "form.enrichment.details.showAction" });
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));
		await waitFor(() => {
			expect(getEnrichmentPackageButtons()).toHaveLength(2);
		});
		const packageButtons = getEnrichmentPackageButtons();
		fireEvent.click(packageButtons[0]);

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith("/api/medication-enrichment/enrich", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: "Ibuprofen",
					name: "Ibuprofen",
					genericName: "Ibuprofen",
					code: "NDC-PENDING-PACKAGE",
					source: "openfda",
				}),
			});
		});

		const pendingPackageButton = getEnrichmentPackageButtons()[0];
		expect(pendingPackageButton).toBeDisabled();
		expect(pendingPackageButton.querySelector(".medication-enrichment-spinner")).not.toBeNull();
		expect(screen.getByText("form.enrichment.applying")).toBeInTheDocument();

		resolveEnrichment({
			ok: true,
			json: async () => ({
				selection: {
					name: "Ibuprofen",
					genericName: "Ibuprofen",
					therapeuticArea: null,
					indication: null,
					atcCode: null,
					source: "openfda",
				},
				suggestions: {
					name: "Ibuprofen",
					genericName: "Ibuprofen",
					medicationForm: "capsule",
					strengthOptions: [{ label: "400 mg", pillWeightMg: 400, doseUnit: "mg" }],
					packageOptions: [
						{
							label: "60 capsules in 1 bottle",
							description: "60 capsules in 1 bottle",
							packageType: "bottle",
							packCount: 1,
							blistersPerPack: null,
							pillsPerBlister: null,
							totalPills: 60,
							looseTablets: 60,
							packageAmountValue: null,
							packageAmountUnit: null,
						},
					],
				},
				meta: {
					rxNormMatched: false,
					openFdaMatched: true,
					partial: false,
					note: null,
				},
			}),
		});

		await waitFor(() => {
			expect(screen.queryByText("form.enrichment.applying")).not.toBeInTheDocument();
			expect(screen.getByText("form.enrichment.appliedPackage")).toBeInTheDocument();
		});
	});

	it("auto-applies the correct blister package by structural match when multiple package variants exist", async () => {
		const setForm = vi.fn();
		mockFormHookValue = createMockFormHook({ setForm });
		fetchMock.mockImplementation((url: string) => {
			if (url.startsWith("/api/medication-enrichment/search?")) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						query: "Dimethyl fumarate",
						normalizedQuery: "dimethyl fumarate",
						hasMore: false,
						results: [
							{
								code: "NDC-DMF",
								name: "Dimethyl fumarate",
								genericName: "Dimethyl fumarate",
								authorisationHolder: null,
								therapeuticArea: null,
								matchType: "brand",
								genericStatus: "unknown",
								authorisationDate: null,
								source: "openfda",
								packageOptions: [
									{
										label: "14 blister packs in 1 carton / 14 capsules in 1 blister pack (31722-999-01)",
										description: "14 blister packs in 1 carton / 14 capsules in 1 blister pack (31722-999-01)",
										packageType: "blister",
										packCount: 1,
										blistersPerPack: 14,
										pillsPerBlister: 14,
										totalPills: 196,
										looseTablets: 0,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
									{
										label: "14 capsules in 1 bottle (31722-999-02)",
										description: "14 capsules in 1 bottle (31722-999-02)",
										packageType: "bottle",
										packCount: 1,
										blistersPerPack: null,
										pillsPerBlister: null,
										totalPills: 14,
										looseTablets: 14,
										packageAmountValue: null,
										packageAmountUnit: null,
									},
								],
							},
						],
					}),
				});
			}

			if (url === "/api/medication-enrichment/enrich") {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						selection: {
							name: "Dimethyl fumarate",
							genericName: "Dimethyl fumarate",
							therapeuticArea: null,
							indication: null,
							atcCode: null,
							source: "openfda",
						},
						suggestions: {
							name: "Dimethyl fumarate",
							genericName: "Dimethyl fumarate",
							medicationForm: "capsule",
							strengthOptions: [],
							packageOptions: [
								{
									label: "14 capsules in 1 bottle",
									description: "14 capsules in 1 bottle",
									packageType: "bottle",
									packCount: 1,
									blistersPerPack: null,
									pillsPerBlister: null,
									totalPills: 14,
									looseTablets: 14,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
								{
									label: "14 blister packs in 1 carton / 14 capsules in 1 blister pack",
									description: "14 blister packs in 1 carton / 14 capsules in 1 blister pack",
									packageType: "blister",
									packCount: 1,
									blistersPerPack: 14,
									pillsPerBlister: 14,
									totalPills: 196,
									looseTablets: 0,
									packageAmountValue: null,
									packageAmountUnit: null,
								},
							],
						},
						meta: {
							rxNormMatched: false,
							openFdaMatched: true,
							partial: false,
							note: null,
						},
					}),
				});
			}

			return Promise.resolve({ ok: true, json: async () => [] });
		});

		renderPage();
		openNewMedicationForm();

		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.toggleShow" }));
		fireEvent.change(screen.getByPlaceholderText("form.enrichment.searchPlaceholder"), {
			target: { value: "Dimethyl fumarate" },
		});
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.searchAction" }));

		await screen.findByRole("button", { name: "form.enrichment.details.showAction" });
		fireEvent.click(screen.getByRole("button", { name: "form.enrichment.details.showAction" }));
		fireEvent.click(getEnrichmentPackageButtons()[0]);

		await waitFor(() => {
			expect(setForm).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Dimethyl fumarate",
					genericName: "Dimethyl fumarate",
					medicationForm: "capsule",
					pillForm: "capsule",
					packageType: "blister",
					packCount: "1",
					blistersPerPack: "14",
					pillsPerBlister: "14",
					totalPills: "",
					looseTablets: "0",
				})
			);
		});

		expect(screen.getByText("form.enrichment.appliedPackage")).toBeInTheDocument();
	});

	it("shows liquid stock against configured multi-container capacity in the list", () => {
		const liquidMed = {
			...mockMeds[0],
			id: 2,
			name: "Liquid Multi",
			genericName: "Liquid Generic",
			packageType: "liquid_container" as const,
			packCount: 4,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			packageAmountValue: 150,
			packageAmountUnit: "ml" as const,
			totalPills: 450,
			looseTablets: 450,
		};
		mockContextValue = createMockContext({
			meds: [liquidMed],
			coverageByMed: {
				"Liquid Multi": { medsLeft: 450 },
			},
		});

		renderPage();

		expect(screen.getByText(/medications\.details\.stock: 450 \/ 600 ml/i)).toBeInTheDocument();
		expect(screen.queryByText(/medications\.details\.stock: 450 \/ 450 ml/i)).not.toBeInTheDocument();
	});

	it("shows bottle current stock against configured bottle capacity in the list", () => {
		const bottleMed = {
			...mockMeds[0],
			id: 3,
			name: "Bottle Capacity",
			packageType: "bottle" as const,
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 100,
			looseTablets: 20,
			stockAdjustment: 50,
		};
		mockContextValue = createMockContext({
			meds: [bottleMed],
			coverageByMed: {
				"Bottle Capacity": { medsLeft: 70 },
			},
		});

		renderPage();

		expect(screen.getByText(/medications\.details\.stock: 70 \/ 100 common\.pills/i)).toBeInTheDocument();
		expect(screen.queryByText(/medications\.details\.stock: 100 \/ 100 common\.pills/i)).not.toBeInTheDocument();
	});
});
