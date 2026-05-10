import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRefill } from "../../hooks/useRefill";
import type { Coverage, Medication } from "../../types";

describe("useRefill", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});
		vi.spyOn(window.history, "pushState").mockImplementation(() => {});
		vi.spyOn(window.history, "back").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("initializes with default state", () => {
		const { result } = renderHook(() => useRefill());

		expect(result.current.showRefillModal).toBe(false);
		expect(result.current.refillPacks).toBe(1);
		expect(result.current.refillLoose).toBe(0);
		expect(result.current.refillSaving).toBe(false);
		expect(result.current.refillHistory).toEqual([]);
		expect(result.current.refillHistoryExpanded).toBe(false);
		expect(result.current.showEditStockModal).toBe(false);
	});

	it("loads refill history", async () => {
		const mockHistory = [
			{ id: 1, packsAdded: 2, loosePillsAdded: 0, quantityAdded: 20, createdAt: "2024-03-15T10:00:00Z" },
		];

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockHistory),
		});

		const { result } = renderHook(() => useRefill());

		await act(async () => {
			await result.current.loadRefillHistory(1);
		});

		expect(result.current.refillHistory).toEqual(mockHistory);
	});

	it("handles refill history with refills wrapper", async () => {
		const mockHistory = {
			refills: [{ id: 1, packsAdded: 2, quantityAdded: 20, createdAt: "2024-03-15T10:00:00Z" }],
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockHistory),
		});

		const { result } = renderHook(() => useRefill());

		await act(async () => {
			await result.current.loadRefillHistory(1);
		});

		expect(result.current.refillHistory).toEqual(mockHistory.refills);
	});

	it("handles refill history error", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useRefill());

		await act(async () => {
			await result.current.loadRefillHistory(1);
		});

		expect(result.current.refillHistory).toEqual([]);
	});

	it("opens refill modal and pushes history", () => {
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openRefillModal();
		});

		expect(result.current.showRefillModal).toBe(true);
		expect(window.history.pushState).toHaveBeenCalledWith({ modal: "refill" }, "");
	});

	it("resets stale refill form state when opening modal", () => {
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.setRefillPacks(4);
			result.current.setRefillLoose(9);
			result.current.setUsePrescriptionRefill(true);
		});

		act(() => {
			result.current.openRefillModal();
		});

		expect(result.current.showRefillModal).toBe(true);
		expect(result.current.refillPacks).toBe(1);
		expect(result.current.refillLoose).toBe(0);
		expect(result.current.usePrescriptionRefill).toBe(false);
	});

	it("closes refill modal using history back", () => {
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openRefillModal();
		});

		act(() => {
			result.current.closeRefillModal();
		});

		expect(window.history.back).toHaveBeenCalled();
	});

	it("does not call history back when refill modal not open", () => {
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.closeRefillModal();
		});

		expect(window.history.back).not.toHaveBeenCalled();
	});

	it("submits refill successfully", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ newStock: { packCount: 3, looseTablets: 5 } }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve([]),
			});

		const mockSetForm = vi.fn();
		const mockLoadMeds = vi.fn();

		const { result } = renderHook(() => useRefill());

		// Open modal first
		act(() => {
			result.current.openRefillModal();
		});

		await act(async () => {
			await result.current.submitRefill(1, 1, mockSetForm, mockLoadMeds);
		});

		expect(fetch).toHaveBeenNthCalledWith(
			1,
			"/api/medications/1/refill",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ packsAdded: 1, loosePillsAdded: 0, quantityAdded: 0, usePrescription: false }),
			})
		);
		expect(fetch).toHaveBeenNthCalledWith(
			2,
			"/api/medications/1/refills",
			expect.objectContaining({ credentials: "include" })
		);
		expect(mockSetForm).toHaveBeenCalled();
		expect(mockLoadMeds).toHaveBeenCalled();
	});

	it("does not submit refill if both values are 0", async () => {
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.setRefillPacks(0);
			result.current.setRefillLoose(0);
		});

		const mockSetForm = vi.fn();
		const mockLoadMeds = vi.fn();

		await act(async () => {
			await result.current.submitRefill(1, 1, mockSetForm, mockLoadMeds);
		});

		expect(fetch).not.toHaveBeenCalled();
	});

	it("opens edit stock modal", () => {
		const { result } = renderHook(() => useRefill());

		const mockMed: Medication = {
			id: 1,
			name: "Test Med",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 5,
			takenBy: [],
			packageType: "blister",
			blisters: [],
			updatedAt: null,
		};

		const mockCoverage = {
			all: [{ name: "Test Med", medsLeft: 20, daysLeft: 10 }] as Coverage[],
		};

		act(() => {
			result.current.openEditStockModal(mockMed, mockCoverage);
		});

		expect(result.current.showEditStockModal).toBe(true);
		expect(window.history.pushState).toHaveBeenCalledWith({ modal: "editStock" }, "");
		expect(result.current.editStockFullBlisters).toBe(1); // (20 - 5 loose) / 10 = 1
		expect(result.current.editStockPartialBlisterPills).toBe(5); // (20 - 5 loose) % 10 = 5
		expect(result.current.editStockLoosePills).toBe(5); // loose pills are tracked separately
	});

	it("prefills bottle correction with total pills in partial field", () => {
		const { result } = renderHook(() => useRefill());

		const bottleMed: Medication = {
			id: 4,
			name: "Bottle Test",
			packageType: "bottle",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			looseTablets: 150,
			stockAdjustment: -2,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-31T20:27:00" }],
			updatedAt: null,
		};

		act(() => {
			result.current.openEditStockModal(bottleMed, {
				all: [{ name: "Bottle Test", medsLeft: 148, daysLeft: 148 }] as Coverage[],
			});
		});

		expect(result.current.editStockFullBlisters).toBe(0);
		expect(result.current.editStockPartialBlisterPills).toBe(148);
	});

	it("closes edit stock modal using history back", () => {
		const { result } = renderHook(() => useRefill());

		const mockMed: Medication = {
			id: 1,
			name: "Test Med",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 5,
			takenBy: [],
			packageType: "blister",
			blisters: [],
			updatedAt: null,
		};

		act(() => {
			result.current.openEditStockModal(mockMed, { all: [] });
		});

		act(() => {
			result.current.closeEditStockModal();
		});

		expect(window.history.back).toHaveBeenCalled();
	});

	it("submits stock correction", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const mockMed: Medication = {
			id: 1,
			name: "Test Med",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 5,
			takenBy: [],
			packageType: "blister",
			blisters: [],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(mockMed, { all: [] });
		});

		await act(async () => {
			await result.current.submitStockCorrection(1, mockMed, mockLoadMeds);
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/medications/1/stock-adjustment",
			expect.objectContaining({ method: "PATCH" })
		);
		expect(mockLoadMeds).toHaveBeenCalled();
	});

	it("handles full blister conversion in stock correction", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const mockMed: Medication = {
			id: 1,
			name: "Test Med",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 5,
			takenBy: [],
			packageType: "blister",
			blisters: [],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(mockMed, { all: [] });
			// Set partial pills to equal a full blister
			result.current.setEditStockPartialBlisterPills(10);
		});

		await act(async () => {
			await result.current.submitStockCorrection(1, mockMed, mockLoadMeds);
		});

		expect(fetch).toHaveBeenCalled();
		expect(mockLoadMeds).toHaveBeenCalled();
	});

	it("resets blister stock correction payload to zero base fields", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const blisterMed: Medication = {
			id: 8,
			name: "Zero Reset Blister",
			packageType: "blister",
			packCount: 2,
			blistersPerPack: 3,
			pillsPerBlister: 10,
			looseTablets: 5,
			stockAdjustment: -4,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-31T20:27:00" }],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(blisterMed, {
				all: [{ name: "Zero Reset Blister", medsLeft: 31, daysLeft: 31 }] as Coverage[],
			});
			result.current.setEditStockFullBlisters(0);
			result.current.setEditStockPartialBlisterPills(0);
			result.current.setEditStockLoosePills(0);
		});

		await act(async () => {
			await result.current.submitStockCorrection(8, blisterMed, mockLoadMeds);
		});

		const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(requestInit.body as string);
		expect(body).toEqual({
			stockAdjustment: 0,
			packCount: 0,
			looseTablets: 0,
		});
	});

	it("resets bottle stock correction payload to zero base fields", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const bottleMed: Medication = {
			id: 9,
			name: "Zero Reset Bottle",
			packageType: "bottle",
			packCount: 1,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 100,
			looseTablets: 20,
			stockAdjustment: 5,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-31T20:27:00" }],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(bottleMed, {
				all: [{ name: "Zero Reset Bottle", medsLeft: 25, daysLeft: 25 }] as Coverage[],
			});
			result.current.setEditStockFullBlisters(0);
			result.current.setEditStockPartialBlisterPills(0);
		});

		await act(async () => {
			await result.current.submitStockCorrection(9, bottleMed, mockLoadMeds);
		});

		const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(requestInit.body as string);
		expect(body).toEqual({
			stockAdjustment: 0,
			packCount: 0,
			looseTablets: 0,
			totalPills: 0,
		});
	});

	it.each([
		{
			label: "liquid container",
			id: 10,
			med: {
				id: 10,
				name: "Zero Reset Liquid",
				medicationForm: "liquid",
				packageType: "liquid_container",
				doseUnit: "ml",
				packCount: 1,
				packageAmountValue: 180,
				packageAmountUnit: "ml",
				blistersPerPack: 1,
				pillsPerBlister: 1,
				totalPills: 180,
				looseTablets: 180,
				stockAdjustment: 0,
				takenBy: [],
				blisters: [{ usage: 5, every: 1, start: "2026-01-31T20:27:00" }],
				updatedAt: null,
			} satisfies Medication,
			coverage: 180,
		},
		{
			label: "tube",
			id: 11,
			med: {
				id: 11,
				name: "Zero Reset Tube",
				medicationForm: "topical",
				packageType: "tube",
				doseUnit: "units",
				packCount: 2,
				packageAmountValue: 40,
				packageAmountUnit: "g",
				blistersPerPack: 1,
				pillsPerBlister: 1,
				totalPills: 80,
				looseTablets: 80,
				stockAdjustment: 0,
				takenBy: [],
				blisters: [{ usage: 2, every: 1, start: "2026-01-31T20:27:00" }],
				updatedAt: null,
			} satisfies Medication,
			coverage: 80,
		},
	])("resets $label stock correction payload to zero amount-base fields", async ({ id, med, coverage }) => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(med, {
				all: [{ name: med.name, medsLeft: coverage, daysLeft: coverage }] as Coverage[],
			});
			result.current.setEditStockFullBlisters(0);
			result.current.setEditStockPartialBlisterPills(0);
		});

		await act(async () => {
			await result.current.submitStockCorrection(id, med, mockLoadMeds);
		});

		const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(requestInit.body as string);
		expect(body).toEqual({
			stockAdjustment: 0,
			packCount: 0,
			looseTablets: 0,
			totalPills: 0,
			packageAmountValue: 0,
		});
	});

	it("keeps liquid stock correction base fields aligned", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const liquidMed: Medication = {
			id: 12,
			name: "Aligned Liquid",
			medicationForm: "liquid",
			packageType: "liquid_container",
			doseUnit: "ml",
			packCount: 1,
			packageAmountValue: 180,
			packageAmountUnit: "ml",
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 180,
			looseTablets: 180,
			stockAdjustment: 0,
			takenBy: [],
			blisters: [{ usage: 5, every: 1, start: "2026-01-31T20:27:00" }],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(liquidMed, {
				all: [{ name: liquidMed.name, medsLeft: 180, daysLeft: 36 }] as Coverage[],
			});
			result.current.setEditStockFullBlisters(2);
			result.current.setEditStockPartialBlisterPills(300);
		});

		await act(async () => {
			await result.current.submitStockCorrection(12, liquidMed, mockLoadMeds);
		});

		const [, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
		const body = JSON.parse(requestInit.body as string);
		expect(body).toEqual({
			stockAdjustment: -60,
			packCount: 2,
			totalPills: 360,
			looseTablets: 360,
		});
	});

	it("stock correction uses loose tablets rather than bottle capacity as the base", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const bottleMed: Medication = {
			id: 4,
			name: "Capacity Bottle",
			packageType: "bottle",
			packCount: 0,
			blistersPerPack: 1,
			pillsPerBlister: 1,
			totalPills: 100,
			looseTablets: 20,
			stockAdjustment: 5,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-31T20:27:00" }],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(bottleMed, {
				all: [{ name: "Capacity Bottle", medsLeft: 25, daysLeft: 25 }] as Coverage[],
			});
		});

		// User corrects current stock to 70 pills.
		act(() => {
			result.current.setEditStockPartialBlisterPills(70);
		});

		await act(async () => {
			await result.current.submitStockCorrection(4, bottleMed, mockLoadMeds);
		});

		// desiredTotal = 149
		// baseTotal (fixed) = getPackageSize(bottle) = looseTablets = 150
		// newStockAdjustment = 149 - 150 = -1
		// → getMedTotal = 150 + (-1) = 149 ✓
		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(call) => call[0] === "/api/medications/4/stock-adjustment"
		);
		expect(fetchCall).toBeDefined();
		const body = JSON.parse(fetchCall![1].body as string);
		expect(body.stockAdjustment).toBe(50);
		expect(body.looseTablets).toBeUndefined();
	});

	it("stock correction clamps blister totals to package size", async () => {
		// Ensure blister correction enforces configured package max.
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const blisterMed: Medication = {
			id: 2,
			name: "Blister Med",
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 5,
			pillsPerBlister: 5,
			looseTablets: 0,
			stockAdjustment: 1,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-30T21:07:00" }],
			updatedAt: null,
		};

		// getMedTotal for blister = 1*5*5 + 0 + 1 = 26
		// getPackageSize for blister = 1*5*5 + 0 = 25

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		// User sees 26 pills → 5 full blisters (5pills each) + 1 partial
		act(() => {
			result.current.openEditStockModal(blisterMed, {
				all: [{ name: "Blister Med", medsLeft: 26, daysLeft: 26 }] as Coverage[],
			});
		});

		// User attempts to set 27 (+1): 5 full + 2 partial.
		act(() => {
			result.current.setEditStockFullBlisters(5);
			result.current.setEditStockPartialBlisterPills(2);
		});

		await act(async () => {
			await result.current.submitStockCorrection(2, blisterMed, mockLoadMeds);
		});

		// desiredTotal is capped to package max (25)
		// baseTotal = getPackageSize(blister) = 25
		// newStockAdjustment = 25 - 25 = 0
		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(call) => call[0] === "/api/medications/2/stock-adjustment"
		);
		expect(fetchCall).toBeDefined();
		const body = JSON.parse(fetchCall![1].body as string);
		expect(body.stockAdjustment).toBe(0);
	});

	it("stock correction allows loose pills beyond package size", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const blisterMed: Medication = {
			id: 5,
			name: "Loose Friendly",
			packageType: "blister",
			packCount: 1,
			blistersPerPack: 2,
			pillsPerBlister: 10,
			looseTablets: 0,
			stockAdjustment: 0,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-30T21:07:00" }],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(blisterMed, {
				all: [{ name: "Loose Friendly", medsLeft: 0, daysLeft: 0 }] as Coverage[],
			});
			// sealed package part at max (20), loose adds +7 beyond max
			result.current.setEditStockFullBlisters(2);
			result.current.setEditStockPartialBlisterPills(0);
			result.current.setEditStockLoosePills(7);
		});

		await act(async () => {
			await result.current.submitStockCorrection(5, blisterMed, mockLoadMeds);
		});

		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(call) => call[0] === "/api/medications/5/stock-adjustment"
		);
		expect(fetchCall).toBeDefined();
		const body = JSON.parse(fetchCall![1].body as string);
		// NEW: baseTotal = structuralMax + finalLoosePills = 20 + 7 = 27; desiredTotal = 27 => stockAdjustment=0
		// looseTablets is sent separately so DB reflects the actual loose count after correction
		expect(body.stockAdjustment).toBe(0);
		expect(body.looseTablets).toBe(7);
	});

	it("stock correction carries partial overflow into full blisters", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const blisterMed: Medication = {
			id: 6,
			name: "Carry Partial",
			packageType: "blister",
			packCount: 11,
			blistersPerPack: 5,
			pillsPerBlister: 5,
			looseTablets: 2,
			stockAdjustment: -223,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-30T21:07:00" }],
			updatedAt: null,
		};

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(blisterMed, {
				all: [{ name: "Carry Partial", medsLeft: 54, daysLeft: 54 }] as Coverage[],
			});
			// 10 full + 5 partial + 2 loose should canonicalize to 11 full + 0 partial + 2 loose => 57
			result.current.setEditStockFullBlisters(10);
			result.current.setEditStockPartialBlisterPills(5);
			result.current.setEditStockLoosePills(2);
		});

		await act(async () => {
			await result.current.submitStockCorrection(6, blisterMed, mockLoadMeds);
		});

		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(call) => call[0] === "/api/medications/6/stock-adjustment"
		);
		expect(fetchCall).toBeDefined();
		const body = JSON.parse(fetchCall![1].body as string);
		// baseTotal = structuralMax + finalLoosePills = 275 + 2 = 277; desiredTotal = 57 => stockAdjustment = -220
		expect(body.stockAdjustment).toBe(-220);
		expect(body.looseTablets).toBe(2);
	});

	it("prefill keeps loose pills separate from partial blister pills", () => {
		const blisterMed: Medication = {
			id: 7,
			name: "Loose Separate",
			packageType: "blister",
			packCount: 11,
			blistersPerPack: 5,
			pillsPerBlister: 5,
			looseTablets: 2,
			stockAdjustment: -223,
			takenBy: [],
			blisters: [{ usage: 1, every: 1, start: "2026-01-30T21:07:00" }],
			updatedAt: null,
		};

		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.openEditStockModal(blisterMed, {
				all: [{ name: "Loose Separate", medsLeft: 54, daysLeft: 54 }] as Coverage[],
			});
		});

		expect(result.current.editStockFullBlisters).toBe(10);
		expect(result.current.editStockPartialBlisterPills).toBe(2);
		expect(result.current.editStockLoosePills).toBe(2);
	});

	it("allows setting state directly", () => {
		const { result } = renderHook(() => useRefill());

		act(() => {
			result.current.setRefillPacks(5);
			result.current.setRefillLoose(3);
			result.current.setRefillHistoryExpanded(true);
			result.current.setShowRefillModal(true);
			result.current.setShowEditStockModal(true);
			result.current.setEditStockFullBlisters(10);
			result.current.setEditStockPartialBlisterPills(5);
		});

		expect(result.current.refillPacks).toBe(5);
		expect(result.current.refillLoose).toBe(3);
		expect(result.current.refillHistoryExpanded).toBe(true);
		expect(result.current.showRefillModal).toBe(true);
		expect(result.current.showEditStockModal).toBe(true);
		expect(result.current.editStockFullBlisters).toBe(10);
		expect(result.current.editStockPartialBlisterPills).toBe(5);
	});
});
