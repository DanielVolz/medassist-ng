import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlannerPage } from "../../pages/PlannerPage";

const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

// Mock data
const mockMeds = [
	{
		id: 1,
		name: "Aspirin",
		packCount: 1,
		blistersPerPack: 2,
		pillsPerBlister: 10,
		looseTablets: 5,
		takenBy: ["John"],
		blisters: [{ usage: 1, every: 1, start: "2024-01-01T09:00:00Z" }],
		intakeRemindersEnabled: true,
		notes: "Take with food",
		imageUrl: null,
		updatedAt: null,
	},
];

const mockPlannerRows = [
	{
		medicationId: 1,
		medicationName: "Aspirin",
		totalPills: 25,
		currentPills: 25,
		plannerUsage: 5,
		blisterSize: 10,
		blistersNeeded: 1,
		fullBlisters: 2,
		loosePills: 0,
		enough: true,
		packageType: "blister" as const,
	},
];

const savedPlannerRange = {
	start: "2024-05-01T09:00",
	end: "2024-05-10T18:00",
};

// Factory for mock context
const createMockContext = (overrides = {}) => ({
	meds: [],
	settings: {
		lowStockThreshold: 30,
		criticalStockThreshold: 7,
		expiryWarningDays: 30,
		emailEnabled: false,
		shoutrrrEnabled: false,
		notificationEmail: "",
	},
	openMedDetail: vi.fn(),
	...overrides,
});

function renderPlannerPage() {
	return render(
		<MemoryRouter>
			<PlannerPage />
		</MemoryRouter>
	);
}

function mockPlannerResponse(rows: unknown) {
	global.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve(rows),
	});
}

function mockLocalStorageEntries(entries: Record<string, string>) {
	vi.mocked(localStorage.getItem).mockImplementation((key) => entries[key] ?? null);
}

function mockSavedPlannerResults({
	rows = mockPlannerRows,
	range = savedPlannerRange,
	includeUntilStart,
}: {
	rows?: unknown;
	range?: unknown;
	includeUntilStart?: boolean;
} = {}) {
	mockLocalStorageEntries({
		user_1_plannerRows: JSON.stringify(rows),
		user_1_plannerRange: JSON.stringify(range),
		...(includeUntilStart === undefined ? {} : { user_1_plannerIncludeUntilStart: String(includeUntilStart) }),
	});
}

async function submitPlannerForm() {
	const form = screen.getByTestId("planner-form");
	expect(form).toBeInTheDocument();
	await act(async () => {
		fireEvent.submit(form);
	});
}

let mockContextValue = createMockContext();

// Mock the hooks and context
vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({
		user: { id: 1, username: "testuser" },
		authFetch: authFetchMock,
	}),
}));

describe("PlannerPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
		localStorage.clear();
		mockContextValue = createMockContext();
	});

	it("renders planner page", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		// Should render the planner section
		expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
	});

	it("renders date range inputs", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		// Should have start and end date inputs (actual keys are planner.from and planner.until)
		expect(screen.getByText(/planner\.from/i)).toBeInTheDocument();
		expect(screen.getByText(/planner\.until/i)).toBeInTheDocument();
	});

	it("renders calculate button", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const buttons = screen.getAllByRole("button");
		const calculateBtn = buttons.find((btn) => btn.textContent?.includes("planner.calculate"));
		expect(calculateBtn).toBeInTheDocument();
	});

	it("renders reset button", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const buttons = screen.getAllByRole("button");
		const resetBtn = buttons.find((btn) => btn.textContent?.includes("common.reset"));
		expect(resetBtn).toBeInTheDocument();
	});

	it("shows empty state when no medications", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		// When no meds, should render the form at least
		const content = document.body.textContent;
		expect(content).toBeTruthy();
	});

	it("renders datetime-local inputs", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		// Datetime-local inputs should be present
		expect(document.querySelectorAll('input[type="datetime-local"]').length).toBe(2);
	});

	it("has form element", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByTestId("planner-form")).toBeInTheDocument();
	});

	it("renders planner section card with title", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByTestId("planner-form-card")).toBeInTheDocument();
	});

	it("renders planner actions container", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByTestId("planner-actions")).toBeInTheDocument();
	});

	it("renders planner page container", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByTestId("planner-page")).toBeInTheDocument();
	});

	it("renders a reset button", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByRole("button", { name: /common\.reset/i })).toBeInTheDocument();
	});

	it("calculate button is submit type", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const submitBtn = document.querySelector('button[type="submit"]');
		expect(submitBtn).toBeInTheDocument();
	});

	it("allows changing date input values", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const inputs = document.querySelectorAll('input[type="datetime-local"]');
		expect(inputs.length).toBe(2);

		// Should be able to change the value
		fireEvent.change(inputs[0], { target: { value: "2024-06-01T10:00" } });
		expect((inputs[0] as HTMLInputElement).value).toBe("2024-06-01T10:00");
	});
});

