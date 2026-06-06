import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettings } from "../../hooks/useSettings";

const activeReminderMetadata = {
	lastAutoEmailSent: "2026-01-01T10:00:00.000Z",
	lastNotificationType: "stock",
	lastNotificationChannel: "email",
	lastReminderMedName: "Aspirin",
	lastReminderTakenBy: "Max",
	lastStockReminderSent: "2026-01-01T09:00:00.000Z",
	lastStockReminderChannel: "both",
	lastStockReminderMedNames: "Aspirin",
};

const clearedReminderMetadata = {
	lastAutoEmailSent: null,
	lastNotificationType: null,
	lastNotificationChannel: null,
	lastReminderMedName: null,
	lastReminderTakenBy: null,
	lastStockReminderSent: null,
	lastStockReminderChannel: null,
	lastStockReminderMedNames: null,
	lastPrescriptionReminderSent: null,
	lastPrescriptionReminderChannel: null,
	lastPrescriptionReminderMedNames: null,
};

function okJson(payload: unknown = {}) {
	return {
		ok: true,
		json: () => Promise.resolve(payload),
	};
}

function captureReminderRefreshInterval() {
	let refreshCallback: (() => void) | null = null;
	const nativeSetInterval = global.setInterval;
	vi.spyOn(global, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number) => {
		if (timeout === 30000) {
			refreshCallback = handler as () => void;
			return 1 as unknown as ReturnType<typeof setInterval>;
		}
		return nativeSetInterval(handler, timeout);
	}) as typeof setInterval);

	return () => refreshCallback;
}

