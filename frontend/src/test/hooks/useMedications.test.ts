import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMedications } from "../../hooks/useMedications";
import type { Medication } from "../../types";

describe("useMedications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve([]),
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("initializes with empty state", () => {
		const { result } = renderHook(() => useMedications());

		expect(result.current.meds).toEqual([]);
		expect(result.current.loading).toBe(false);
		expect(result.current.saving).toBe(false);
		expect(result.current.uploadingImage).toBe(false);
	});

	it("loads medications from API", async () => {
		const mockMeds = [{ id: 1, name: "TestMed", packCount: 1 }];

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockMeds),
		});

		const { result } = renderHook(() => useMedications());

		act(() => {
			result.current.loadMeds();
		});

		expect(result.current.loading).toBe(true);

		await waitFor(() => {
			expect(result.current.meds).toEqual(mockMeds);
		});

		expect(fetch).toHaveBeenCalledWith("/api/medications?includeObsolete=true", { credentials: "include" });
	});

	it("handles API error gracefully", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useMedications());

		act(() => {
			result.current.loadMeds();
		});

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		expect(result.current.meds).toEqual([]);
	});

	it("handles non-array response", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ not: "array" }),
		});

		const { result } = renderHook(() => useMedications());

		act(() => {
			result.current.loadMeds();
		});

		await waitFor(() => {
			expect(result.current.loading).toBe(false);
		});

		expect(result.current.meds).toEqual([]);
	});

	it("deletes medication", async () => {
		const mockMeds = [{ id: 1, name: "TestMed" }];
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(mockMeds) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

		const mockResetForm = vi.fn();
		const { result } = renderHook(() => useMedications());

		// First load meds
		act(() => {
			result.current.loadMeds();
		});

		await waitFor(() => {
			expect(result.current.meds).toEqual(mockMeds);
		});

		// Then delete
		await act(async () => {
			await result.current.deleteMed(1, 1, mockResetForm);
		});

		expect(fetch).toHaveBeenCalledWith("/api/medications/1", { method: "DELETE", credentials: "include" });
		expect(mockResetForm).toHaveBeenCalled();
	});

	it("still reloads medications when delete request fails", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockRejectedValueOnce(new Error("Delete failed"))
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

		const mockResetForm = vi.fn();
		const { result } = renderHook(() => useMedications());

		await act(async () => {
			await result.current.deleteMed(5, 5, mockResetForm);
		});

		expect(fetch).toHaveBeenCalledWith("/api/medications/5", { method: "DELETE", credentials: "include" });
		expect(fetch).toHaveBeenCalledWith("/api/medications?includeObsolete=true", { credentials: "include" });
		expect(mockResetForm).toHaveBeenCalled();
	});

	it("does not call resetForm if editingId does not match", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

		const mockResetForm = vi.fn();
		const { result } = renderHook(() => useMedications());

		await act(async () => {
			await result.current.deleteMed(1, 2, mockResetForm);
		});

		expect(mockResetForm).not.toHaveBeenCalled();
	});

	it("uploads medication image", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

		const { result } = renderHook(() => useMedications());
		const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

		await act(async () => {
			await result.current.uploadMedImage(1, file);
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/medications/1/image",
			expect.objectContaining({
				method: "POST",
				body: expect.any(FormData),
			})
		);
	});

	it("handles image upload error", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Upload failed"));

		const { result } = renderHook(() => useMedications());
		const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

		await expect(
			act(async () => {
				await result.current.uploadMedImage(1, file);
			})
		).rejects.toThrow("Upload failed");

		expect(result.current.uploadingImage).toBe(false);
	});

	it("deletes medication image", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) });

		const { result } = renderHook(() => useMedications());

		await act(async () => {
			await result.current.deleteMedImage(1);
		});

		expect(fetch).toHaveBeenCalledWith("/api/medications/1/image", { method: "DELETE", credentials: "include" });
	});

	it("allows setting meds directly", () => {
		const { result } = renderHook(() => useMedications());

		const newMeds: Medication[] = [
			{
				id: 1,
				name: "NewMed",
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 30,
				looseTablets: 0,
				takenBy: [],
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.setMeds(newMeds);
		});

		expect(result.current.meds).toEqual(newMeds);
	});

	it("allows setting saving state", () => {
		const { result } = renderHook(() => useMedications());

		act(() => {
			result.current.setSaving(true);
		});

		expect(result.current.saving).toBe(true);
	});
});
