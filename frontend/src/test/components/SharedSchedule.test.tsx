import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

function createSharedData() {
	return {
		sharedBy: "Owner",
		takenBy: "Max",
		scheduleDays: 30,
		medications: [],
	};
}

function createSharedDataWithEmbeddedOverview() {
	return {
		...createSharedData(),
		takenBy: "all",
		shareMedicationOverview: true,
		medicationOverview: [
			{
				name: "Aspirin",
				genericName: "Acetylsalicylic Acid",
				imageUrl: null,
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 2,
				pillsPerBlister: 10,
				totalPills: null,
				looseTablets: 0,
				currentStock: 8,
				capacity: 20,
				daysLeft: 8,
				nextIntakeDate: null,
				depletionDate: "2026-01-20",
				priority: "high",
				expiryDate: null,
				medicationStartDate: null,
				prescriptionEnabled: false,
				prescriptionRemainingRefills: null,
			},
		],
	};
}

function createSharedDataWithTodayDose() {
	const now = new Date();
	now.setHours(10, 0, 0, 0);
	const dateOnlyMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

	return {
		sharedBy: "Owner",
		takenBy: "Max",
		scheduleDays: 30,
		automaticDoseId: `1-0-${dateOnlyMs}`,
		medications: [
			{
				id: 1,
				name: "Ibuprofen",
				genericName: null,
				takenBy: [],
				packageType: "blister",
				packCount: 2,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				pillWeightMg: null,
				doseUnit: "mg",
				expiryDate: null,
				notes: null,
				intakeRemindersEnabled: false,
				blisters: [{ usage: 1, every: 1, start: now.toISOString() }],
				intakes: [{ usage: 1, every: 1, start: now.toISOString(), takenBy: null, intakeRemindersEnabled: false }],
				updatedAt: null,
				dismissedUntil: null,
				lastStockCorrectionAt: null,
			},
		],
	};
}

describe("SharedSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		vi.spyOn(globalThis, "setInterval").mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
		vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders shared schedule shell for valid token", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init || !init.method || init.method === "GET")) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(createSharedData()) });
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText(/share\.scheduleFor/i)).toBeInTheDocument();
			expect(screen.getByText("share.noSchedule")).toBeInTheDocument();
		});
	});

	it("renders not found state for missing share link", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
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

	it("renders expired state for expired share links", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
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

	it("renders generic error when loading share data fails", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init || !init.method || init.method === "GET")) {
				return Promise.resolve({ ok: true, json: () => Promise.resolve({ doses: [] }) });
			}
			if (url === "/api/share/token-123") {
				return Promise.reject(new Error("network failed"));
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("share.error")).toBeInTheDocument();
		});
	});

	it("shows the robot marker for automatically taken shared doses", async () => {
		const sharedData = createSharedDataWithTodayDose();

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init || !init.method || init.method === "GET")) {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({
							doses: [{ doseId: sharedData.automaticDoseId, dismissed: false, takenSource: "automatic" }],
						}),
				});
			}
			if (url === "/api/share/token-123") {
				return Promise.resolve({ ok: true, json: () => Promise.resolve(sharedData) });
			}
			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("🤖")).toBeInTheDocument();
		});
	});

	it("renders the embedded medication overview on the shared page when enabled", async () => {
		const sharedData = createSharedDataWithEmbeddedOverview();

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
			expect(screen.getAllByText("Aspirin").length).toBeGreaterThan(0);
			expect(screen.getAllByText("Acetylsalicylic Acid").length).toBeGreaterThan(0);
		});

		expect(screen.getByText("sharedOverview.columns.priority")).toBeInTheDocument();
		expect(screen.getByText("share.noSchedule")).toBeInTheDocument();
	});
});
