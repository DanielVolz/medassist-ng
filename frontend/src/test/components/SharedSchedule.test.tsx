import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockSharedScheduleRead, renderSharedSchedule } from "../helpers/shared-schedule";

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
				imageUrl: null as string | null,
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
				imageUrl: null as string | null,
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
		allowJournalNotes: false,
		automaticDoseId: `1-0-${dateOnlyMs}`,
		medications: [
			{
				id: 1,
				name: "Ibuprofen",
				genericName: null,
				imageUrl: null as string | null,
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

function createSharedDataWithFutureDose(referenceNow: Date) {
	const data = createSharedDataWithTodayDose(referenceNow);
	const scheduledAt = new Date(referenceNow);
	scheduledAt.setDate(scheduledAt.getDate() + 1);
	scheduledAt.setHours(9, 0, 0, 0);
	const dateOnlyMs = new Date(scheduledAt.getFullYear(), scheduledAt.getMonth(), scheduledAt.getDate()).getTime();
	const start = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, "0")}-${String(
		scheduledAt.getDate()
	).padStart(
		2,
		"0"
	)}T${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}:00`;

	data.automaticDoseId = `1-0-${dateOnlyMs}`;
	data.medications[0].blisters[0].start = start;
	data.medications[0].intakes[0].start = start;
	return data;
}

function createSharedDoseFetchMock(options: {
	token?: string;
	sharedData: ReturnType<typeof createSharedDataWithTodayDose>;
	initialDoses?: Array<{
		doseId: string;
		skipped?: boolean;
		dismissed?: boolean;
		markedBy?: string | null;
		takenSource?: string;
		hasJournalNote?: boolean;
	}>;
}) {
	const token = options.token ?? "token-123";
	const doseState = new Map((options.initialDoses ?? []).map((dose) => [dose.doseId, { ...dose }]));
	const journalState = new Map<
		string,
		{
			note: string | null;
			mood: "very_bad" | "bad" | "neutral" | "good" | "very_good" | null;
			createdAt: string | null;
			updatedAt: string | null;
		}
	>();
	const requests: Array<{ url: string; method: string; body?: unknown }> = [];

	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const body =
			typeof init?.body === "string" && init.body.length > 0
				? (JSON.parse(init.body) as {
						doseId?: string;
						note?: string | null;
						mood?: "very_bad" | "bad" | "neutral" | "good" | "very_good" | null;
					})
				: undefined;
		requests.push({ url, method, body });

		if (url === `/api/share/${token}` && method === "GET") {
			return { ok: true, json: async () => options.sharedData };
		}

		if (url === `/api/share/${token}/doses` && method === "GET") {
			const doses = Array.from(doseState.values()).map((dose) => ({
				...dose,
				hasJournalNote:
					dose.hasJournalNote === true ||
					Boolean(journalState.get(dose.doseId)?.note?.trim()) ||
					Boolean(journalState.get(dose.doseId)?.mood),
			}));
			return { ok: true, json: async () => ({ doses }) };
		}

		if (url === `/api/share/${token}/doses/skip` && method === "POST" && body?.doseId) {
			doseState.set(body.doseId, { doseId: body.doseId, skipped: true });
			return { ok: true, json: async () => ({}) };
		}

		if (url === `/api/share/${token}/doses` && method === "POST" && body?.doseId) {
			doseState.set(body.doseId, { doseId: body.doseId, takenSource: "manual" });
			return { ok: true, json: async () => ({}) };
		}

		if (url.startsWith(`/api/share/${token}/journal/event/`) && method === "GET") {
			const doseId = decodeURIComponent(url.split("/").at(-1) ?? "");
			const journal = journalState.get(doseId) ?? { note: null, mood: null, createdAt: null, updatedAt: null };
			return {
				ok: true,
				json: async () => ({
					entry: {
						doseTrackingId: 1,
						doseId,
						medicationId: 1,
						medicationName: "Ibuprofen",
						scheduledFor: new Date().toISOString(),
						takenAt: new Date().toISOString(),
						dismissed: false,
						takenSource: "manual",
						markedBy: "Max",
						mood: journal.mood,
						note: journal.note,
						createdAt: journal.createdAt,
						updatedAt: journal.updatedAt,
					},
				}),
			};
		}

		if (url.startsWith(`/api/share/${token}/journal/event/`) && method === "PUT") {
			const doseId = decodeURIComponent(url.split("/").at(-1) ?? "");
			const timestamp = new Date().toISOString();
			journalState.set(doseId, {
				note: body?.note ?? null,
				mood: body?.mood ?? null,
				createdAt: timestamp,
				updatedAt: timestamp,
			});
			return {
				ok: true,
				json: async () => ({
					entry: {
						doseTrackingId: 1,
						doseId,
						medicationId: 1,
						medicationName: "Ibuprofen",
						scheduledFor: new Date().toISOString(),
						takenAt: new Date().toISOString(),
						dismissed: false,
						takenSource: "manual",
						markedBy: "Max",
						mood: body?.mood ?? null,
						note: body?.note ?? null,
						createdAt: timestamp,
						updatedAt: timestamp,
					},
				}),
			};
		}

		if (url.startsWith(`/api/share/${token}/journal/event/`) && method === "DELETE") {
			const doseId = decodeURIComponent(url.split("/").at(-1) ?? "");
			journalState.delete(doseId);
			return { ok: true, json: async () => ({ success: true }) };
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

function openButtonTooltip(button: HTMLElement) {
	const target = button.closest("span");
	expect(target).not.toBeNull();
	fireEvent.touchStart(target as HTMLElement);
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

	it("renders a single loading message while the shared link is loading", () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));

		renderSharedSchedule("/share/token-123");

		expect(screen.getAllByText("common.loading")).toHaveLength(1);
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
			expect(screen.getByRole("button", { name: "share.publicAccessSummary" })).toBeInTheDocument();
			expect(screen.getByText("share.noSchedule")).toBeInTheDocument();
		});

		const helpToggle = screen.getByRole("button", { name: "share.publicAccessSummary" });
		expect(helpToggle).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText("share.publicAccessHelp")).not.toBeInTheDocument();

		fireEvent.click(helpToggle);

		expect(helpToggle).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByText("share.publicAccessHelp")).toBeInTheDocument();
	});

	it("shows low and out-of-stock markers on shared schedule rows", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);
		sharedData.medications = [
			{
				...sharedData.medications[0],
				name: "Low Shared Med",
			},
			{
				...sharedData.medications[0],
				id: 2,
				name: "Empty Shared Med",
			},
		];
		const sharedDataWithStock = {
			...sharedData,
			stockThresholds: {
				lowStockDays: 30,
				normalStockDays: 60,
				highStockDays: 90,
				reminderDaysBefore: 7,
				expiryWarningDays: 90,
			},
			medicationOverview: [
				{
					name: "Low Shared Med",
					currentStock: 10,
					daysLeft: 10,
				},
				{
					name: "Empty Shared Med",
					currentStock: 0,
					daysLeft: 0,
				},
			],
		};

		mockSharedScheduleRead(sharedDataWithStock);

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("status.lowStock")).toHaveClass("tag", "warning");
			expect(screen.getByText("status.outOfStock")).toHaveClass("tag", "danger");
		});
		expect(document.querySelector(".time-row.med-low")).toBeInTheDocument();
		expect(document.querySelector(".time-row.med-empty")).toBeInTheDocument();
		expect(document.querySelector(".dose-item.med-low")).toBeInTheDocument();
		expect(document.querySelector(".dose-item.med-empty")).toBeInTheDocument();
	});

	it("opens and saves a shared journal note when the share link allows notes", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = {
			...createSharedDataWithTodayDose(referenceNow),
			allowJournalNotes: true,
		};
		const { fetchMock, requests } = createSharedDoseFetchMock({
			sharedData,
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "dose.take" })).toBeInTheDocument();
		});

		const unavailableJournalButton = screen.getByRole("button", { name: "journal.actions.note" });
		expect(unavailableJournalButton).toBeDisabled();
		expect(unavailableJournalButton.className).not.toContain("hasNote");
		expect(unavailableJournalButton.closest("[data-tooltip]")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "dose.take" }));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: "/api/share/token-123/doses",
				method: "POST",
				body: { doseId: sharedData.automaticDoseId },
			});
			expect(document.querySelector(".day-block.today")).not.toHaveClass("collapsed");
		});

		await waitFor(() => {
			const availableJournalButton = screen.getByRole("button", { name: "journal.actions.note" });
			expect(availableJournalButton).not.toBeDisabled();
			expect(availableJournalButton.className).not.toContain("hasNote");
			expect(availableJournalButton.closest("[data-tooltip]")).toBeNull();
		});

		fireEvent.click(screen.getByRole("button", { name: "journal.actions.note" }));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: `/api/share/token-123/journal/event/${sharedData.automaticDoseId}`,
				method: "GET",
				body: undefined,
			});
		});

		await waitFor(() => {
			expect(screen.getByLabelText("journal.editor.noteLabel")).toHaveValue("");
		});
		expect(screen.queryByRole("button", { name: "common.delete" })).not.toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("journal.editor.noteLabel"), { target: { value: "Shared note" } });
		fireEvent.click(screen.getByRole("button", { name: "journal.mood.values.good" }));
		fireEvent.click(screen.getByRole("button", { name: "common.save" }));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: `/api/share/token-123/journal/event/${sharedData.automaticDoseId}`,
				method: "PUT",
				body: { note: "Shared note", mood: "good" },
			});
		});

		await waitFor(() => {
			expect(screen.queryByLabelText("journal.editor.noteLabel")).not.toBeInTheDocument();
			const savedJournalButton = screen.getByRole("button", { name: "journal.actions.note" });
			expect(savedJournalButton.className).toContain("hasNote");
		});
	});

	it("marks shared journal notes from the shared dose read state", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = {
			...createSharedDataWithTodayDose(referenceNow),
			allowJournalNotes: true,
		};
		const { fetchMock } = createSharedDoseFetchMock({
			sharedData,
			initialDoses: [{ doseId: sharedData.automaticDoseId, takenSource: "manual", hasJournalNote: true }],
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			const journalButton = screen.getByRole("button", { name: "journal.actions.note" });
			expect(journalButton).not.toBeDisabled();
			expect(journalButton.className).toContain("hasNote");
		});
	});

	it("adds the share token to public shared medication image URLs", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);
		sharedData.medications[0].imageUrl = "med-1-123.webp";
		const { fetchMock } = createSharedDoseFetchMock({ sharedData });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			const image = screen.getByAltText("Ibuprofen");
			expect(image).toHaveAttribute("src", "/api/images/med-1-123-thumb.webp?shareToken=token-123");
		});

		fireEvent.click(screen.getByRole("button", { name: "Ibuprofen" }));

		await waitFor(() => {
			expect(screen.getAllByAltText("Ibuprofen")).toHaveLength(2);
			expect(screen.getAllByAltText("Ibuprofen")[1]).toHaveAttribute(
				"src",
				"/api/images/med-1-123.webp?shareToken=token-123"
			);
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

	it("switches shared schedules to the owner language from the share response", async () => {
		const { i18n } = useTranslation();
		mockSharedScheduleRead({ ...createSharedData(), language: "de" });

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(i18n.changeLanguage).toHaveBeenCalledWith("de");
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
		const currentYear = new Date().getFullYear();
		sharedData.medicationOverview[0].depletionDate = `${currentYear}-07-14`;
		sharedData.medicationOverview[1].depletionDate = `${currentYear + 1}-05-01`;

		mockSharedScheduleRead(sharedData);

		const { container } = renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getAllByText("Aspirin").length).toBeGreaterThan(0);
			expect(screen.getAllByText("Acetylsalicylic Acid").length).toBeGreaterThan(0);
		});

		expect(screen.getByText("sharedOverview.columns.priority")).toBeInTheDocument();
		expect(screen.getAllByText("100").length).toBeGreaterThan(0);
		expect(screen.getAllByText("2 x 40 form.packageAmountUnitG").length).toBeGreaterThan(0);
		expect(screen.getAllByText("3 x 150 form.packageAmountUnitMl").length).toBeGreaterThan(0);
		expect(screen.getByText("share.noSchedule")).toBeInTheDocument();

		const dateValues = Array.from(container.querySelectorAll('[class*="shared-overview-date-value"]')).map(
			(element) => element.textContent ?? ""
		);
		expect(
			dateValues.some((value) => /14/.test(value) && /Jul/i.test(value) && !value.includes(String(currentYear)))
		).toBe(true);
		expect(dateValues.some((value) => /May/i.test(value) && value.includes(String(currentYear + 1)))).toBe(true);
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
			expect(screen.getByRole("button", { name: "dose.skip" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "dose.skip" }));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: "/api/share/token-123/doses/skip",
				method: "POST",
				body: { doseId: sharedData.automaticDoseId },
			});
			expect(screen.getByRole("button", { name: "dose.undoAction" })).toBeInTheDocument();
		});
	});

	it("explains that future shared doses cannot be taken or skipped", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithFutureDose(referenceNow);
		const { fetchMock, requests } = createSharedDoseFetchMock({ sharedData });
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");

		await waitFor(() => {
			expect(screen.getByText("dashboard.schedules.showFutureDays")).toBeInTheDocument();
		});

		const futureToggle = screen.getByText("dashboard.schedules.showFutureDays").closest(".future-days-toggle");
		expect(futureToggle).not.toBeNull();
		fireEvent.click(futureToggle as HTMLElement);
		const futureDayToggle = document.querySelector(".day-block:not(.today) .day-divider.clickable");
		expect(futureDayToggle).not.toBeNull();
		fireEvent.click(futureDayToggle as HTMLElement);

		const takeButton = await screen.findByRole("button", { name: "dose.take" });
		const skipButton = screen.getByRole("button", { name: "dose.skip" });
		expect(takeButton).toBeDisabled();
		expect(skipButton).toBeDisabled();
		expect(document.querySelector(".dose-item.future.med-empty")).toBeNull();

		fireEvent.click(takeButton);
		fireEvent.click(skipButton);
		expect(requests.some((request) => request.method === "POST")).toBe(false);

		openButtonTooltip(takeButton);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("share.actionBlocked.futureTake");

		fireEvent.touchMove(takeButton.closest("span") as HTMLElement);
		expect(screen.getByRole("tooltip")).toHaveTextContent("share.actionBlocked.futureTake");

		fireEvent.touchStart(document.body);
		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});

		openButtonTooltip(skipButton);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("share.actionBlocked.futureSkip");
	});

	it("explains that doses already taken in the main app cannot be changed from the shared link", async () => {
		const referenceNow = new Date();
		referenceNow.setHours(12, 0, 0, 0);
		vi.spyOn(Date, "now").mockReturnValue(referenceNow.getTime());
		const sharedData = createSharedDataWithTodayDose(referenceNow);
		const { fetchMock, requests } = createSharedDoseFetchMock({
			sharedData,
			initialDoses: [{ doseId: sharedData.automaticDoseId, markedBy: null, takenSource: "manual" }],
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		renderSharedSchedule("/share/token-123");
		await waitFor(() => {
			expect(document.querySelector(".day-block.today .day-divider.clickable")).toBeInTheDocument();
		});

		fireEvent.click(document.querySelector(".day-block.today .day-divider.clickable") as HTMLElement);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "dose.undoAction" })).toBeDisabled();
			expect(screen.getByRole("button", { name: "dose.skip" })).toBeDisabled();
		});

		const undoButton = screen.getByRole("button", { name: "dose.undoAction" });
		const skipButton = screen.getByRole("button", { name: "dose.skip" });
		fireEvent.click(undoButton);
		fireEvent.click(skipButton);
		expect(requests.some((request) => request.method === "DELETE" || request.method === "POST")).toBe(false);

		openButtonTooltip(undoButton);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("share.actionBlocked.alreadyTakenMainApp");

		fireEvent.touchMove(undoButton.closest("span") as HTMLElement);
		expect(screen.getByRole("tooltip")).toHaveTextContent("share.actionBlocked.alreadyTakenMainApp");

		fireEvent.touchStart(document.body);
		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});

		openButtonTooltip(skipButton);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("share.actionBlocked.alreadyTakenMainApp");
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
			expect(screen.getByRole("button", { name: "dose.undoAction" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "dose.undoAction" }));

		await waitFor(() => {
			expect(requests).toContainEqual({
				url: `/api/share/token-123/doses/skip/${sharedData.automaticDoseId}`,
				method: "DELETE",
			});
			expect(screen.getByRole("button", { name: "dose.skip" })).toBeInTheDocument();
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
			expect(screen.getByRole("button", { name: "dose.undoAction" })).toBeInTheDocument();
		});

		fireEvent.click(screen.getByRole("button", { name: "dose.take" }));

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
