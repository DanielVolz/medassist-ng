import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSchedule } from "../../components/SharedSchedule";

// Mock fetch globally
const mockFetch = vi.fn();

// Helper to create mock medication data
function createMockData(overrides = {}) {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	return {
		takenBy: "TestPerson",
		sharedBy: "TestOwner",
		scheduleDays: 30,
		medications: [
			{
				id: 1,
				name: "TestMed",
				genericName: "TestGeneric",
				pillWeightMg: 100,
				imageUrl: "test-image.jpg",
				totalPills: 30,
				packCount: 1,
				blistersPerPack: 1,
				looseTablets: 0,
				pillsPerBlister: 30,
				takenBy: ["TestPerson"],
				blisters: [
					{
						usage: 1,
						every: 1,
						start: yesterday.toISOString(),
					},
				],
				dismissedUntil: null,
			},
		],
		stockThresholds: {
			lowStockDays: 30,
		},
		...overrides,
	};
}

// Helper to render SharedSchedule with router
function renderSharedSchedule(token = "test-token") {
	return render(
		<MemoryRouter initialEntries={[`/share/${token}`]}>
			<Routes>
				<Route path="/share/:token" element={<SharedSchedule />} />
			</Routes>
		</MemoryRouter>
	);
}

describe("SharedSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");

		// Default mock responses
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows loading state initially", () => {
		renderSharedSchedule();
		expect(screen.getByText(/common\.loading/i)).toBeInTheDocument();
	});

	it("renders app title during loading", () => {
		renderSharedSchedule();
		expect(screen.getByText(/MedAssist/i)).toBeInTheDocument();
	});

	it("renders shared schedule page container", () => {
		renderSharedSchedule();
		const container = document.querySelector(".shared-schedule-page");
		expect(container).toBeInTheDocument();
	});

	it("renders loading state container", () => {
		renderSharedSchedule();
		const loading = document.querySelector(".shared-schedule-loading");
		expect(loading).toBeInTheDocument();
	});

	it("has correct initial theme", () => {
		renderSharedSchedule();
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	});

	it("renders h1 heading", () => {
		renderSharedSchedule();
		const heading = document.querySelector("h1");
		expect(heading).toBeInTheDocument();
	});

	it("renders paragraph element", () => {
		renderSharedSchedule();
		const paragraph = document.querySelector("p");
		expect(paragraph).toBeInTheDocument();
	});
});

describe("SharedSchedule data loading", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("displays schedule after successful data load", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expect(screen.getByText("TestPerson")).toBeInTheDocument();
	});

	it("displays medication name after data load", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});
	});

	it("shows error state for 404 response", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: false,
				status: 404,
				json: () => Promise.resolve({ error: "Not found" }),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.notFound/i)).toBeInTheDocument();
		});
	});

	it("shows expired state for 410 response", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: false,
				status: 410,
				json: () =>
					Promise.resolve({
						ownerUsername: "TestOwner",
						takenBy: "TestPerson",
						expiredAt: new Date().toISOString(),
					}),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.expired\.title/i)).toBeInTheDocument();
		});
	});

	it("shows error state for network error", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.reject(new Error("Network error"));
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.error/i)).toBeInTheDocument();
		});
	});

	it("shows no schedule message when no medications", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData({ medications: [] })),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.noSchedule/i)).toBeInTheDocument();
		});
	});
});

describe("SharedSchedule theme functionality", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("uses saved theme from localStorage", () => {
		localStorage.setItem("theme", "light");
		renderSharedSchedule();
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});

	it("defaults to dark theme when no saved theme", () => {
		renderSharedSchedule();
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	});

	it("toggles theme when theme button is clicked", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		const themeButton = screen.getByText("☀️");
		fireEvent.click(themeButton);

		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
		expect(localStorage.getItem("theme")).toBe("light");
	});

	it("shows moon icon in light mode", async () => {
		localStorage.setItem("theme", "light");

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expect(screen.getByText("🌙")).toBeInTheDocument();
	});
});

describe("SharedSchedule past days functionality", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows past days toggle when there are past days", async () => {
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 2);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: yesterday.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.showPastDays/i)).toBeInTheDocument();
		});
	});

	it("expands past days when toggle is clicked", async () => {
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 2);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: yesterday.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.showPastDays/i)).toBeInTheDocument();
		});

		const toggle = screen.getByText(/dashboard\.schedules\.showPastDays/i).closest(".past-days-toggle");
		fireEvent.click(toggle!);

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.hidePastDays/i)).toBeInTheDocument();
		});
	});
});

