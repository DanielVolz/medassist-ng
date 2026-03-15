import { render, screen, waitFor } from "@testing-library/react";
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

function createSharedData(overrides: Record<string, unknown> = {}) {
	const yesterday = new Date();
	yesterday.setDate(yesterday.getDate() - 1);
	yesterday.setHours(9, 0, 0, 0);

	return {
		sharedBy: "Owner",
		takenBy: "Max",
		scheduleDays: 30,
		upcomingTodayOnly: false,
		shareScheduleTodayOnly: true,
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

describe("SharedSchedule today-only", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.spyOn(globalThis, "setInterval").mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
		vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("hides past and future sections when shareScheduleTodayOnly is enabled even if dashboard today-only is off", async () => {
		const sharedData = createSharedData();

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init || !init.method || init.method === "GET")) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(sharedData) });
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
		});

		expect(document.querySelector(".day-block.today")).toBeInTheDocument();
		expect(document.querySelector(".past-days-toggle")).not.toBeInTheDocument();
		expect(document.querySelector(".future-days-toggle")).not.toBeInTheDocument();
	});
});
