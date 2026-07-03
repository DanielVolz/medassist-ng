import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchedulePage } from "../../pages/SchedulePage";

const feedbackMock = vi.hoisted(() => ({ showFeedback: vi.fn() }));
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
		pillWeightMg: 500,
		imageUrl: null,
		updatedAt: null,
	},
];

// Fixed timestamp for consistent tests
const FIXED_TIMESTAMP = 1706000000000; // Fixed date for testing

const mockCoverageByMed = {
	Aspirin: {
		name: "Aspirin",
		medsLeft: 25,
		daysLeft: 25,
		depletionDate: "2025-02-15",
		depletionTime: FIXED_TIMESTAMP + 25 * 86400000,
		nextDose: null,
	},
};

const mockFutureDays = [
	{
		dateStr: "Mon, Jan 22",
		date: new Date(FIXED_TIMESTAMP),
		isPast: false,
		meds: [
			{
				medName: "Aspirin",
				total: 1,
				doses: [
					{
						id: `1-0-${FIXED_TIMESTAMP}`,
						timeStr: "09:00",
						when: FIXED_TIMESTAMP,
						usage: 1,
						takenBy: ["John"],
						intakeRemindersEnabled: true,
					},
				],
				lastWhen: FIXED_TIMESTAMP,
			},
		],
	},
];

function createFutureDoseDay(timestamp: number) {
	return [
		{
			dateStr: "Mon, Jan 22",
			date: new Date(timestamp),
			isPast: false,
			meds: [
				{
					medName: "Aspirin",
					total: 1,
					doses: [{ id: `1-0-${timestamp}`, timeStr: "09:00", when: timestamp, usage: 1, takenBy: ["John"] }],
					lastWhen: timestamp,
				},
			],
		},
	];
}

const mockPastDays = [
	{
		dateStr: "Sun, Jan 21",
		date: new Date(FIXED_TIMESTAMP - 86400000),
		isPast: true,
		meds: [
			{
				medName: "Aspirin",
				total: 1,
				doses: [
					{
						id: `1-0-${FIXED_TIMESTAMP - 86400000}`,
						timeStr: "09:00",
						when: FIXED_TIMESTAMP - 86400000,
						usage: 1,
						takenBy: ["John"],
					},
				],
				lastWhen: FIXED_TIMESTAMP - 86400000,
			},
		],
	},
];

const mockJournalEntry = {
	doseTrackingId: 1,
	doseId: `1-0-${FIXED_TIMESTAMP}-John`,
	medicationId: 1,
	medicationName: "Aspirin",
	scheduledFor: "2026-05-21T09:00:00.000Z",
	takenAt: "2026-05-21T09:05:00.000Z",
	dismissed: false,
	takenSource: "manual" as const,
	markedBy: "John",
	mood: null,
	note: "",
	updatedAt: null,
	createdAt: null,
};

// Factory function for mock context
const createMockContext = (overrides = {}) => ({
	meds: [],
	settings: {
		lowStockThreshold: 30,
		criticalStockThreshold: 7,
		expiryWarningDays: 30,
		lowStockDays: 7,
		normalStockDays: 30,
		highStockDays: 90,
	},
	scheduleDays: 30,
	setScheduleDays: vi.fn(),
	showPastDays: false,
	setShowPastDays: vi.fn(),
	pastDays: [],
	futureDays: [],
	takenDoses: new Set(),
	skippedDoses: new Set(),
	dismissedDoses: new Set(),
	markDoseTaken: vi.fn(),
	markDoseSkipped: vi.fn(),
	undoDoseTaken: vi.fn(),
	undoDoseSkipped: vi.fn(),
	coverageByMed: {},
	depletionByMed: {},
	manuallyExpandedDays: new Set(),
	toggleDayCollapse: vi.fn(),
	openUserFilter: vi.fn(),
	openScheduleLightbox: vi.fn(),
	isDoseTakenAutomatically: vi.fn(() => false),
	missedPastDoseIds: [],
	loadMeds: vi.fn(),
	...overrides,
});

let mockContextValue = createMockContext();

// Mock the context
vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({
		user: { id: 1, username: "testuser" },
		authFetch: authFetchMock,
	}),
}));

vi.mock("../../context/FeedbackContext", () => ({
	useFeedback: () => ({
		showFeedback: feedbackMock.showFeedback,
		dismissFeedback: vi.fn(),
		clearFeedback: vi.fn(),
	}),
}));