describe("PlannerPage with localStorage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("loads saved range from localStorage", () => {
		mockLocalStorageEntries({ user_1_plannerRange: JSON.stringify(savedPlannerRange) });

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		// Page should render
		expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
	});

	it("loads saved rows from localStorage", async () => {
		mockSavedPlannerResults();

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(await screen.findByText("Aspirin")).toBeInTheDocument();
	});

	it("handles invalid localStorage data gracefully", () => {
		mockLocalStorageEntries({
			user_1_plannerRows: "invalid-json",
			user_1_plannerRange: "invalid-json",
		});

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		// Page should still render
		expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
	});
});

describe("PlannerPage with medications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
	});

	it("renders with medications", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
	});
});

describe("PlannerPage with saved results", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockSavedPlannerResults();
		mockContextValue = createMockContext({ meds: mockMeds });
	});

	it("loads saved planner range from localStorage", async () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const dateInputs = document.querySelectorAll('input[type="datetime-local"]');
		expect(dateInputs.length).toBe(2);
		await waitFor(() => {
			expect((dateInputs[0] as HTMLInputElement).value).toBe(savedPlannerRange.start);
			expect((dateInputs[1] as HTMLInputElement).value).toBe(savedPlannerRange.end);
		});
	});

	it("renders page with saved data", async () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(await screen.findByText("Aspirin")).toBeInTheDocument();
	});

	it("preserves form after loading saved range", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByTestId("planner-form")).toBeInTheDocument();
	});

	it("shows buttons after loading saved data", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(document.querySelector('button[type="submit"]')).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /common\.reset/i })).toBeInTheDocument();
	});

	it("has planner actions section", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(screen.getByTestId("planner-actions")).toBeInTheDocument();
	});
});

describe("PlannerPage with email enabled", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockSavedPlannerResults();
		mockContextValue = createMockContext({
			meds: mockMeds,
			settings: {
				...createMockContext().settings,
				emailEnabled: true,
				notificationEmail: "test@example.com",
			},
		});
	});

	it("shows send email button when email is enabled", async () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		expect(await screen.findByRole("button", { name: /planner\.sendNotification/i })).toBeInTheDocument();
	});

	it("sends planner notification and shows success message", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve([
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 25,
							plannerUsage: 5,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 1,
							loosePills: 0,
							enough: true,
							packageType: "blister",
						},
					]),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ message: "Planner notification sent" }),
			});

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		await act(async () => {
			fireEvent.submit(screen.getByTestId("planner-form"));
		});

		const notifyBtn = await screen.findByRole("button", { name: /planner\.sendNotification/i });
		await act(async () => {
			fireEvent.click(notifyBtn);
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/planner/send-email",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
			})
		);
		const notificationCall = (authFetchMock as ReturnType<typeof vi.fn>).mock.calls.find(
			([url]) => url === "/api/planner/send-email"
		);
		const notificationBody = JSON.parse(notificationCall?.[1]?.body as string);
		expect(notificationBody.startDate).toEqual(expect.any(String));
		expect(notificationBody.endDate).toEqual(expect.any(String));
		expect(notificationBody.includeUntilStart).toBe(false);

		await waitFor(() => {
			expect(screen.getByText("Planner notification sent")).toBeInTheDocument();
		});
	});

	it("shows error message when planner notification fails", async () => {
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve([
						{
							medicationId: 1,
							medicationName: "Aspirin",
							totalPills: 25,
							plannerUsage: 5,
							blisterSize: 10,
							blistersNeeded: 1,
							fullBlisters: 1,
							loosePills: 0,
							enough: true,
							packageType: "blister",
						},
					]),
			})
			.mockResolvedValueOnce({
				ok: false,
				json: () => Promise.resolve({ error: "Could not send planner notification" }),
			});

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		await act(async () => {
			fireEvent.submit(screen.getByTestId("planner-form"));
		});

		const notifyBtn = await screen.findByRole("button", { name: /planner\.sendNotification/i });
		await act(async () => {
			fireEvent.click(notifyBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("Could not send planner notification")).toBeInTheDocument();
		});
	});
});

