import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DashboardPage,
	formatFullBlisters,
	formatOpenBlisterAndLoose,
	getBlisterStock,
	getMedTotal,
	getReminderStatusData,
	userStorageKey,
} from "../../pages/DashboardPage";

// Mock data for tests with medications
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
		expiryDate: "2025-12-31",
		imageUrl: null,
		updatedAt: null,
	},
	{
		id: 2,
		name: "Vitamin D",
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

const mockCoverage = {
	all: [
		{
			name: "Aspirin",
			medsLeft: 25,
			daysLeft: 25,
			depletionDate: "2025-02-15",
			depletionTime: Date.now() + 25 * 86400000,
			nextDose: null,
		},
		{
			name: "Vitamin D",
			medsLeft: 3,
			daysLeft: 3,
			depletionDate: "2025-01-25",
			depletionTime: Date.now() + 3 * 86400000,
			nextDose: null,
		},
	],
	low: [
		{
			name: "Vitamin D",
			medsLeft: 3,
			daysLeft: 3,
			depletionDate: "2025-01-25",
			depletionTime: Date.now() + 3 * 86400000,
			nextDose: null,
		},
	],
};

const mockFutureDays = [
	{
		dateStr: "Mon, Jan 22",
		date: new Date(),
		isPast: false,
		meds: [
			{
				medName: "Aspirin",
				total: 1,
				doses: [{ id: `1-0-${Date.now()}`, timeStr: "09:00", when: Date.now(), usage: 1, takenBy: ["John"] }],
				lastWhen: Date.now(),
			},
		],
	},
];

const mockPastDays = [
	{
		dateStr: "Sun, Jan 21",
		date: new Date(Date.now() - 86400000),
		isPast: true,
		meds: [
			{
				medName: "Aspirin",
				total: 1,
				doses: [
					{
						id: `1-0-${Date.now() - 86400000}`,
						timeStr: "09:00",
						when: Date.now() - 86400000,
						usage: 1,
						takenBy: ["John"],
					},
				],
				lastWhen: Date.now() - 86400000,
			},
		],
	},
];

// Default mock factory
const createMockAppContext = (overrides = {}) => ({
	meds: [],
	settings: {
		lowStockThreshold: 30,
		criticalStockThreshold: 7,
		expiryWarningDays: 30,
		lowStockDays: 7,
		normalStockDays: 30,
		highStockDays: 90,
		emailEnabled: false,
		shoutrrrEnabled: false,
		reminderDaysBefore: 7,
		notificationEmail: "",
		lastAutoEmailSent: null,
		lastNotificationType: null,
		lastNotificationChannel: null,
	},
	scheduleDays: 30,
	setScheduleDays: vi.fn(),
	showPastDays: false,
	setShowPastDays: vi.fn(),
	pastDays: [],
	todayDay: null,
	futureDays: [],
	takenDoses: new Set(),
	dismissedDoses: new Set(),
	markDoseTaken: vi.fn(),
	undoDoseTaken: vi.fn(),
	coverage: { all: [], low: [] },
	coverageByMed: {},
	depletionByMed: {},
	stockThresholds: {
		lowStockDays: 7,
		normalStockDays: 30,
		highStockDays: 90,
		criticalStockDays: 7,
		expiryWarningDays: 30,
	},
	manuallyExpandedDays: new Set(),
	manuallyCollapsedDays: new Set(),
	toggleDayCollapse: vi.fn(),
	openMedDetail: vi.fn(),
	openUserFilter: vi.fn(),
	openShareDialog: vi.fn(),
	openScheduleLightbox: vi.fn(),
	missedPastDoseIds: [],
	getDayStockStatus: vi.fn(() => "success"),
	getDoseId: vi.fn((id, person) => (person ? `${id}-${person}` : id)),
	showClearMissedConfirm: false,
	setShowClearMissedConfirm: vi.fn(),
	clearingMissed: false,
	dismissMissedDoses: vi.fn(),
	loadSettings: vi.fn(),
	...overrides,
});

let mockContextValue = createMockAppContext();

describe("DashboardPage helper functions", () => {
	it("builds user storage key correctly", () => {
		expect(userStorageKey(5, "scheduleDays")).toBe("user_5_scheduleDays");
		expect(userStorageKey(undefined, "scheduleDays")).toBe("scheduleDays");
	});

	it("calculates blister stock breakdown", () => {
		expect(getBlisterStock(27, 10, 0, 27)).toEqual({ fullBlisters: 2, openBlisterPills: 7, loosePills: 7 });
	});

	it("formats blister and open blister labels", () => {
		const t = (key: string) => key;
		expect(formatFullBlisters(1, t)).toBe("1 common.blister");
		expect(formatFullBlisters(3, t)).toBe("3 common.blisters");
		expect(formatOpenBlisterAndLoose(0, 0, 10, t)).toBe("-");
		expect(formatOpenBlisterAndLoose(4, 4, 10, t)).toBe("4 common.of 10 common.pills");
	});

	it("computes total pills for blister and bottle types", () => {
		expect(
			getMedTotal({
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 2,
				pillsPerBlister: 10,
				looseTablets: 3,
				stockAdjustment: 2,
			})
		).toBe(25);

		expect(
			getMedTotal({
				packageType: "bottle",
				packCount: 0,
				blistersPerPack: 1,
				pillsPerBlister: 1,
				looseTablets: 50,
				stockAdjustment: -3,
			})
		).toBe(47);
	});

	it("builds reminder status data for critical and history rows", () => {
		const t = (key: string) => key;
		const result = getReminderStatusData(
			7,
			30,
			[{ name: "A", daysLeft: 2, medsLeft: 1, depletionDate: null, depletionTime: null, nextDose: null }],
			[
				{ name: "A", daysLeft: 2, medsLeft: 1, depletionDate: null, depletionTime: null, nextDose: null },
				{ name: "B", daysLeft: 10, medsLeft: 4, depletionDate: null, depletionTime: null, nextDose: null },
			],
			"2026-01-01T10:00:00.000Z",
			"intake",
			"email",
			"A",
			"Max",
			"2026-01-01T09:00:00.000Z",
			"both",
			"A (+1)",
			t,
			"en-US"
		);

		expect(result.status.className).toBe("danger");
		expect(result.lowStockMeds.length).toBe(2);
		expect(result.lastStockSent).not.toBeNull();
		expect(result.lastIntakeSent?.medName).toBe("A");
	});

	it("builds warning and success reminder statuses", () => {
		const t = (key: string) => key;

		const warning = getReminderStatusData(
			7,
			30,
			[],
			[{ name: "C", daysLeft: 12, medsLeft: 10, depletionDate: null, depletionTime: null, nextDose: null }],
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			t,
			"en-US"
		);
		expect(warning.status.className).toBe("warning");

		const success = getReminderStatusData(
			7,
			30,
			[],
			[{ name: "D", daysLeft: 40, medsLeft: 10, depletionDate: null, depletionTime: null, nextDose: null }],
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			t,
			"en-US"
		);
		expect(success.status.className).toBe("success");
		expect(success.lastStockSent).toBeNull();
		expect(success.lastIntakeSent).toBeNull();
	});
});

// Mock the context
vi.mock("../../context", () => ({
	useAppContext: () => mockContextValue,
}));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({
		user: { id: 1, username: "testuser" },
	}),
}));

