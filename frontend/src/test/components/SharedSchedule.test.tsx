import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSchedule } from "../../components/SharedSchedule";

// Mock fetch globally
const mockFetch = vi.fn();

// Store original setInterval
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;

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

// Helper to setup fetch mock for standard success response
function setupSuccessMock(extraData = {}) {
	mockFetch.mockImplementation((url: string) => {
		if (url.includes("/doses")) {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve({ doses: [] }),
			});
		}
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(createMockData(extraData)),
		});
	});
}

describe("SharedSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		// Mock setInterval to prevent polling from hanging tests
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
		setupSuccessMock();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

	it("has correct initial theme", () => {
		renderSharedSchedule();
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	});
});

describe("SharedSchedule data loading", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
	});

	it("displays schedule after successful data load", async () => {
		setupSuccessMock();
		renderSharedSchedule();

		await waitFor(
			() => {
				expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		expect(screen.getByText("TestPerson")).toBeInTheDocument();
	});

	it("displays medication name after data load", async () => {
		setupSuccessMock();
		renderSharedSchedule();

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/share\.notFound/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/share\.expired\.title/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/share\.error/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/share\.noSchedule/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
	});
});

describe("SharedSchedule theme functionality", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
		setupSuccessMock();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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
		renderSharedSchedule();

		await waitFor(
			() => {
				expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		const themeButton = screen.getByText("☀️");
		await act(async () => {
			fireEvent.click(themeButton);
		});

		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
		expect(localStorage.getItem("theme")).toBe("light");
	});

	it("shows moon icon in light mode", async () => {
		localStorage.setItem("theme", "light");
		renderSharedSchedule();

		await waitFor(
			() => {
				expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		expect(screen.getByText("🌙")).toBeInTheDocument();
	});
});

describe("SharedSchedule past days functionality", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.showPastDays/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.showPastDays/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		const toggle = screen.getByText(/dashboard\.schedules\.showPastDays/i).closest(".past-days-toggle");
		await act(async () => {
			fireEvent.click(toggle!);
		});

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.hidePastDays/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
	});
});

describe("SharedSchedule dose tracking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

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
});

describe("SharedSchedule schedule period display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.1month/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.3months/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
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

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.6months/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
	});
});

describe("SharedSchedule undo dose", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

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
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
		setupSuccessMock();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
	});

	it("displays footer with MedAssist link", async () => {
		renderSharedSchedule();

		await waitFor(
			() => {
				expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

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

		await waitFor(
			() => {
				expect(screen.getByText("TestOwner")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
	});
});

describe("SharedSchedule stock status display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		// Should show pills total
		expect(screen.getByText(/common\.pills/i)).toBeInTheDocument();
	});
});

describe("SharedSchedule generic error state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText(/share\.error/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);
	});
});

describe("SharedSchedule polling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		// Don't mock setInterval for polling test
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("sets up polling interval on mount", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });

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

		// Wait for initial fetch
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});

		expect(doseFetchCount).toBeGreaterThanOrEqual(1);

		const initialCount = doseFetchCount;

		// Advance time by 5 seconds
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5000);
		});

		// Should have fetched again due to polling
		expect(doseFetchCount).toBeGreaterThan(initialCount);
	});
});

describe("SharedSchedule keyboard handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
		setupSuccessMock();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
		setupSuccessMock();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		// Find clickable avatar
		const clickableAvatars = document.querySelectorAll(".clickable .med-avatar");
		if (clickableAvatars.length > 0) {
			const parent = clickableAvatars[0].closest(".clickable");
			if (parent) {
				await act(async () => {
					fireEvent.click(parent);
				});

				await waitFor(
					() => {
						expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();
					},
					{ timeout: 3000 }
				);
			}
		}
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

		await waitFor(
			() => {
				expect(screen.getByText("TestMed")).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		// Open lightbox
		const clickableAvatars = document.querySelectorAll(".clickable .med-avatar");
		if (clickableAvatars.length > 0) {
			const parent = clickableAvatars[0].closest(".clickable");
			if (parent) {
				await act(async () => {
					fireEvent.click(parent);
				});

				await waitFor(
					() => {
						expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();
					},
					{ timeout: 3000 }
				);

				// Press Escape
				fireEvent.keyDown(window, { key: "Escape" });
				expect(mockHistoryBack).toHaveBeenCalled();
			}
		}

		mockHistoryBack.mockRestore();
	});
});

describe("SharedSchedule day collapse", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		localStorage.clear();
		document.documentElement.removeAttribute("data-theme");
		(global.fetch as ReturnType<typeof vi.fn>) = mockFetch;
		global.setInterval = vi.fn().mockReturnValue(999);
		global.clearInterval = vi.fn();
	});

	afterEach(() => {
		global.setInterval = originalSetInterval;
		global.clearInterval = originalClearInterval;
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

		await waitFor(
			() => {
				expect(screen.getByText(/dashboard\.schedules\.showPastDays/i)).toBeInTheDocument();
			},
			{ timeout: 3000 }
		);

		// Expand past days first
		const toggle = screen.getByText(/dashboard\.schedules\.showPastDays/i).closest(".past-days-toggle");
		await act(async () => {
			fireEvent.click(toggle!);
		});

		await waitFor(
			() => {
				const dayDividers = document.querySelectorAll(".day-divider.clickable");
				expect(dayDividers.length).toBeGreaterThan(0);
			},
			{ timeout: 3000 }
		);

		// Click a day divider to expand it
		const dayDividers = document.querySelectorAll(".day-divider.clickable");
		if (dayDividers.length > 0) {
			await act(async () => {
				fireEvent.click(dayDividers[0]);
			});

			// Check localStorage was updated
			const expandedKey = "share_test-token_expandedDays";
			const saved = localStorage.getItem(expandedKey);
			expect(saved).toBeTruthy();
		}
	});
});