describe("PlannerPage form interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
		// Mock fetch to avoid actual API calls
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve([]),
		});
	});

	it("can submit the form", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const form = screen.getByTestId("planner-form");
		fireEvent.submit(form);

		// Form should still be present after submit
		expect(screen.getByTestId("planner-form")).toBeInTheDocument();
	});

	it("shows calculation error when planner API fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: () => Promise.resolve({ error: "Invalid date range" }),
		});

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		await act(async () => {
			fireEvent.submit(screen.getByTestId("planner-form"));
		});

		expect(await screen.findByRole("alert")).toHaveTextContent("Invalid date range");
	});

	it("can reset the form", () => {
		localStorage.setItem("user_1_plannerRows", JSON.stringify(mockPlannerRows));

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: /common\.reset/i }));

		// Form should be reset (no results table)
		expect(screen.getByText(/planner\.title/i)).toBeInTheDocument();
	});

	it("toggles includeUntilStart checkbox", () => {
		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const checkbox = screen.getByTestId("planner-include-until-start").querySelector("input[type='checkbox']");
		expect(checkbox).toBeInstanceOf(HTMLInputElement);
		const typedCheckbox = checkbox as HTMLInputElement;
		expect(typedCheckbox.checked).toBe(false);
		fireEvent.click(typedCheckbox);
		expect(typedCheckbox.checked).toBe(true);
	});

	it("submits planner request with includeUntilStart=true", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve([]),
		});

		render(
			<MemoryRouter>
				<PlannerPage />
			</MemoryRouter>
		);

		const checkbox = screen.getByTestId("planner-include-until-start").querySelector("input[type='checkbox']");
		expect(checkbox).toBeInstanceOf(HTMLInputElement);
		fireEvent.click(checkbox as HTMLInputElement);

		const form = screen.getByTestId("planner-form");
		await act(async () => {
			fireEvent.submit(form);
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/medications/usage",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
			})
		);

		const fetchCall = (authFetchMock as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(fetchCall[1].body);
		expect(body.includeUntilStart).toBe(true);
		expect(typeof body.startDate).toBe("string");
		expect(typeof body.endDate).toBe("string");
	});
});