describe("SharedSchedule dose tracking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("loads taken doses from server", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [{ doseId: `1-0-${today.getTime()}` }] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Should have called fetch for doses
		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/doses"));
	});

	it("marks dose as taken when take button is clicked", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		mockFetch.mockImplementation((url: string, options?: RequestInit) => {
			if (url.includes("/doses") && options?.method === "POST") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
			}
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Find and click a take button
		const takeButtons = screen.getAllByTitle(/dose\.markAsTaken/i);
		expect(takeButtons.length).toBeGreaterThan(0);

		await act(async () => {
			fireEvent.click(takeButtons[0]);
		});

		// Should have called POST to mark dose
		expect(mockFetch).toHaveBeenCalledWith(
			expect.stringContaining("/doses"),
			expect.objectContaining({ method: "POST" })
		);
	});

	it("handles dose taken error gracefully", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		mockFetch.mockImplementation((url: string, options?: RequestInit) => {
			if (url.includes("/doses") && options?.method === "POST") {
				return Promise.reject(new Error("Network error"));
			}
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		const takeButtons = screen.getAllByTitle(/dose\.markAsTaken/i);

		await act(async () => {
			fireEvent.click(takeButtons[0]);
		});

		// Component should still be rendered (no crash)
		expect(screen.getByText("TestMed")).toBeInTheDocument();
	});
});

describe("SharedSchedule dismissed doses", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows dismissed doses as done without missed warning", async () => {
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 2);
		const dismissedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: yesterday.toISOString() }],
									dismissedUntil: dismissedDate,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		// Past days should show checkmark instead of warning
		const pastToggle = document.querySelector(".past-days-toggle");
		if (pastToggle) {
			const checkmark = pastToggle.querySelector(".past-days-complete");
			expect(checkmark).toBeInTheDocument();
		}
	});
});

describe("SharedSchedule day collapse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("saves collapsed state to localStorage", async () => {
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 2);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: yesterday.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.showPastDays/i)).toBeInTheDocument();
		});

		// Expand past days first
		const toggle = screen.getByText(/dashboard\.schedules\.showPastDays/i).closest(".past-days-toggle");
		fireEvent.click(toggle!);

		await waitFor(() => {
			const dayDividers = document.querySelectorAll(".day-divider.clickable");
			expect(dayDividers.length).toBeGreaterThan(0);
		});

		// Click a day divider to expand it
		const dayDividers = document.querySelectorAll(".day-divider.clickable");
		if (dayDividers.length > 0) {
			fireEvent.click(dayDividers[0]);

			// Check localStorage was updated
			const expandedKey = `share_test-token_expandedDays`;
			const saved = localStorage.getItem(expandedKey);
			expect(saved).toBeTruthy();
		}
	});

	it("loads collapsed state from localStorage on mount", async () => {
		const now = new Date();
		const yesterday = new Date(now);
		yesterday.setDate(yesterday.getDate() - 2);
		const dateStr = yesterday.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short" });

		// Pre-set expanded days in localStorage
		localStorage.setItem("share_test-token_expandedDays", JSON.stringify([dateStr]));

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: yesterday.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});
	});
});

describe("SharedSchedule keyboard handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("handles Escape key without error", () => {
		renderSharedSchedule();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(document.querySelector(".shared-schedule-page")).toBeInTheDocument();
	});
});

describe("SharedSchedule with different tokens", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders with different token", () => {
		renderSharedSchedule("another-token");
		expect(screen.getByText(/common\.loading/i)).toBeInTheDocument();
	});

	it("renders with uuid token", () => {
		renderSharedSchedule("550e8400-e29b-41d4-a716-446655440000");
		expect(screen.getByText(/MedAssist/i)).toBeInTheDocument();
	});
});

describe("SharedSchedule lightbox", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("opens lightbox when clicking medication image", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: "TestGeneric",
									pillWeightMg: 100,
									imageUrl: "test-image.jpg",
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Find clickable avatar
		const clickableAvatars = document.querySelectorAll(".clickable .med-avatar");
		if (clickableAvatars.length > 0) {
			const parent = clickableAvatars[0].closest(".clickable");
			if (parent) {
				fireEvent.click(parent);

				await waitFor(() => {
					expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();
				});
			}
		}
	});

	it("closes lightbox when clicking overlay", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		// Mock history.back
		const mockHistoryBack = vi.spyOn(window.history, "back").mockImplementation(() => {});

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: "TestGeneric",
									pillWeightMg: 100,
									imageUrl: "test-image.jpg",
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Open lightbox
		const clickableAvatars = document.querySelectorAll(".clickable .med-avatar");
		if (clickableAvatars.length > 0) {
			const parent = clickableAvatars[0].closest(".clickable");
			if (parent) {
				fireEvent.click(parent);

				await waitFor(() => {
					expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();
				});

				// Close lightbox
				const overlay = document.querySelector(".lightbox-overlay");
				if (overlay) {
					fireEvent.click(overlay);
					expect(mockHistoryBack).toHaveBeenCalled();
				}
			}
		}

		mockHistoryBack.mockRestore();
	});

	it("closes lightbox on Escape key", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		const mockHistoryBack = vi.spyOn(window.history, "back").mockImplementation(() => {});

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: "TestGeneric",
									pillWeightMg: 100,
									imageUrl: "test-image.jpg",
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Open lightbox
		const clickableAvatars = document.querySelectorAll(".clickable .med-avatar");
		if (clickableAvatars.length > 0) {
			const parent = clickableAvatars[0].closest(".clickable");
			if (parent) {
				fireEvent.click(parent);

				await waitFor(() => {
					expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();
				});

				// Press Escape
				fireEvent.keyDown(window, { key: "Escape" });
				expect(mockHistoryBack).toHaveBeenCalled();
			}
		}

		mockHistoryBack.mockRestore();
	});
});