describe("SchedulePage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
		localStorage.clear();
		mockContextValue = createMockContext();
	});

	it("renders schedule page", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// Should render the schedule section
		const section = document.querySelector("section.grid");
		expect(section).toBeInTheDocument();
	});

	it("renders schedule title", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getByText(/dashboard\.schedules\.title/i)).toBeInTheDocument();
	});

	it("renders day range selector", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// Should have schedule days select dropdown
		const select = document.querySelector(".schedule-days-select");
		expect(select).toBeInTheDocument();
	});

	it("renders timeline section", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// Should have timeline div
		const timeline = document.querySelector(".timeline");
		expect(timeline).toBeInTheDocument();
	});

	it("disables the journal note action for untaken doses", () => {
		const openJournalEditor = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			coverageByMed: mockCoverageByMed,
			futureDays: mockFutureDays,
			openJournalEditor,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const noteButton = screen.getByRole("button", { name: "journal.actions.note" });
		expect(noteButton).toBeDisabled();
		expect(noteButton.closest("span")).not.toHaveAttribute("data-tooltip");

		fireEvent.click(noteButton);
		expect(openJournalEditor).not.toHaveBeenCalled();
	});

	it("shows empty state when no medications", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// With no meds, should show the schedule section but with empty timeline
		const card = document.querySelector(".schedule-full");
		expect(card).toBeInTheDocument();
	});

	it("renders card head", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getByRole("heading", { name: /dashboard\.schedules\.title/i })).toBeInTheDocument();
	});

	it("renders schedule days options", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const select = document.querySelector(".schedule-days-select");
		const options = select?.querySelectorAll("option");
		expect(options?.length).toBe(3);
	});

	it("has 30, 90, 180 day options", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getByText(/dashboard\.schedules\.1month/i)).toBeInTheDocument();
		expect(screen.getByText(/dashboard\.schedules\.3months/i)).toBeInTheDocument();
		expect(screen.getByText(/dashboard\.schedules\.6months/i)).toBeInTheDocument();
	});

	it("can change schedule days", () => {
		const setScheduleDays = vi.fn();
		mockContextValue = createMockContext({ setScheduleDays });

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const select = document.querySelector(".schedule-days-select") as HTMLSelectElement;
		expect(select).toBeInTheDocument();

		fireEvent.change(select, { target: { value: "90" } });
		expect(setScheduleDays).toHaveBeenCalledWith(90);
	});

	it("opens schedule lightbox when clicking a medication image", () => {
		const openScheduleLightbox = vi.fn();
		mockContextValue = createMockContext({
			meds: [{ ...mockMeds[0], imageUrl: "aspirin.png" }],
			coverageByMed: mockCoverageByMed,
			futureDays: mockFutureDays,
			openScheduleLightbox,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: "Aspirin" }));

		expect(openScheduleLightbox).toHaveBeenCalledWith("/api/images/aspirin.png");
	});

	it("posts the computed dismiss-until payload when clearing missed doses", async () => {
		const loadMeds = vi.fn();
		global.fetch = vi.fn().mockResolvedValue({ ok: true });

		mockContextValue = createMockContext({
			meds: mockMeds,
			coverageByMed: mockCoverageByMed,
			pastDays: mockPastDays,
			missedPastDoseIds: [`${mockPastDays[0].meds[0].doses[0].id}-John`],
			loadMeds,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: /dashboard\.schedules\.clearMissed/i }));
		fireEvent.click(screen.getByRole("button", { name: /dashboard\.schedules\.clearMissedConfirm/i }));

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith(
				"/api/medications/dismiss-until",
				expect.objectContaining({
					method: "POST",
				})
			);
		});

		const body = JSON.parse(((authFetchMock as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body as string) ?? "{}");
		expect(body).toEqual({
			medicationIds: [1],
			until: mockPastDays[0].date.toISOString().slice(0, 10),
		});
		expect(loadMeds).toHaveBeenCalled();
		expect(feedbackMock.showFeedback).toHaveBeenCalledWith({
			message: expect.stringContaining("dashboard.schedules.clearMissedSuccess"),
			tone: "success",
		});
	});
});

describe("SchedulePage structure", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext();
	});

	it("has heading element", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const heading = document.querySelector("h2");
		expect(heading).toBeInTheDocument();
	});

	it("renders article element", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(document.querySelector(".schedule-full")).toBeInTheDocument();
	});

	it("renders section element", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const section = document.querySelector("section");
		expect(section).toBeInTheDocument();
	});

	it("renders card with correct class", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const card = document.querySelector(".schedule-full");
		expect(card).toBeInTheDocument();
	});
});