describe("DashboardPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext();
	});

	it("renders dashboard page", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should render the dashboard section
		const section = document.querySelector("section.grid");
		expect(section).toBeInTheDocument();
	});

	it("renders reorder section title", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/dashboard\.reorder\.title/i)).toBeInTheDocument();
	});

	it("renders overview section title", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/dashboard\.overview\.title/i)).toBeInTheDocument();
	});

	it("renders schedule section title", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/dashboard\.schedules\.title/i)).toBeInTheDocument();
	});

	it("renders empty state when no medications", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// With no meds, should show the dashboard cards
		const cards = document.querySelectorAll(".card");
		expect(cards.length).toBeGreaterThan(0);
	});

	it("renders schedule days selector", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have schedule days select dropdown
		const select = document.querySelector(".schedule-days-select");
		expect(select).toBeInTheDocument();
	});

	it("renders timeline section", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have timeline div
		const timeline = document.querySelector(".timeline");
		expect(timeline).toBeInTheDocument();
	});

	it("renders table headers for overview", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have table headers
		expect(screen.getByText(/table\.name/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.daysLeft/i)).toBeInTheDocument();
	});

	it("renders multiple cards", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Dashboard has multiple cards
		const cards = document.querySelectorAll(".card");
		expect(cards.length).toBeGreaterThan(2);
	});

	it("renders card heads", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have card heads for each section
		const cardHeads = document.querySelectorAll(".card-head");
		expect(cardHeads.length).toBeGreaterThan(0);
	});

	it("renders table headers", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have table head
		const tableHead = document.querySelector(".table-head");
		expect(tableHead).toBeInTheDocument();
	});

	it("renders table structure", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have table class
		const table = document.querySelector(".table");
		expect(table).toBeInTheDocument();
	});

	it("renders no meds message for reorder section", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// When no meds, should show empty state
		expect(screen.getByText(/dashboard\.reorder\.noMeds/i)).toBeInTheDocument();
	});
});

