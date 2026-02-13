import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedSchedule } from "../../components/SharedSchedule";

function renderSharedSchedule(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/share/:token" element={<SharedSchedule />} />
			</Routes>
		</MemoryRouter>
	);
}

function expandTodayIfCollapsed() {
	const todayDivider = document.querySelector(".day-block.today .day-divider.clickable") as HTMLDivElement;
	expect(todayDivider).toBeInTheDocument();
	const todayBlock = document.querySelector(".day-block.today") as HTMLDivElement;
	if (todayBlock?.classList.contains("collapsed")) {
		fireEvent.click(todayDivider);
	}
}

function createSharedData(overrides: Record<string, unknown> = {}) {
	const now = new Date();
	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	yesterday.setHours(9, 0, 0, 0);

	return {
		sharedBy: "Owner",
		takenBy: "Max",
		scheduleDays: 30,
		shareStockStatus: true,
		stockCalculationMode: "automatic",
		stockThresholds: {
			lowStockDays: 7,
			normalStockDays: 30,
			highStockDays: 90,
			reminderDaysBefore: 7,
			expiryWarningDays: 30,
		},
		medications: [
			{
				id: 1,
				name: "Ibuprofen",
				genericName: "Ibu",
				takenBy: ["Max"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 2,
				pillsPerBlister: 10,
				looseTablets: 0,
				pillWeightMg: null,
				doseUnit: "mg",
				expiryDate: null,
				notes: null,
				intakeRemindersEnabled: false,
				blisters: [{ usage: 1, every: 1, start: yesterday.toISOString() }],
				intakes: [
					{ usage: 1, every: 1, start: yesterday.toISOString(), takenBy: "Max", intakeRemindersEnabled: false },
				],
				updatedAt: null,
				dismissedUntil: null,
				lastStockCorrectionAt: null,
			},
		],
		...overrides,
	};
}

function mockShareFetch(
	token: string,
	sharedData: Record<string, unknown>,
	doses: Array<{ doseId: string; dismissed?: boolean }> = []
) {
	(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
		if (url === `/api/share/${token}/doses` && (!init || !init.method || init.method === "GET")) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses }) });
		}
		if (url === `/api/share/${token}`) {
			return Promise.resolve({ ok: true, json: () => Promise.resolve(sharedData) });
		}
		if (url === `/api/share/${token}/doses` && init?.method === "POST") {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
		}
		if (url.startsWith(`/api/share/${token}/doses/`) && init?.method === "DELETE") {
			return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
		}
		return Promise.reject(new Error(`Unexpected URL: ${url}`));
	});
}

