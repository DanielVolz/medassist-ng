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

	it("reverts undo on error by re-adding the dose", async () => {
		const mockDoses = {
			doses: [{ doseId: "taken-dose", takenAt: 1710500000000, dismissed: false }],
		};

		// Initial load returns taken-dose, DELETE fails, re-sync returns taken-dose still there
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockDoses) })
			.mockRejectedValueOnce(new Error("Network error"))
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockDoses) });

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.has("taken-dose")).toBe(true);
		});

		await act(async () => {
			await result.current.undoDoseTaken("taken-dose");
		});

		// After error, the dose should be re-added (reverted)
		await waitFor(() => {
			expect(result.current.takenDoses.has("taken-dose")).toBe(true);
		});
	});

	it("populates takenDoseTimestamps from API response", async () => {
		const takenAt = 1710500000000;
		const mockDoses = {
			doses: [{ doseId: "dose-1", takenAt, dismissed: false }],
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockDoses),
		});

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoseTimestamps.get("dose-1")).toBe(takenAt);
		});
	});

	it("markDoseTaken sets takenDoseTimestamp optimistically", async () => {
		const now = Date.now();
		vi.setSystemTime(now);

		// Initial load, POST success, re-sync
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ doses: [] }) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ doses: [{ doseId: "new-dose", takenAt: now, dismissed: false }] }),
			});

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.size).toBe(0);
		});

		await act(async () => {
			await result.current.markDoseTaken("new-dose");
		});

		await waitFor(() => {
			expect(result.current.takenDoseTimestamps.has("new-dose")).toBe(true);
			expect(result.current.takenDoseTimestamps.get("new-dose")).toBe(now);
		});

		vi.useRealTimers();
	});

	it("keeps state on fetch error during initial load", async () => {
		// Initial load fails
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useDoses());

		// Should keep empty state, not crash
		await waitFor(() => {
			expect(result.current.takenDoses.size).toBe(0);
			expect(result.current.dismissedDoses.size).toBe(0);
		});
	});

	it("setShowClearMissedConfirm works", () => {
		const { result } = renderHook(() => useDoses());

		act(() => {
			result.current.setShowClearMissedConfirm(true);
		});

		expect(result.current.showClearMissedConfirm).toBe(true);
	});

	it("undoDoseTaken encodes special characters in dose ID", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ doses: [{ doseId: "dose 1/a", takenAt: Date.now(), dismissed: false }] }),
			})
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ doses: [] }) });

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.has("dose 1/a")).toBe(true);
		});

		await act(async () => {
			await result.current.undoDoseTaken("dose 1/a");
		});

		expect(fetch).toHaveBeenCalledWith("/api/doses/taken/dose%201%2Fa", expect.objectContaining({ method: "DELETE" }));
	});

	it("clears dose state when API returns 401", async () => {
		const mockDoses = {
			doses: [{ doseId: "dose-1", takenAt: Date.now(), dismissed: false }],
		};

		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockDoses) })
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });

		const { result } = renderHook(() => useDoses());

		await waitFor(() => {
			expect(result.current.takenDoses.has("dose-1")).toBe(true);
		});

		await act(async () => {
			await result.current.loadTakenDoses();
		});

		await waitFor(() => {
			expect(result.current.takenDoses.size).toBe(0);
			expect(result.current.dismissedDoses.size).toBe(0);
			expect(result.current.takenDoseTimestamps.size).toBe(0);
		});
	});
});