describe("DashboardPage interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext();
	});

	it("has schedule days options", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have 30, 90, 180 day options
		const select = document.querySelector(".schedule-days-select");
		expect(select).toBeInTheDocument();

		const options = select?.querySelectorAll("option");
		expect(options?.length).toBe(3);
	});

	it("can change schedule days", () => {
		const setScheduleDays = vi.fn();
		mockContextValue = createMockAppContext({ setScheduleDays });

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const select = document.querySelector(".schedule-days-select") as HTMLSelectElement;
		expect(select).toBeInTheDocument();

		fireEvent.change(select, { target: { value: "90" } });
		expect(setScheduleDays).toHaveBeenCalledWith(90);
	});
});

describe("DashboardPage structure", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext();
	});

	it("renders multiple section grids", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const sections = document.querySelectorAll("section.grid");
		expect(sections.length).toBeGreaterThan(0);
	});

	it("renders card head actions", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const cardHeadActions = document.querySelector(".card-head-actions");
		expect(cardHeadActions).toBeInTheDocument();
	});

	it("renders all table columns", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should have all expected table columns
		expect(screen.getByText(/table\.name/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.stock(?!Details)/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.stockDetails/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.daysLeft/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.runsOut/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.expiry/i)).toBeInTheDocument();
		expect(screen.getByText(/table\.status/i)).toBeInTheDocument();
	});
});