describe("SchedulePage with medications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			depletionByMed: { Aspirin: Date.now() + 25 * 86400000 },
		});
	});

	it("renders medication in timeline", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getByText("Aspirin")).toBeInTheDocument();
	});

	it("renders day block", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const dayBlocks = document.querySelectorAll(".day-block");
		expect(dayBlocks.length).toBeGreaterThan(0);
	});

	it("renders dose item", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const doseItems = document.querySelectorAll(".dose-item");
		expect(doseItems.length).toBeGreaterThan(0);
	});

	it("renders take button", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const takeBtn = screen.getByRole("button", { name: "dose.take" });
		expect(takeBtn).toBeInTheDocument();
	});

	it("calls markDoseTaken when clicking take button", () => {
		const markDoseTaken = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			markDoseTaken,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: "dose.take" }));
		expect(markDoseTaken).toHaveBeenCalled();
	});

	it("renders person name for dose", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getAllByText("John").length).toBeGreaterThan(0);
	});

	it("calls openUserFilter when clicking person name", () => {
		const openUserFilter = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			openUserFilter,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const personName = screen.getAllByRole("button", { name: "John" })[0] as HTMLElement;
		fireEvent.click(personName);
		expect(openUserFilter).toHaveBeenCalledWith("John");
	});

	it("renders pill weight when available", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// Aspirin has pillWeightMg of 500
		expect(screen.getByText(/500 mg/)).toBeInTheDocument();
	});

	it("renders reminder icon when enabled", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// Aspirin has intakeRemindersEnabled
		const reminderIcon = document.querySelector(".reminder-icon");
		expect(reminderIcon).toBeInTheDocument();
	});

	it("renders day blocks", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// Should have day blocks rendered
		const dayBlocks = document.querySelectorAll(".day-block");
		expect(dayBlocks.length).toBeGreaterThan(0);
	});
});

describe("SchedulePage with past days", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({
			meds: mockMeds,
			pastDays: mockPastDays,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			showPastDays: false,
			missedPastDoseIds: [`1-0-${Date.now() - 86400000}-John`], // One missed dose
		});
	});

	it("renders past days toggle when past days exist", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const toggle = document.querySelector(".past-days-toggle");
		expect(toggle).toBeInTheDocument();
	});

	it("shows missed doses warning", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const warning = document.querySelector(".past-days-warning");
		expect(warning).toBeInTheDocument();
	});

	it("toggles past days visibility", () => {
		const setShowPastDays = vi.fn();
		mockContextValue = createMockContext({
			pastDays: mockPastDays,
			showPastDays: false,
			setShowPastDays,
			missedPastDoseIds: [],
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const toggle = document.querySelector(".past-days-toggle");
		if (toggle) {
			fireEvent.click(toggle);
			expect(setShowPastDays).toHaveBeenCalledWith(true);
		}
	});

	it("collapses past days when already expanded", () => {
		const setShowPastDays = vi.fn();
		mockContextValue = createMockContext({
			pastDays: mockPastDays,
			showPastDays: true,
			setShowPastDays,
			missedPastDoseIds: [],
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const toggle = document.querySelector(".past-days-toggle");
		if (toggle) {
			fireEvent.click(toggle);
			expect(setShowPastDays).toHaveBeenCalledWith(false);
		}
	});
});

describe("SchedulePage with expanded past days", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({
			meds: mockMeds,
			pastDays: mockPastDays,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			showPastDays: true,
			manuallyExpandedDays: new Set(["Sun, Jan 21"]),
		});
	});

	it("renders past day blocks when showPastDays is true", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const pastDayBlocks = document.querySelectorAll(".day-block.past");
		expect(pastDayBlocks.length).toBeGreaterThan(0);
	});

	it("renders day divider for past days", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const dividers = document.querySelectorAll(".day-divider");
		expect(dividers.length).toBeGreaterThan(0);
	});

	it("calls toggleDayCollapse when clicking day divider", () => {
		const toggleDayCollapse = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			pastDays: mockPastDays,
			showPastDays: true,
			manuallyExpandedDays: new Set(["Sun, Jan 21"]),
			coverageByMed: mockCoverageByMed,
			toggleDayCollapse,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const divider = document.querySelector(".day-block.past .day-divider.clickable");
		if (divider) {
			fireEvent.click(divider);
			expect(toggleDayCollapse).toHaveBeenCalled();
		}
	});
});

describe("SchedulePage with taken doses", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		// Match the dose ID format exactly with the mockFutureDays dose
		// Since we can't predict Date.now(), we make the test check if takenDoses works
	});

	it("marks doses as taken in UI", () => {
		// Create consistent timestamp for test
		const timestamp = Date.now();
		const doseId = `1-0-${timestamp}-John`;

		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: createFutureDoseDay(timestamp),
			coverageByMed: mockCoverageByMed,
			takenDoses: new Set([doseId]),
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		// When dose is taken, the undo button should appear
		const undoBtn = screen.getByRole("button", { name: "common.undo" });
		expect(undoBtn).toBeInTheDocument();
	});

	it("calls undoDoseTaken when clicking undo button", () => {
		const undoDoseTaken = vi.fn();
		const timestamp = Date.now();
		const doseId = `1-0-${timestamp}-John`;

		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: createFutureDoseDay(timestamp),
			coverageByMed: mockCoverageByMed,
			takenDoses: new Set([doseId]),
			undoDoseTaken,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: "common.undo" }));
		expect(undoDoseTaken).toHaveBeenCalled();
	});
});

