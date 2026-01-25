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

		expect(fetch).toHaveBeenCalledWith(
			"/api/medications/1/refill",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ packsAdded: 1, loosePillsAdded: 0 }),
			})
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