describe("DashboardPage with medications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: {
				Aspirin: mockCoverage.all[0],
				"Vitamin D": mockCoverage.all[1],
			},
			depletionByMed: {
				Aspirin: Date.now() + 25 * 86400000,
				"Vitamin D": Date.now() + 3 * 86400000,
			},
			futureDays: mockFutureDays,
		});
	});

	it("renders medication rows in overview table", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show medication names (may appear in multiple places)
		const aspirinElements = screen.getAllByText("Aspirin");
		const vitaminDElements = screen.getAllByText("Vitamin D");
		expect(aspirinElements.length).toBeGreaterThan(0);
		expect(vitaminDElements.length).toBeGreaterThan(0);
	});

	it("renders low stock section with low stock medications", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show the low stock medication name
		const vitaminDElements = screen.getAllByText("Vitamin D");
		expect(vitaminDElements.length).toBeGreaterThan(0);
	});

	it("renders taken by badges", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show taken by badge for Aspirin
		const johnBadges = screen.getAllByText("John");
		expect(johnBadges.length).toBeGreaterThan(0);
	});

	it("renders medication icons for reminders and notes", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Aspirin has notes
		const notesIcons = document.querySelectorAll(".notes-icon");
		expect(notesIcons.length).toBeGreaterThan(0);
	});

	it("renders schedule timeline with future doses", () => {
		// Need showFutureDays: true for day-blocks to render
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: {
				Aspirin: mockCoverage.all[0],
			},
			futureDays: mockFutureDays,
			showFutureDays: true,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show day block
		const dayBlocks = document.querySelectorAll(".day-block");
		expect(dayBlocks.length).toBeGreaterThan(0);
	});

	it("calls openMedDetail when clicking medication row", () => {
		const openMedDetail = vi.fn();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			openMedDetail,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Click on medication row
		const aspirinRow = screen.getAllByText("Aspirin")[0].closest(".table-row");
		if (aspirinRow) {
			fireEvent.click(aspirinRow);
			expect(openMedDetail).toHaveBeenCalled();
		}
	});

	it("calls openUserFilter when clicking taken by badge", () => {
		const openUserFilter = vi.fn();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			openUserFilter,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Click on taken by badge
		const johnBadge = screen.getAllByText("John")[0];
		fireEvent.click(johnBadge);
		expect(openUserFilter).toHaveBeenCalledWith("John");
	});
});

describe("DashboardPage with email notifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			settings: {
				...createMockAppContext().settings,
				emailEnabled: true,
				emailStockReminders: true,
				notificationEmail: "test@example.com",
			},
		});
	});

	it("renders reminder status bar when email enabled", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show reminder status bar
		const statusBar = document.querySelector(".reminder-status-bar");
		expect(statusBar).toBeInTheDocument();
	});

	it("hides reorder reminder card when reminders are enabled (to avoid redundancy)", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Reorder card should NOT be shown when reminders are active (Reminder Bar shows the info instead)
		// The send reminder button IS shown in the reminder status bar (not the reorder card)
		expect(document.querySelector(".reminder-status-bar")).toBeInTheDocument();
		expect(screen.queryByText(/dashboard\.reorder\.title/i)).not.toBeInTheDocument();
	});
});

describe("DashboardPage with shoutrrr notifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			settings: {
				...createMockAppContext().settings,
				shoutrrrEnabled: true,
				shoutrrrStockReminders: true,
			},
		});
	});

	it("renders notification status bar when shoutrrr enabled", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show status bar
		const statusBar = document.querySelector(".reminder-status-bar");
		expect(statusBar).toBeInTheDocument();
	});

	it("shows send reminder button when stock reminders are enabled and low stock exists", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		expect(screen.getByText("dashboard.reorder.sendReminder")).toBeInTheDocument();
	});

	it("sends manual reminder notification on button click", async () => {
		global.fetch = vi.fn().mockImplementation((url: string) => {
			if (url === "/api/reminder/send-email") {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ success: true, message: "Notification sent via push" }),
				});
			}
			// Settings refresh after successful send
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({}),
			});
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const sendButton = screen.getByText("dashboard.reorder.sendReminder");
		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(global.fetch).toHaveBeenCalledWith(
				"/api/reminder/send-email",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
				})
			);
		});

		await waitFor(() => {
			expect(screen.getByText("Notification sent via push")).toBeInTheDocument();
		});
	});

	it("shows error message when manual reminder fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: () => Promise.resolve({ error: "No notification channels configured" }),
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const sendButton = screen.getByText("dashboard.reorder.sendReminder");
		fireEvent.click(sendButton);

		await waitFor(() => {
			expect(screen.getByText("No notification channels configured")).toBeInTheDocument();
		});
	});
});

