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
				packageAmountValue: null,
				packageAmountUnit: null,
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
			{
				name: "Vitamin D",
				genericName: null,
				imageUrl: null,
				packageType: "bottle",
				packCount: 0,
				packageAmountValue: null,
				packageAmountUnit: null,
				blistersPerPack: 1,
				pillsPerBlister: 1,
				totalPills: 100,
				looseTablets: 100,
				currentStock: 40,
				capacity: 100,
				daysLeft: 40,
				nextIntakeDate: null,
				depletionDate: "2026-02-21",
				priority: "normal",
				expiryDate: null,
				medicationStartDate: null,
				prescriptionEnabled: false,
				prescriptionRemainingRefills: null,
			},
			{
				name: "Hydrogel",
				genericName: null,
				imageUrl: null,
				packageType: "tube",
				packCount: 2,
				packageAmountValue: 40,
				packageAmountUnit: "g",
				blistersPerPack: 1,
				pillsPerBlister: 1,
				totalPills: 80,
				looseTablets: 80,
				currentStock: 80,
				capacity: 80,
				daysLeft: null,
				nextIntakeDate: null,
				depletionDate: null,
				priority: "normal",
				expiryDate: null,
				medicationStartDate: null,
				prescriptionEnabled: false,
				prescriptionRemainingRefills: null,
			},
			{
				name: "Cough Syrup",
				genericName: null,
				imageUrl: null,
				packageType: "liquid_container",
				packCount: 3,
				packageAmountValue: 150,
				packageAmountUnit: "ml",
				blistersPerPack: 1,
				pillsPerBlister: 1,
				totalPills: 450,
				looseTablets: 450,
				currentStock: 450,
				capacity: 450,
				daysLeft: null,
				nextIntakeDate: null,
				depletionDate: null,
				priority: "normal",
				expiryDate: null,
				medicationStartDate: null,
				prescriptionEnabled: false,
				prescriptionRemainingRefills: null,
			},
		],
	};
}

function createSharedDataWithTodayDose(referenceNow: Date) {
	const currentDay = new Date(referenceNow);
	currentDay.setHours(12, 0, 0, 0);
	const scheduledAt = new Date(currentDay);
	scheduledAt.setHours(9, 0, 0, 0);
	const dateOnlyMs = new Date(scheduledAt.getFullYear(), scheduledAt.getMonth(), scheduledAt.getDate()).getTime();
	const start = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, "0")}-${String(
		scheduledAt.getDate()
	).padStart(
		2,
		"0"
	)}T${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}:00`;

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
				blisters: [{ usage: 1, every: 1, start }],
				intakes: [{ usage: 1, every: 1, start, takenBy: null, intakeRemindersEnabled: false }],
				updatedAt: null,
				dismissedUntil: null,
				lastStockCorrectionAt: null,
			},
		],
	};
}

function createSharedDoseFetchMock(options: {
	token?: string;
	sharedData: ReturnType<typeof createSharedDataWithTodayDose>;
	initialDoses?: Array<{ doseId: string; skipped?: boolean; dismissed?: boolean; takenSource?: string }>;
}) {
	const token = options.token ?? "token-123";
	const doseState = new Map((options.initialDoses ?? []).map((dose) => [dose.doseId, { ...dose }]));
	const requests: Array<{ url: string; method: string; body?: unknown }> = [];

	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string" && init.body.length > 0
				? (JSON.parse(init.body) as { doseId: string })
				: undefined;
		requests.push({ url, method, body });

		if (url === `/api/share/${token}` && method === "GET") {
			return { ok: true, json: async () => options.sharedData };
		}

		if (url === `/api/share/${token}/doses` && method === "GET") {
			return { ok: true, json: async () => ({ doses: Array.from(doseState.values()) }) };
		}

		if (url === `/api/share/${token}/doses/skip` && method === "POST" && body?.doseId) {
			doseState.set(body.doseId, { doseId: body.doseId, skipped: true });
			return { ok: true, json: async () => ({}) };
		}

		if (url === `/api/share/${token}/doses` && method === "POST" && body?.doseId) {
			doseState.set(body.doseId, { doseId: body.doseId, takenSource: "manual" });
			return { ok: true, json: async () => ({}) };
		}

		if (url.startsWith(`/api/share/${token}/doses/skip/`) && method === "DELETE") {
			const doseId = decodeURIComponent(url.split("/").at(-1) ?? "");
			doseState.delete(doseId);
			return { ok: true, json: async () => ({}) };
		}

		return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
	});

	return { fetchMock, requests, getDoses: () => Array.from(doseState.values()) };
}

describe("SharedSchedule", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.localStorage.clear();
		globalThis.fetch = vi.fn() as unknown as typeof fetch;
		vi.spyOn(globalThis, "setInterval").mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>);
		vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders shared schedule shell for valid token", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init?.method || init.method === "GET")) {
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
			if (url === "/api/share/token-123/doses" && (!init?.method || init.method === "GET")) {
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
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);

		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
			if (url === "/api/share/token-123/doses" && (!init?.method || init.method === "GET")) {
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
			if (url === "/api/share/token-123/doses" && (!init?.method || init.method === "GET")) {
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
		expect(screen.getAllByText("100").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2 x 40 form.packageAmountUnitG").length).toBeGreaterThan(0);
		expect(screen.getAllByText("3 x 150 form.packageAmountUnitMl").length).toBeGreaterThan(0);
		expect(screen.getByText("share.noSchedule")).toBeInTheDocument();
	});

	it("skips a neutral shared dose via the skip endpoint", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);
		const { fetchMock, requests } = createSharedDoseFetchMock({ sharedData });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(document.querySelector(".dose-btn.skip")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByText("dose.skip"));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: "/api/share/token-123/doses/skip",
				method: "POST",
				body: { doseId: sharedData.automaticDoseId },
			});
			expect(document.querySelector(".dose-btn.undo.skip")).toBeInTheDocument();
		});
	});

	it("undoes a skipped shared dose via the delete skip endpoint", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);
		const { fetchMock, requests } = createSharedDoseFetchMock({
			sharedData,
			initialDoses: [{ doseId: sharedData.automaticDoseId, skipped: true }],
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(document.querySelector(".dose-btn.undo.skip")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByText("dose.undoSkip"));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: `/api/share/token-123/doses/skip/${sharedData.automaticDoseId}`,
				method: "DELETE",
			});
			expect(document.querySelector(".dose-btn.skip")).toBeInTheDocument();
		});
	});

	it("takes a skipped shared dose again via the take endpoint", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);
		const { fetchMock, requests, getDoses } = createSharedDoseFetchMock({
			sharedData,
			initialDoses: [{ doseId: sharedData.automaticDoseId, skipped: true }],
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(document.querySelector(".dose-btn.undo.skip")).toBeInTheDocument();
		});

		fireEvent.click(screen.getByText("dose.take"));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: "/api/share/token-123/doses",
				method: "POST",
				body: { doseId: sharedData.automaticDoseId },
			});
			expect(getDoses()).toEqual([
				expect.objectContaining({ doseId: sharedData.automaticDoseId, takenSource: "manual" }),
			]);
			expect(document.querySelector(".day-block.today")).toHaveClass("all-taken");
		});
	});
});