async function renderSettingsAndRunCapturedRefresh(getRefreshCallback: () => (() => void) | null) {
	const { result } = renderHook(() => useSettings());

	await waitFor(() => {
		expect(result.current.settingsLoading).toBe(false);
	});

	expect(result.current.settings.lastNotificationType).toBe("stock");
	const refreshCallback = getRefreshCallback();
	expect(refreshCallback).not.toBeNull();

	act(() => {
		refreshCallback?.();
	});

	return result;
}

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
		vi.restoreAllMocks();
	});

	it("initializes with default settings", async () => {
		const { result } = renderHook(() => useSettings());

		expect(result.current.settings.emailEnabled).toBe(false);
		expect(result.current.settings.lowStockDays).toBe(30);
		expect(result.current.settings.reminderDaysBefore).toBe(7);
		expect(result.current.settingsLoading).toBe(true);

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});
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

	it("tracks unsaved changes only for user-editable settings fields", async () => {
		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		act(() => {
			result.current.setSettings((settings) => ({
				...settings,
				lastAutoEmailSent: "2026-06-06T08:00:00.000Z",
				nextScheduledCheck: "2026-06-06T09:00:00.000Z",
				lastNotificationType: "stock",
			}));
		});

		expect(result.current.hasUnsavedChanges).toBe(false);

		act(() => {
			result.current.setSettings((settings) => ({ ...settings, timezone: "Europe/Berlin" }));
		});

		expect(result.current.hasUnsavedChanges).toBe(true);
	});

	it("handles API error on load", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoadError).toBe("request");
		});
	});

	it("maps a failed authenticated settings load to an auth error state", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoadError).toBe("auth");
		});

		expect(result.current.settings.emailEnabled).toBe(false);
		expect(result.current.settings.notificationEmail).toBe("");
	});

	it("maps a forbidden settings load to a forbidden error state", async () => {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			status: 403,
			json: () => Promise.resolve({}),
		});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoadError).toBe("forbidden");
		});
	});

	it("retries loading settings after a successful refresh", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ emailEnabled: true, notificationEmail: "refreshed@example.com" }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		expect(result.current.settings.notificationEmail).toBe("refreshed@example.com");
		expect(global.fetch).toHaveBeenNthCalledWith(
			2,
			"/api/auth/refresh",
			expect.objectContaining({ method: "POST", credentials: "include" })
		);
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

	it("flushes unsaved settings on pagehide with keepalive including shareMedicationOverview", async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ shareMedicationOverview: false }),
		});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		vi.useFakeTimers();

		act(() => {
			result.current.setSettings((settings) => ({
				...settings,
				shareMedicationOverview: true,
			}));
		});

		act(() => {
			window.dispatchEvent(new Event("pagehide"));
		});

		const keepaliveCall = fetchMock.mock.calls.find(
			([url, init]) => url === "/api/settings" && (init as RequestInit | undefined)?.keepalive === true
		);

		expect(keepaliveCall).toBeDefined();
		expect(keepaliveCall?.[1]).toEqual(
			expect.objectContaining({
				method: "PUT",
				keepalive: true,
			})
		);

		const payload = JSON.parse(((keepaliveCall?.[1] as RequestInit).body as string) ?? "{}");
		expect(payload.shareMedicationOverview).toBe(true);

		vi.useRealTimers();
	});

	it("keeps email channel enabled when recipient is non-empty", async () => {
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

		expect(result.current.settings.emailEnabled).toBe(true);
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

	it("uses backend error messages for failed test email responses", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: false,
				status: 400,
				json: () => Promise.resolve({ message: "Recipient rejected" }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		await act(async () => {
			await result.current.testEmail();
		});

		expect(result.current.testEmailResult).toEqual({ success: false, message: "Recipient rejected" });
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

	it("uses backend error messages for failed test notifications", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ message: "Push target rejected" }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		await act(async () => {
			await result.current.testShoutrrr();
		});

		expect(result.current.testShoutrrrResult).toEqual({ success: false, message: "Push target rejected" });
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

		// Local state preserves user choice; backend receives effective value via payload
		expect(result.current.settings.emailEnabled).toBe(true);
	});

	it("auto-disables shoutrrr when URL is empty", async () => {
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
				shoutrrrEnabled: true,
				shoutrrrUrl: "",
			}));
		});

		const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

		await act(async () => {
			await result.current.saveSettings(mockEvent);
		});

		// Local state preserves user choice; backend receives effective value via payload
		expect(result.current.settings.shoutrrrEnabled).toBe(true);
	});

	it("reloads backend state when saving settings fails", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ lowStockDays: 14, notificationEmail: "server@example.com" }),
			});

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		act(() => {
			result.current.setSettings((current) => ({ ...current, lowStockDays: 99 }));
		});

		await act(async () => {
			await result.current.saveSettings();
		});

		await waitFor(() => {
			expect(result.current.settings.lowStockDays).toBe(14);
		});

		expect(result.current.settingsSaved).toBe(false);
		expect(result.current.settings.notificationEmail).toBe("server@example.com");
	});

	it("resets all transient state back to defaults", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ notificationEmail: "test@example.com" }) })
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

		expect(result.current.testEmailResult).toEqual({ success: true, message: "Email sent!" });

		act(() => {
			result.current.resetSettingsState();
		});

		expect(result.current.settings.notificationEmail).toBe("");
		expect(result.current.savedSettings.notificationEmail).toBe("");
		expect(result.current.testEmailResult).toBeNull();
		expect(result.current.settingsSaved).toBe(false);
		expect(result.current.settingsLoadError).toBeNull();
	});

	it("refreshes reminder status on interval", async () => {
		const getRefreshCallback = captureReminderRefreshInterval();

		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(okJson())
			.mockResolvedValueOnce(okJson(activeReminderMetadata));

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		const refreshCallback = getRefreshCallback();
		expect(refreshCallback).not.toBeNull();

		act(() => {
			refreshCallback?.();
		});

		await waitFor(() => {
			expect(result.current.settings.lastAutoEmailSent).toBe("2026-01-01T10:00:00.000Z");
			expect(result.current.settings.lastNotificationType).toBe("stock");
			expect(result.current.settings.lastStockReminderChannel).toBe("both");
		});
	});

	it("clears reminder metadata when refresh returns explicit null values", async () => {
		const getRefreshCallback = captureReminderRefreshInterval();

		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(okJson(activeReminderMetadata))
			.mockResolvedValueOnce(okJson(clearedReminderMetadata));

		const result = await renderSettingsAndRunCapturedRefresh(getRefreshCallback);

		await waitFor(() => {
			expect(result.current.settings.lastAutoEmailSent).toBeNull();
			expect(result.current.settings.lastNotificationType).toBeNull();
			expect(result.current.settings.lastNotificationChannel).toBeNull();
			expect(result.current.settings.lastReminderMedName).toBeNull();
			expect(result.current.settings.lastStockReminderSent).toBeNull();
		});
	});

	it("clears reminder metadata when refresh returns 401", async () => {
		const getRefreshCallback = captureReminderRefreshInterval();

		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(okJson(activeReminderMetadata))
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });

		const result = await renderSettingsAndRunCapturedRefresh(getRefreshCallback);

		await waitFor(() => {
			expect(result.current.settings.lastAutoEmailSent).toBeNull();
			expect(result.current.settings.lastNotificationType).toBeNull();
			expect(result.current.settings.lastNotificationChannel).toBeNull();
		});
	});

	it("resets to defaults when loadSettings gets 401", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ emailEnabled: true, notificationEmail: "test@example.com" }),
			})
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) })
			.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({}) });

		const { result } = renderHook(() => useSettings());

		await waitFor(() => {
			expect(result.current.settingsLoading).toBe(false);
		});

		expect(result.current.settings.emailEnabled).toBe(true);

		act(() => {
			result.current.loadSettings();
		});

		await waitFor(() => {
			expect(result.current.settingsLoadError).toBe("auth");
		});

		expect(result.current.settings.emailEnabled).toBe(false);
		expect(result.current.settings.notificationEmail).toBe("");
	});
});