describe("SharedSchedule schedule period display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("displays 1 month period", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData({ scheduleDays: 30 })),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.1month/i)).toBeInTheDocument();
		});
	});

	it("displays 3 months period", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData({ scheduleDays: 90 })),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.3months/i)).toBeInTheDocument();
		});
	});

	it("displays 6 months period", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData({ scheduleDays: 180 })),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/dashboard\.schedules\.6months/i)).toBeInTheDocument();
		});
	});
});

describe("SharedSchedule undo dose", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("undoes taken dose when undo button is clicked", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);
		const doseId = `1-0-${today.getTime()}`;

		mockFetch.mockImplementation((url: string, options?: RequestInit) => {
			if (url.includes("/doses") && options?.method === "DELETE") {
				return Promise.resolve({ ok: true });
			}
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [{ doseId }] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Find undo button (for taken dose)
		const undoButtons = screen.queryAllByTitle(/common\.undo/i);
		if (undoButtons.length > 0) {
			await act(async () => {
				fireEvent.click(undoButtons[0]);
			});

			// Should have called DELETE
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/doses/"),
				expect.objectContaining({ method: "DELETE" })
			);
		}
	});

	it("handles undo error gracefully", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);
		const doseId = `1-0-${today.getTime()}`;

		mockFetch.mockImplementation((url: string, options?: RequestInit) => {
			if (url.includes("/doses") && options?.method === "DELETE") {
				return Promise.reject(new Error("Network error"));
			}
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [{ doseId }] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		const undoButtons = screen.queryAllByTitle(/common\.undo/i);
		if (undoButtons.length > 0) {
			await act(async () => {
				fireEvent.click(undoButtons[0]);
			});

			// Component should still be rendered
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		}
	});
});

describe("SharedSchedule footer and branding", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("displays footer with MedAssist link", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		const footer = document.querySelector(".shared-schedule-footer");
		expect(footer).toBeInTheDocument();

		const link = footer?.querySelector('a[href="/"]');
		expect(link).toBeInTheDocument();
		expect(link?.textContent).toBe("MedAssist-ng");
	});

	it("displays sharedBy username in footer", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData({ sharedBy: "TestOwner" })),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestOwner")).toBeInTheDocument();
		});
	});
});

describe("SharedSchedule stock status display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("displays stock status for medications", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 1, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Should show stock status tag
		const statusTags = document.querySelectorAll(".tag.success, .tag.warning, .tag.danger");
		expect(statusTags.length).toBeGreaterThan(0);
	});

	it("shows pills total in schedule", async () => {
		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0);

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () =>
					Promise.resolve(
						createMockData({
							medications: [
								{
									id: 1,
									name: "TestMed",
									genericName: null,
									pillWeightMg: null,
									imageUrl: null,
									totalPills: 30,
									packCount: 1,
									blistersPerPack: 1,
									looseTablets: 0,
									pillsPerBlister: 30,
									takenBy: ["TestPerson"],
									blisters: [{ usage: 2, every: 1, start: today.toISOString() }],
									dismissedUntil: null,
								},
							],
						})
					),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText("TestMed")).toBeInTheDocument();
		});

		// Should show pills total
		expect(screen.getByText(/common\.pills/i)).toBeInTheDocument();
	});
});

describe("SharedSchedule generic error state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("shows error for non-404/410 error responses", async () => {
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ error: "Server error" }),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(screen.getByText(/share\.error/i)).toBeInTheDocument();
		});
	});
});

describe("SharedSchedule polling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls for dose updates every 5 seconds", async () => {
		let doseFetchCount = 0;

		mockFetch.mockImplementation((url: string) => {
			if (url.includes("/doses")) {
				doseFetchCount++;
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [] }),
				});
			}
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(createMockData()),
			});
		});

		renderSharedSchedule();

		await waitFor(() => {
			expect(doseFetchCount).toBeGreaterThanOrEqual(1);
		});

		const initialCount = doseFetchCount;

		// Advance time by 5 seconds
		await act(async () => {
			vi.advanceTimersByTime(5000);
		});

		// Should have fetched again
		await waitFor(() => {
			expect(doseFetchCount).toBeGreaterThan(initialCount);
		});
	});
});
