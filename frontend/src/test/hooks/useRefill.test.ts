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
		const mockHistory = [{ id: 1, packsAdded: 2, loosePillsAdded: 0, createdAt: "2024-03-15T10:00:00Z" }];

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
			refills: [{ id: 1, packsAdded: 2, createdAt: "2024-03-15T10:00:00Z" }],
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
				body: JSON.stringify({ packsAdded: 1, loosePillsAdded: 0, usePrescription: false }),
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
		expect(result.current.editStockFullBlisters).toBe(2); // 20 / 10 = 2
		expect(result.current.editStockPartialBlisterPills).toBe(0); // 20 % 10 = 0
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

	it("stock correction uses correct base for bottle type medications", async () => {
		// BUG FIX: submitStockCorrection used blister formula (packCount * blistersPerPack * pillsPerBlister + looseTablets)
		// for ALL medications, but getMedTotal() uses only looseTablets + stockAdjustment for bottles.
		// This mismatch caused the correction to compute the wrong stockAdjustment.
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true });

		const bottleMed: Medication = {
			id: 4,
			name: "Pills in a Box",
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

		// getMedTotal for bottle = looseTablets + stockAdjustment = 150 + (-2) = 148
		// getPackageSize for bottle = looseTablets = 150

		const mockLoadMeds = vi.fn();
		const { result } = renderHook(() => useRefill());

		// Pre-fill: user sees 148 pills (148 / 1 = 148 full, 0 partial)
		act(() => {
			result.current.openEditStockModal(bottleMed, {
				all: [{ name: "Pills in a Box", medsLeft: 148, daysLeft: 148 }] as Coverage[],
			});
		});

		// User adds +1 → 149 full blisters (pillsPerBlister=1)
		act(() => {
			result.current.setEditStockFullBlisters(149);
			result.current.setEditStockPartialBlisterPills(0);
		});

		await act(async () => {
			await result.current.submitStockCorrection(4, bottleMed, mockLoadMeds);
		});

		// desiredTotal = 149 * 1 + 0 = 149
		// baseTotal (fixed) = getPackageSize(bottle) = looseTablets = 150
		// newStockAdjustment = 149 - 150 = -1
		// → getMedTotal = 150 + (-1) = 149 ✓
		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(call: [string, RequestInit]) => call[0] === "/api/medications/4/stock-adjustment"
		);
		expect(fetchCall).toBeDefined();
		const body = JSON.parse(fetchCall![1].body as string);
		expect(body.stockAdjustment).toBe(-1); // NOT -2 (the old bug)
	});

	it("stock correction uses correct base for blister type medications", async () => {
		// Ensure blister type still works correctly after the bottle fix
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

		// User changes to 27 (+1): 5 full + 2 partial
		act(() => {
			result.current.setEditStockFullBlisters(5);
			result.current.setEditStockPartialBlisterPills(2);
		});

		await act(async () => {
			await result.current.submitStockCorrection(2, blisterMed, mockLoadMeds);
		});

		// desiredTotal = 5 * 5 + 2 = 27
		// baseTotal = getPackageSize(blister) = 1*5*5 + 0 = 25
		// newStockAdjustment = 27 - 25 = 2
		// → getMedTotal = 25 + 2 = 27 ✓
		const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
			(call: [string, RequestInit]) => call[0] === "/api/medications/2/stock-adjustment"
		);
		expect(fetchCall).toBeDefined();
		const body = JSON.parse(fetchCall![1].body as string);
		expect(body.stockAdjustment).toBe(2);
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
