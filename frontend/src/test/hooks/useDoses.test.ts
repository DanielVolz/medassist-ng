import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDoses } from "../../hooks/useDoses";

describe("useDoses", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ doses: [] }),
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("initializes with empty state", () => {
		const { result } = renderHook(() => useDoses());

		expect(result.current.takenDoses.size).toBe(0);
		expect(result.current.dismissedDoses.size).toBe(0);
		expect(result.current.showClearMissedConfirm).toBe(false);
	});

	it("loads taken doses from API on mount", async () => {
		const mockDoses = {
			doses: [
				{ doseId: "dose-1", dismissed: false },
				{ doseId: "dose-2", dismissed: true },
			],
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockDoses),
		});

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.has("dose-1")).toBe(true);
			expect(result.current.dismissedDoses.has("dose-2")).toBe(true);
		});
	});

	it("getDoseId returns correct ID format", () => {
		const { result } = renderHook(() => useDoses());

		expect(result.current.getDoseId("dose-1", null)).toBe("dose-1");
		expect(result.current.getDoseId("dose-1", "John")).toBe("dose-1-John");
	});

	it("countTakenDoses calculates correctly", async () => {
		const mockDoses = {
			doses: [{ doseId: "dose-1", dismissed: false }],
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockDoses),
		});

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.has("dose-1")).toBe(true);
		});

		const doses = [
			{ id: "dose-1", takenBy: [] },
			{ id: "dose-2", takenBy: [] },
		];

		const count = result.current.countTakenDoses(doses);
		expect(count.total).toBe(2);
		expect(count.taken).toBe(1);
	});

	it("countTakenDoses handles multiple people", async () => {
		const mockDoses = {
			doses: [
				{ doseId: "dose-1-Alice", dismissed: false },
				{ doseId: "dose-1-Bob", dismissed: false },
			],
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockDoses),
		});

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.size).toBe(2);
		});

		const doses = [{ id: "dose-1", takenBy: ["Alice", "Bob", "Charlie"] }];
		const count = result.current.countTakenDoses(doses);
		expect(count.total).toBe(3);
		expect(count.taken).toBe(2);
	});

	it("marks dose as taken optimistically", async () => {
		// First call for initial load, second for marking dose, third for re-sync
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ doses: [] }) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ doses: [{ doseId: "new-dose", takenAt: Date.now(), dismissed: false }] }),
			});

		const { result } = renderHook(() => useDoses());

		// Wait for initial load to complete
		await waitFor(() => {
			expect(result.current.takenDoses.size).toBe(0);
		});

		await act(async () => {
			await result.current.markDoseTaken("new-dose");
		});

		await waitFor(() => {
			expect(result.current.takenDoses.has("new-dose")).toBe(true);
		});
		expect(fetch).toHaveBeenCalledWith(
			"/api/doses/taken",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ doseId: "new-dose" }),
			})
		);
	});

	it("reverts optimistic update on error", async () => {
		// First call for initial load, second for marking dose fails, third for re-sync
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ doses: [] }) })
			.mockRejectedValueOnce(new Error("Network error"))
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ doses: [] }) });

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.size).toBe(0);
		});

		await act(async () => {
			await result.current.markDoseTaken("new-dose");
		});

		// After error, the dose should be removed
		await waitFor(() => {
			expect(result.current.takenDoses.has("new-dose")).toBe(false);
		});
	});

	it("undoes dose taken optimistically", async () => {
		const mockDoses = {
			doses: [{ doseId: "taken-dose", takenAt: Date.now(), dismissed: false }],
		};

		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockDoses) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ doses: [] }) });

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.has("taken-dose")).toBe(true);
		});

		await act(async () => {
			await result.current.undoDoseTaken("taken-dose");
		});

		await waitFor(() => {
			expect(result.current.takenDoses.has("taken-dose")).toBe(false);
		});
		expect(fetch).toHaveBeenCalledWith("/api/doses/taken/taken-dose", expect.objectContaining({ method: "DELETE" }));
	});

	it("setShowClearMissedConfirm works", () => {
		const { result } = renderHook(() => useDoses());

		act(() => {
			result.current.setShowClearMissedConfirm(true);
		});

		expect(result.current.showClearMissedConfirm).toBe(true);
	});
});