describe("DashboardPage with past days", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			pastDays: mockPastDays,
			futureDays: mockFutureDays,
			showPastDays: false,
			missedPastDoseIds: [`1-0-${Date.now() - 86400000}-John`],
		});
	});

	it("renders past days toggle when past days exist", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show past days toggle
		const toggle = document.querySelector(".past-days-toggle");
		expect(toggle).toBeInTheDocument();
	});

	it("shows missed dose warning count", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show warning with missed count
		const warning = document.querySelector(".past-days-warning");
		expect(warning).toBeInTheDocument();
	});

	it("toggles past days visibility", () => {
		const setShowPastDays = vi.fn();
		mockContextValue = createMockAppContext({
			pastDays: mockPastDays,
			showPastDays: false,
			setShowPastDays,
			missedPastDoseIds: [],
		});

		render(
			<MemoryRouter>
				<DashboardPage />
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
		mockContextValue = createMockAppContext({
			pastDays: mockPastDays,
			showPastDays: true,
			setShowPastDays,
			missedPastDoseIds: [],
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const toggle = document.querySelector(".past-days-toggle");
		if (toggle) {
			fireEvent.click(toggle);
			expect(setShowPastDays).toHaveBeenCalledWith(false);
		}
	});

	it("shows clear missed doses button when there are missed doses", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show clear missed button
		const clearBtn = document.querySelector(".clear-missed-btn");
		expect(clearBtn).toBeInTheDocument();
	});

	it("opens clear missed confirmation modal and confirms action", () => {
		const dismissMissedDoses = vi.fn();
		mockContextValue = createMockAppContext({
			pastDays: mockPastDays,
			showPastDays: false,
			missedPastDoseIds: ["1-0-1-John", "1-0-2-John"],
			showClearMissedConfirm: true,
			dismissMissedDoses,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		expect(screen.getByText(/dashboard\.schedules\.clearMissedConfirmTitle/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /dashboard\.schedules\.clearMissedConfirm/i }));
		expect(dismissMissedDoses).toHaveBeenCalledWith(["1-0-1-John", "1-0-2-John"]);
	});
});

describe("DashboardPage additional branches", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("calls openShareDialog when share button is clicked", () => {
		const openShareDialog = vi.fn();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			openShareDialog,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByRole("button", { name: /share\.button/i }));
		expect(openShareDialog).toHaveBeenCalled();
	});

	it("toggles future days visibility", () => {
		const setShowFutureDays = vi.fn();
		mockContextValue = createMockAppContext({
			futureDays: mockFutureDays,
			showFutureDays: false,
			setShowFutureDays,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const futureToggle = document.querySelector(".future-days-toggle");
		expect(futureToggle).toBeInTheDocument();
		fireEvent.click(futureToggle!);
		expect(setShowFutureDays).toHaveBeenCalledWith(true);
	});

	it("shows network error on manual reminder fetch failure", async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			settings: {
				...createMockAppContext().settings,
				emailEnabled: true,
				emailStockReminders: true,
				notificationEmail: "test@example.com",
			},
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		fireEvent.click(screen.getByText("dashboard.reorder.sendReminder"));

		await waitFor(() => {
			expect(screen.getByText("common.networkError")).toBeInTheDocument();
		});
	});

	it("opens medication detail from last stock reminder med link", () => {
		const openMedDetail = vi.fn();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			settings: {
				...createMockAppContext().settings,
				emailEnabled: true,
				emailStockReminders: true,
				lastStockReminderSent: "2026-02-10T10:00:00.000Z",
				lastStockReminderChannel: "email",
				lastStockReminderMedNames: "Aspirin (+1)",
			},
			openMedDetail,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const reminderMedLink = document.querySelector(".reminder-status-bar .med-link") as HTMLElement;
		expect(reminderMedLink).toBeInTheDocument();
		fireEvent.click(reminderMedLink);
		expect(openMedDetail).toHaveBeenCalled();
	});

	it("persists selected schedule days to localStorage", () => {
		const setScheduleDays = vi.fn();
		const setItemSpy = vi.spyOn(window.localStorage, "setItem");
		mockContextValue = createMockAppContext({ setScheduleDays });

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const select = document.querySelector(".schedule-days-select") as HTMLSelectElement;
		fireEvent.change(select, { target: { value: "180" } });

		expect(setScheduleDays).toHaveBeenCalledWith(180);
		expect(setItemSpy).toHaveBeenCalledWith("user_1_scheduleDays", "180");
	});

	it("opens schedule lightbox when clicking medication avatar image", () => {
		const openScheduleLightbox = vi.fn();
		const medsWithImage = [{ ...mockMeds[0], imageUrl: "aspirin.png" }];
		const futureDay = [
			{
				dateStr: "Tomorrow",
				date: new Date(Date.now() + 86400000),
				isPast: false,
				meds: [
					{
						medName: "Aspirin",
						total: 1,
						doses: [{ id: "1-0-1", timeStr: "09:00", when: Date.now() + 86400000, usage: 1, takenBy: [] }],
						lastWhen: Date.now() + 86400000,
					},
				],
			},
		];

		mockContextValue = createMockAppContext({
			meds: medsWithImage,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			depletionByMed: { Aspirin: Date.now() + 10 * 86400000 },
			futureDays: futureDay,
			showFutureDays: true,
			manuallyExpandedDays: new Set(["Tomorrow"]),
			openScheduleLightbox,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const avatar = document.querySelector(".day-block .med-avatar.clickable") as HTMLElement;
		expect(avatar).toBeInTheDocument();
		fireEvent.click(avatar);
		expect(openScheduleLightbox).toHaveBeenCalledWith("/api/images/aspirin.png");
	});

	it("clicking clear missed button opens confirmation", () => {
		const setShowClearMissedConfirm = vi.fn();
		mockContextValue = createMockAppContext({
			pastDays: mockPastDays,
			missedPastDoseIds: ["1-0-1-John"],
			setShowClearMissedConfirm,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const clearBtn = document.querySelector(".clear-missed-btn") as HTMLButtonElement;
		fireEvent.click(clearBtn);
		expect(setShowClearMissedConfirm).toHaveBeenCalledWith(true);
	});

	it("renders and interacts with today day schedule block", () => {
		const markDoseTaken = vi.fn();
		const undoDoseTaken = vi.fn();
		const todayDoseId = "1-0-1000";
		const today = {
			dateStr: "Today",
			date: new Date(),
			isPast: false,
			meds: [
				{
					medName: "Aspirin",
					total: 1,
					doses: [{ id: todayDoseId, timeStr: "09:00", when: Date.now() - 1000, usage: 1, takenBy: ["John"] }],
					lastWhen: Date.now() - 1000,
				},
			],
		};

		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			depletionByMed: { Aspirin: Date.now() + 10 * 86400000 },
			todayDay: today,
			markDoseTaken,
			undoDoseTaken,
			takenDoses: new Set<string>(),
			getDoseId: vi.fn((id: string, person: string | null) => (person ? `${id}-${person}` : id)),
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		expect(screen.getByText("Today")).toBeInTheDocument();
		const takeButton = document.querySelector(".day-block.today .dose-btn.take") as HTMLButtonElement;
		expect(takeButton).toBeInTheDocument();
		fireEvent.click(takeButton);
		expect(markDoseTaken).toHaveBeenCalled();

		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			depletionByMed: { Aspirin: Date.now() + 10 * 86400000 },
			todayDay: today,
			markDoseTaken,
			undoDoseTaken,
			takenDoses: new Set<string>([`${todayDoseId}-John`]),
			manuallyExpandedDays: new Set<string>(["Today"]),
			getDoseId: vi.fn((id: string, person: string | null) => (person ? `${id}-${person}` : id)),
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		const undoButton = document.querySelector(".day-block.today .dose-btn.undo") as HTMLButtonElement;
		expect(undoButton).toBeInTheDocument();
		fireEvent.click(undoButton);
		expect(undoDoseTaken).toHaveBeenCalled();
	});
});

describe("DashboardPage with expanded past days", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			pastDays: mockPastDays,
			futureDays: mockFutureDays,
			showPastDays: true,
			manuallyExpandedDays: new Set(["Sun, Jan 21"]),
			getDayStockStatus: vi.fn(() => "success"),
		});
	});

	it("renders past day blocks when showPastDays is true", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show past day block
		const pastDayBlocks = document.querySelectorAll(".day-block.past");
		expect(pastDayBlocks.length).toBeGreaterThan(0);
	});
});