describe.skip("SharedSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.spyOn(global, "setInterval").mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
		vi.spyOn(global, "clearInterval").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			const first = String(args[0] ?? "");
			if (first.includes("not wrapped in act")) return;
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("closes theme menu when clicking outside", async () => {
		const sharedData = createSharedData();
		mockShareFetch("token-123", sharedData);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTitle("theme.title"));
		expect(document.querySelector(".theme-menu.open")).toBeInTheDocument();

		fireEvent.click(document.body);
		expect(document.querySelector(".theme-menu.open")).not.toBeInTheDocument();
	});

	it("shows loading state initially", async () => {
		let resolveShare: ((value: unknown) => void) | null = null;
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
			if (url === "/api/share/token-123/doses") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return new Promise((resolve) => {
					resolveShare = resolve;
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");
		expect(screen.getByText("common.loading")).toBeInTheDocument();

		resolveShare?.({
			ok: true,
			json: () => Promise.resolve(createSharedData()),
		});

		await waitFor(() => {
			expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
		});
	});

	it("renders not found error for 404 links", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
			if (url === "/api/share/token-123/doses") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("share.notFound")).toBeInTheDocument();
		});
	});

	it("renders generic error for unexpected status codes", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
			if (url === "/api/share/token-123/doses") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("share.error")).toBeInTheDocument();
		});
	});

	it("renders expired link state for 410 responses", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
			if (url === "/api/share/token-123/doses") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({
					ok: false,
					status: 410,
					json: () =>
						Promise.resolve({
							ownerUsername: "owner",
							takenBy: "Max",
							expiredAt: "2026-02-01T10:00:00.000Z",
						}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("share.expired.title")).toBeInTheDocument();
		});
	});

	it("renders schedule shell for valid shared data", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
			if (url === "/api/share/token-123/doses") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							sharedBy: "Owner",
							takenBy: "Max",
							scheduleDays: 30,
							shareStockStatus: true,
							stockCalculationMode: "automatic",
							stockThresholds: {
								lowStockDays: 7,
								normalStockDays: 30,
								highStockDays: 90,
								reminderDaysBefore: 7,
								expiryWarningDays: 30,
							},
							medications: [],
						}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share.scheduleFor/i)).toBeInTheDocument();
			expect(screen.getByText("share.noSchedule")).toBeInTheDocument();
		});
	});

	it("opens theme menu and switches to light theme", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
			if (url === "/api/share/token-123/doses") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							sharedBy: "Owner",
							takenBy: "Max",
							scheduleDays: 30,
							shareStockStatus: true,
							stockCalculationMode: "automatic",
							stockThresholds: {
								lowStockDays: 7,
								normalStockDays: 30,
								highStockDays: 90,
								reminderDaysBefore: 7,
								expiryWarningDays: 30,
							},
							medications: [],
						}),
				});
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share.scheduleFor/i)).toBeInTheDocument();
		});

		fireEvent.click(screen.getByTitle("theme.title"));
		fireEvent.click(screen.getByRole("button", { name: /theme\.light/i }));

		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});

	it("renders schedule rows for populated data and can expand future days", async () => {
		const sharedData = createSharedData();
		mockShareFetch("token-123", sharedData);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
			expect(screen.getByText("Ibuprofen")).toBeInTheDocument();
		});

		const futureToggle = document.querySelector(".future-days-toggle");
		expect(futureToggle).toBeInTheDocument();
		fireEvent.click(futureToggle as Element);

		await waitFor(() => {
			expect(document.querySelectorAll(".day-block").length).toBeGreaterThan(1);
		});
	});

	it("marks and undoes a dose via shared API", async () => {
		const sharedData = createSharedData();
		mockShareFetch("token-123", sharedData);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("Ibuprofen")).toBeInTheDocument();
		});

		const takeButton = document.querySelector(".dose-btn.take:not([disabled])") as HTMLButtonElement;
		expect(takeButton).toBeInTheDocument();
		fireEvent.click(takeButton);

		await waitFor(() => {
			expect(global.fetch as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
				"/api/share/token-123/doses",
				expect.objectContaining({ method: "POST" })
			);
		});
	});

	it("undos a taken dose via shared API", async () => {
		const sharedData = createSharedData();
		const today = new Date();
		const todayDateOnlyMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
		mockShareFetch("token-123", sharedData, [{ doseId: `1-0-${todayDateOnlyMs}-Max` }]);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expandTodayIfCollapsed();

		const undoButton = await waitFor(() => {
			const button = document.querySelector(".dose-btn.undo") as HTMLButtonElement | null;
			expect(button).toBeInTheDocument();
			return button as HTMLButtonElement;
		});
		fireEvent.click(undoButton);

		await waitFor(() => {
			expect(
				(global.fetch as ReturnType<typeof vi.fn>).mock.calls.some((call) => {
					const [url, init] = call as [string, RequestInit | undefined];
					return typeof url === "string" && url.includes("/api/share/token-123/doses/") && init?.method === "DELETE";
				})
			).toBe(true);
		});
	});

	it("hides stock status chips when shareStockStatus is false", async () => {
		const sharedData = createSharedData({ shareStockStatus: false });
		mockShareFetch("token-123", sharedData);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("Ibuprofen")).toBeInTheDocument();
		});

		expect(document.querySelector(".status-chip")).not.toBeInTheDocument();
	});

	it("opens and closes lightbox for medication image", async () => {
		const pushStateSpy = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
		const backSpy = vi.spyOn(window.history, "back").mockImplementation(() => {});
		const sharedData = createSharedData({
			medications: [
				{
					...createSharedData().medications[0],
					imageUrl: "ibuprofen.png",
				},
			],
		});
		mockShareFetch("token-123", sharedData);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expandTodayIfCollapsed();

		const avatar = await waitFor(() => {
			const element = document.querySelector(".day-block.today .med-avatar.clickable") as HTMLDivElement | null;
			expect(element).toBeInTheDocument();
			return element as HTMLDivElement;
		});
		fireEvent.click(avatar);

		expect(pushStateSpy).toHaveBeenCalled();
		expect(document.querySelector(".lightbox-overlay")).toBeInTheDocument();

		fireEvent.click(document.querySelector(".lightbox-overlay") as HTMLDivElement);
		expect(backSpy).toHaveBeenCalled();
	});

	it("reverts optimistic taken state when mark-dose request fails", async () => {
		const sharedData = createSharedData();
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init || !init.method || init.method === "GET")) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(sharedData) });
			}
			if (url === "/api/share/token-123/doses" && init?.method === "POST") {
				return Promise.reject(new Error("post failed"));
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
		});

		renderSharedSchedule("/share/token-123");
		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expandTodayIfCollapsed();

		const takeButton = await waitFor(() => {
			const button = document.querySelector(".dose-btn.take:not([disabled])") as HTMLButtonElement | null;
			expect(button).toBeInTheDocument();
			return button as HTMLButtonElement;
		});
		fireEvent.click(takeButton);

		await waitFor(() => {
			expect(document.querySelector(".dose-btn.undo")).not.toBeInTheDocument();
			expect(document.querySelector(".dose-btn.take:not([disabled])")).toBeInTheDocument();
		});
	});

	it("reverts optimistic undo state when undo request fails", async () => {
		const today = new Date();
		const todayDateOnlyMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
		const sharedData = createSharedData();
		(global.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init || !init.method || init.method === "GET")) {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ doses: [{ doseId: `1-0-${todayDateOnlyMs}-Max` }] }),
				});
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(sharedData) });
			}
			if (url.startsWith("/api/share/token-123/doses/") && init?.method === "DELETE") {
				return Promise.reject(new Error("delete failed"));
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
		});

		renderSharedSchedule("/share/token-123");
		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expandTodayIfCollapsed();

		const undoButton = await waitFor(() => {
			const button = document.querySelector(".dose-btn.undo") as HTMLButtonElement | null;
			expect(button).toBeInTheDocument();
			return button as HTMLButtonElement;
		});
		fireEvent.click(undoButton);

		await waitFor(() => {
			expect(document.querySelector(".dose-btn.undo")).toBeInTheDocument();
		});
	});

	it("persists manual collapse state in localStorage", async () => {
		const setItemSpy = vi.spyOn(window.localStorage, "setItem");
		const sharedData = createSharedData();
		mockShareFetch("token-123", sharedData);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		const todayDivider = document.querySelector(".day-block.today .day-divider.clickable") as HTMLDivElement;
		fireEvent.click(todayDivider);

		expect(setItemSpy).toHaveBeenCalled();
		expect(
			setItemSpy.mock.calls.some((call) => String(call[0]).includes("share_token-123_collapsedDays")) ||
				setItemSpy.mock.calls.some((call) => String(call[0]).includes("share_token-123_expandedDays"))
		).toBe(true);
	});
});