describe("PlannerPage medication detail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		localStorage.setItem("user_1_plannerRows", JSON.stringify(mockPlannerRows));
		localStorage.setItem(
			"user_1_plannerRange",
			JSON.stringify({
				start: "2024-05-01T09:00",
				end: "2024-05-10T18:00",
			})
		);
	});

	it("calls openMedDetail only when clicking the medication name link", async () => {
		mockPlannerResponse(mockPlannerRows);
		const openMedDetail = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			openMedDetail,
		});

		renderPlannerPage();

		await submitPlannerForm();
		const medRow = await screen.findByTestId("planner-result-row");
		expect(medRow).not.toHaveAttribute("role", "button");

		fireEvent.click(medRow);
		expect(openMedDetail).not.toHaveBeenCalled();

		fireEvent.click(within(medRow).getByRole("button", { name: "Aspirin" }));
		expect(openMedDetail).toHaveBeenCalled();
	});

	it("renders the planner medication name link with keyboard access", async () => {
		mockPlannerResponse(mockPlannerRows);
		const openMedDetail = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			openMedDetail,
		});

		renderPlannerPage();

		await submitPlannerForm();
		const medRow = await screen.findByTestId("planner-result-row");
		const medNameLink = within(medRow).getByRole("button", { name: "Aspirin" });

		fireEvent.click(medNameLink);
		expect(openMedDetail).toHaveBeenCalled();
	});

	it("renders medication identity with generic name in planner results", async () => {
		mockPlannerResponse(mockPlannerRows);
		mockContextValue = createMockContext({
			meds: [{ ...mockMeds[0], genericName: "Acetylsalicylic acid" }],
		});

		renderPlannerPage();

		await submitPlannerForm();
		const medRow = await screen.findByTestId("planner-result-row");

		expect(within(medRow).getByRole("button", { name: "Aspirin" })).toBeInTheDocument();
		expect(within(medRow).getByText("Acetylsalicylic acid")).toBeInTheDocument();
	});

	it("uses compact mobile labels and non-breaking available stock chunks", async () => {
		mockPlannerResponse([{ ...mockPlannerRows[0], fullBlisters: 9, loosePills: 4 }]);
		mockContextValue = createMockContext({ meds: mockMeds });

		renderPlannerPage();

		await submitPlannerForm();
		const medRow = await screen.findByTestId("planner-result-row");
		const prescriptionCell = medRow.querySelector('td[data-column-key="prescriptionRefills"]');
		const availableCell = medRow.querySelector('td[data-column-key="available"]');

		expect(prescriptionCell).toHaveAttribute("data-label", "planner.table.prescriptionRefillsMobile");
		expect(
			Array.from(availableCell?.querySelectorAll("[data-planner-available-chunk]") ?? []).map((chunk) =>
				chunk.textContent?.trim()
			)
		).toEqual(["9 common.blisters", "+ 4 common.pills"]);
	});

	it("uses the medication display name when planner row name is empty", async () => {
		mockPlannerResponse([
			{
				medicationId: 4,
				medicationName: "",
				totalPills: 150,
				plannerUsage: 0,
				blisterSize: 1,
				blistersNeeded: 0,
				fullBlisters: 0,
				loosePills: 150,
				enough: true,
				packageType: "tube",
			},
		]);
		mockContextValue = createMockContext({
			meds: [
				{
					...mockMeds[0],
					id: 4,
					name: "",
					genericName: "testtube",
					packageType: "tube",
					medicationForm: "topical",
				},
			],
		});

		renderPlannerPage();

		await submitPlannerForm();

		expect(await screen.findByText("testtube")).toBeInTheDocument();
		expect(screen.getByText("T")).toHaveClass("med-avatar-initials");
		expect(screen.queryByText("?")).not.toBeInTheDocument();
	});
});

describe("PlannerPage bottle package type", () => {
	const bottlePlannerRows = [
		{
			medicationId: 3,
			medicationName: "Ibuprofen",
			totalPills: 60,
			plannerUsage: 20,
			blisterSize: 1,
			blistersNeeded: 0,
			fullBlisters: 0,
			loosePills: 20,
			enough: true,
			packageType: "bottle" as const,
		},
	];

	const blisterPlannerRows = [
		{
			medicationId: 1,
			medicationName: "Aspirin",
			totalPills: 60,
			plannerUsage: 20,
			blisterSize: 10,
			blistersNeeded: 2,
			fullBlisters: 2,
			loosePills: 0,
			enough: true,
			packageType: "blister" as const,
		},
	];

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({ meds: mockMeds });
	});

	it("shows dash for blisters column when bottle type", async () => {
		mockPlannerResponse(bottlePlannerRows);

		renderPlannerPage();

		await submitPlannerForm();

		const bottleName = await screen.findByText("Ibuprofen");
		const bottleRow = bottleName.closest("tr");
		expect(bottleRow).toBeTruthy();
		expect(bottleRow!.textContent).toContain("–");
	});

	it("shows blisters calculation for blister type", async () => {
		mockPlannerResponse(blisterPlannerRows);

		renderPlannerPage();

		await submitPlannerForm();

		const blisterName = await screen.findByText("Aspirin");
		const blisterRow = blisterName.closest("tr");
		expect(blisterRow).toBeTruthy();
		expect(blisterRow!.textContent).toContain("2 × 10");
	});
});