describe("DashboardPage dose interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
	});

	it("calls markDoseTaken when clicking take button", () => {
		const markDoseTaken = vi.fn();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			depletionByMed: { Aspirin: Date.now() + 25 * 86400000 },
			futureDays: mockFutureDays,
			markDoseTaken,
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Find and click take button
		const takeBtn = document.querySelector(".dose-btn.take");
		if (takeBtn) {
			fireEvent.click(takeBtn);
			expect(markDoseTaken).toHaveBeenCalled();
		}
	});

	it("calls undoDoseTaken when clicking undo button", () => {
		const undoDoseTaken = vi.fn();
		const doseId = `1-0-${Date.now()}-John`;
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: mockCoverage,
			coverageByMed: { Aspirin: mockCoverage.all[0] },
			depletionByMed: { Aspirin: Date.now() + 25 * 86400000 },
			futureDays: mockFutureDays,
			takenDoses: new Set([doseId]),
			undoDoseTaken,
			getDoseId: vi.fn(() => doseId),
		});

		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Find and click undo button
		const undoBtn = document.querySelector(".dose-btn.undo");
		if (undoBtn) {
			fireEvent.click(undoBtn);
			expect(undoDoseTaken).toHaveBeenCalled();
		}
	});
});

describe("DashboardPage good stock state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: mockMeds,
			coverage: {
				all: [
					{
						name: "Aspirin",
						medsLeft: 100,
						daysLeft: 100,
						depletionDate: "2025-05-01",
						depletionTime: Date.now() + 100 * 86400000,
						nextDose: null,
					},
				],
				low: [],
			},
		});
	});

	it("shows all good message when no low stock", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show all good message
		expect(screen.getByText(/dashboard\.reorder\.allGood/i)).toBeInTheDocument();
	});
});