describe("SchedulePage skip behavior", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
		});
	});

	it("shows a skip action alongside take for neutral doses", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getByRole("button", { name: "dose.take" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "dose.skip" })).toBeInTheDocument();
	});

	it("calls markDoseSkipped when clicking skip", () => {
		const markDoseSkipped = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			markDoseSkipped,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const skipButton = screen.getByRole("button", { name: "dose.skip" });
		expect(skipButton).toBeInTheDocument();

		fireEvent.click(skipButton);

		expect(markDoseSkipped).toHaveBeenCalledWith(`1-0-${FIXED_TIMESTAMP}-John`);
	});

	it("renders undo skip state for skipped doses", () => {
		const skippedDoseId = `1-0-${FIXED_TIMESTAMP}-John`;
		const openJournalEditor = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			skippedDoses: new Set([skippedDoseId]),
			openJournalEditor,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		expect(screen.getByRole("button", { name: "common.undo" })).toBeInTheDocument();
		expect(screen.getByText("John", { selector: ".person-name" }).closest(".dose-person")).toHaveClass("skipped");
		const noteButton = screen.getByRole("button", { name: "journal.actions.note" });
		expect(noteButton).not.toBeDisabled();

		fireEvent.click(noteButton);
		expect(openJournalEditor).toHaveBeenCalledWith(skippedDoseId);
	});

	it("closes the journal editor after saving a main app note", async () => {
		const saveJournalNote = vi.fn(async () => true);
		const closeJournalEditor = vi.fn();
		mockContextValue = createMockContext({
			journalEditorOpen: true,
			journalEvent: mockJournalEntry,
			journalEventLoading: false,
			journalEventSaving: false,
			journalEventDeleting: false,
			journalEventError: null,
			saveJournalNote,
			closeJournalEditor,
			deleteJournalNote: vi.fn(),
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		fireEvent.change(screen.getByLabelText("journal.editor.noteLabel"), {
			target: { value: "Main app note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "common.save" }));

		await waitFor(() => {
			expect(saveJournalNote).toHaveBeenCalledWith("Main app note", null);
			expect(closeJournalEditor).toHaveBeenCalled();
		});
	});

	it("calls undoDoseSkipped when clicking undo skip", () => {
		const skippedDoseId = `1-0-${FIXED_TIMESTAMP}-John`;
		const undoDoseSkipped = vi.fn();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: mockCoverageByMed,
			skippedDoses: new Set([skippedDoseId]),
			undoDoseSkipped,
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const undoSkipButton = screen.getByRole("button", { name: "common.undo" });
		expect(undoSkipButton).toBeInTheDocument();

		fireEvent.click(undoSkipButton);

		expect(undoDoseSkipped).toHaveBeenCalledWith(skippedDoseId);
	});

	it("does not mark skipped due doses as overdue", () => {
		vi.useFakeTimers();
		const now = new Date("2026-01-22T12:00:00.000Z");
		vi.setSystemTime(now);

		const when = new Date("2026-01-22T09:00:00.000Z").getTime();
		const baseDoseId = `1-0-${when}`;
		const skippedDoseId = `${baseDoseId}-John`;
		const dueDay = [
			{
				dateStr: "Wed, Jan 22",
				date: new Date(now),
				isPast: false,
				meds: [
					{
						medName: "Aspirin",
						total: 1,
						doses: [{ id: baseDoseId, timeStr: "09:00", when, usage: 1, takenBy: ["John"] }],
						lastWhen: when,
					},
				],
			},
		];

		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: dueDay,
			coverageByMed: mockCoverageByMed,
			skippedDoses: new Set([skippedDoseId]),
		});

		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const personRow = screen.getByText("John", { selector: ".person-name" }).closest(".dose-person");
		expect(personRow).toHaveClass("skipped");
		expect(personRow).not.toHaveClass("overdue");

		vi.useRealTimers();
	});
});

describe("SchedulePage with low stock", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockContext({
			meds: mockMeds,
			futureDays: mockFutureDays,
			coverageByMed: {
				Aspirin: {
					name: "Aspirin",
					medsLeft: 3,
					daysLeft: 3,
					depletionDate: "2025-01-25",
					depletionTime: Date.now() + 3 * 86400000,
					nextDose: null,
				},
			},
			depletionByMed: { Aspirin: Date.now() + 3 * 86400000 },
		});
	});

	it("shows status tag for medications", () => {
		render(
			<MemoryRouter>
				<SchedulePage />
			</MemoryRouter>
		);

		const tags = document.querySelectorAll(".tag");
		expect(tags.length).toBeGreaterThan(0);
	});
});
