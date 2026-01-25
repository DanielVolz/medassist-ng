import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "../../hooks/useSettings";

describe("useSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({}),
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("initializes with default settings", () => {
		const { result } = renderHook(() => useSettings());

		expect(result.current.settings.emailEnabled).toBe(false);
		expect(result.current.settings.lowStockDays).toBe(30);
		expect(result.current.settings.reminderDaysBefore).toBe(7);
		expect(result.current.settingsLoading).toBe(true);
	});

	it("loads settings from API on mount", async () => {
		const mockSettings = {
			emailEnabled: true,
			notificationEmail: "test@example.com",
			lowStockDays: 14,
		};

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(mockSettings),
		});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		expect(result.current.settings.emailEnabled).toBe(true);
		expect(result.current.settings.notificationEmail).toBe("test@example.com");
	});

	it("handles API error on load", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});
	});

	it("saves settings to API", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: true });

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

		await act(async () => {
			await result.current.saveSettings(mockEvent);
		});

		expect(fetch).toHaveBeenCalledWith(
			"/api/settings",
			expect.objectContaining({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
			})
		);
		expect(result.current.settingsSaved).toBe(true);
	});

	it("validates email before saving", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({}),
		});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		// Set invalid email
		act(() => {
			result.current.setSettings((s) => ({
				...s,
				emailEnabled: true,
				notificationEmail: "invalid-email",
			}));
		});

		const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

		await act(async () => {
			await result.current.saveSettings(mockEvent);
		});

		expect(result.current.testEmailResult?.success).toBe(false);
		expect(result.current.testEmailResult?.message).toContain("Invalid email");
	});

	it("tests email notification", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ message: "Email sent!" }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		await act(async () => {
			await result.current.testEmail();
		});

		expect(result.current.testEmailResult?.success).toBe(true);
		expect(result.current.testingEmail).toBe(false);
	});

	it("handles test email failure", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		await act(async () => {
			await result.current.testEmail();
		});

		expect(result.current.testEmailResult?.success).toBe(false);
	});

	it("tests shoutrrr notification", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ message: "Notification sent!" }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		await act(async () => {
			await result.current.testShoutrrr();
		});

		expect(result.current.testShoutrrrResult?.success).toBe(true);
		expect(result.current.testingShoutrrr).toBe(false);
	});

	it("tracks unsaved changes", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ lowStockDays: 30 }),
		});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		expect(result.current.hasUnsavedChanges).toBe(false);

		act(() => {
			result.current.setSettings((s) => ({ ...s, lowStockDays: 14 }));
		});

		expect(result.current.hasUnsavedChanges).toBe(true);
	});

	it("loadSettings can be called manually", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ lowStockDays: 14 }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		act(() => {
			result.current.loadSettings();
		});

		await waitFor(() => {
			expect(result.current.settings.lowStockDays).toBe(14);
		});
	});

	it("auto-disables email when no recipient", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: true });

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		act(() => {
			result.current.setSettings((s) => ({
				...s,
				emailEnabled: true,
				notificationEmail: "",
			}));
		});

		const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

		await act(async () => {
			await result.current.saveSettings(mockEvent);
		});

		// emailEnabled should be false in the saved state
		expect(result.current.settings.emailEnabled).toBe(false);
	});
});