describe("DashboardPage bottle package type", () => {
	const bottleMed = {
		id: 3,
		name: "Ibuprofen",
		packageType: "bottle" as const,
		packCount: 0,
		blistersPerPack: 1,
		pillsPerBlister: 1,
		looseTablets: 100,
		totalPills: 200,
		takenBy: [],
		blisters: [{ usage: 2, every: 1, start: "2024-01-01T09:00:00Z" }],
		intakeRemindersEnabled: false,
		notes: null,
		expiryDate: null,
		imageUrl: null,
		updatedAt: null,
	};

	const bottleCoverage = {
		name: "Ibuprofen",
		medsLeft: 100,
		daysLeft: 50,
		depletionDate: "2025-04-01",
		depletionTime: Date.now() + 50 * 86400000,
		nextDose: null,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		mockContextValue = createMockAppContext({
			meds: [bottleMed],
			coverage: { all: [bottleCoverage], low: [] },
			coverageByMed: { Ibuprofen: bottleCoverage },
		});
	});

	it("renders pill count instead of blisters for bottle type", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// Should show medication name
		expect(screen.getByText("Ibuprofen")).toBeInTheDocument();

		// Should show pills count (bottle shows pillsCount, not blisters)
		expect(screen.getByText(/table\.pillsCount/i)).toBeInTheDocument();
	});

	it("shows dash for stock details column for bottle type", () => {
		render(
			<MemoryRouter>
				<DashboardPage />
			</MemoryRouter>
		);

		// For bottle type, the stock details column shows "—"
		const dashElements = document.querySelectorAll('[data-label="table.stockDetails"]');
		const bottleDetails = Array.from(dashElements).find((el) => el.textContent === "—");
		expect(bottleDetails).toBeInTheDocument();
	});
});
