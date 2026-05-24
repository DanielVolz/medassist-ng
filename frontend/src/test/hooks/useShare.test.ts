import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShare } from "../../hooks/useShare";
import type { Medication } from "../../types";

const feedbackMock = vi.hoisted(() => ({ showFeedback: vi.fn() }));
const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({
		authFetch: authFetchMock,
	}),
}));

vi.mock("../../context/FeedbackContext", () => ({
	useFeedback: () => ({
		showFeedback: feedbackMock.showFeedback,
		dismissFeedback: vi.fn(),
		clearFeedback: vi.fn(),
	}),
}));

describe("useShare", () => {
	let mockClipboard: { writeText: ReturnType<typeof vi.fn> };

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

		mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
		Object.defineProperty(navigator, "clipboard", {
			value: mockClipboard,
			writable: true,
		});

		// Mock window.history
		vi.spyOn(window.history, "pushState").mockImplementation(() => {});
		vi.spyOn(window.history, "back").mockImplementation(() => {});

		// Mock window.location.origin
		Object.defineProperty(window, "location", {
			value: { origin: "http://localhost:5173" },
			writable: true,
		});

		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ token: "test-token" }),
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("initializes with default state", () => {
		const { result } = renderHook(() => useShare());

		expect(result.current.showShareDialog).toBe(false);
		expect(result.current.sharePeople).toEqual([]);
		expect(result.current.shareSelectedPerson).toBe("");
		expect(result.current.shareSelectedDays).toBe(30);
		expect(result.current.shareSelectedExpiryDays).toBeNull();
		expect(result.current.shareAllowJournalNotes).toBe(false);
		expect(result.current.shareLink).toBeNull();
		expect(result.current.activeShareLinks).toEqual([]);
	});

	it("opens share dialog with people from medications", async () => {
		const { result } = renderHook(() => useShare());

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice", "Bob"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
			{
				id: 2,
				name: "Med2",
				takenBy: ["Bob", "Charlie"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.showShareDialog).toBe(true);
		expect(result.current.sharePeople).toEqual(["all", "Alice", "Bob", "Charlie"]);
		expect(result.current.shareSelectedPerson).toBe("Alice");
		expect(window.history.pushState).toHaveBeenCalled();
	});

	it("resets state when opening dialog", () => {
		const { result } = renderHook(() => useShare());

		// Set some state first
		act(() => {
			result.current.setShareLink("old-link");
			result.current.setShareCopied(true);
		});

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		expect(result.current.shareLink).toBeNull();
		expect(result.current.shareCopied).toBe(false);
	});

	it("generates share link", async () => {
		const { result } = renderHook(() => useShare());

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		await act(async () => {
			await Promise.resolve();
			await result.current.generateShareLink();
		});

		expect(authFetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/share",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ takenBy: "Alice", scheduleDays: 30, expiryDays: null, allowJournalNotes: false }),
			})
		);
		expect(authFetchMock).toHaveBeenNthCalledWith(1, "/api/share");
		expect(result.current.shareLink).toBe("http://localhost:5173/share/test-token");
	});

	it("handles share link generation error", async () => {
		authFetchMock
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ shareLinks: [] }) } as Response)
			.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ error: "Failed to generate" }) } as Response);

		const { result } = renderHook(() => useShare());

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		await act(async () => {
			await Promise.resolve();
			await result.current.generateShareLink();
		});

		expect(feedbackMock.showFeedback).toHaveBeenCalledWith({ message: "Failed to generate", tone: "error" });
		expect(result.current.shareLink).toBeNull();
	});

	it("handles network error on share link generation", async () => {
		authFetchMock
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ shareLinks: [] }) } as Response)
			.mockRejectedValueOnce(new Error("Network error"));

		const { result } = renderHook(() => useShare());

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		await act(async () => {
			await Promise.resolve();
			await result.current.generateShareLink();
		});

		expect(feedbackMock.showFeedback).toHaveBeenCalledWith({ message: "share.generateFailed", tone: "error" });
	});

	it("does nothing when generateShareLink called without selected person", async () => {
		const { result } = renderHook(() => useShare());

		// Don't open dialog, so shareSelectedPerson is empty
		await act(async () => {
			await result.current.generateShareLink();
		});

		expect(authFetchMock).not.toHaveBeenCalled();
	});

	it("copies share link to clipboard", async () => {
		const { result } = renderHook(() => useShare());

		act(() => {
			result.current.setShareLink("http://localhost:5173/share/test-token");
		});

		await act(async () => {
			result.current.copyShareLink();
		});

		expect(mockClipboard.writeText).toHaveBeenCalledWith("http://localhost:5173/share/test-token");
		expect(result.current.shareCopied).toBe(true);

		// Should reset after 2 seconds
		act(() => {
			vi.advanceTimersByTime(2000);
		});

		expect(result.current.shareCopied).toBe(false);
	});

	it("does nothing when copyShareLink called without link", () => {
		const { result } = renderHook(() => useShare());

		act(() => {
			result.current.copyShareLink();
		});

		expect(mockClipboard.writeText).not.toHaveBeenCalled();
	});

	it("closes share dialog with history back", () => {
		const { result } = renderHook(() => useShare());

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		act(() => {
			result.current.closeShareDialog();
		});

		expect(window.history.back).toHaveBeenCalled();
	});

	it("does not call history back when dialog not open", () => {
		const { result } = renderHook(() => useShare());

		act(() => {
			result.current.closeShareDialog();
		});

		expect(window.history.back).not.toHaveBeenCalled();
	});

	it("resetShareDialogState clears state", () => {
		const { result } = renderHook(() => useShare());

		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
			result.current.setShareLink("some-link");
			result.current.setShareCopied(true);
		});

		act(() => {
			result.current.resetShareDialogState();
		});

		expect(result.current.showShareDialog).toBe(false);
		expect(result.current.shareLink).toBeNull();
		expect(result.current.shareCopied).toBe(false);
		expect(result.current.shareSelectedExpiryDays).toBeNull();
		expect(result.current.shareAllowJournalNotes).toBe(false);
		expect(result.current.activeShareLinks).toEqual([]);
	});

	it("includes selected expiry when generating a share link", async () => {
		const { result } = renderHook(() => useShare());
		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
			result.current.setShareSelectedExpiryDays(7);
		});

		await act(async () => {
			await Promise.resolve();
			await result.current.generateShareLink();
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/share",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ takenBy: "Alice", scheduleDays: 30, expiryDays: 7, allowJournalNotes: false }),
			})
		);
	});

	it("includes the shared journal-note permission when generating a share link", async () => {
		const { result } = renderHook(() => useShare());
		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
			result.current.setShareAllowJournalNotes(true);
		});

		await act(async () => {
			await Promise.resolve();
			await result.current.generateShareLink();
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/share",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ takenBy: "Alice", scheduleDays: 30, expiryDays: null, allowJournalNotes: true }),
			})
		);
	});

	it("loads active share links when opening the dialog", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						shareLinks: [
							{
								token: "abcdef0123456789",
								takenBy: "Alice",
								scheduleDays: 30,
								createdAt: "2026-05-17T12:00:00.000Z",
								expiresAt: null,
								allowJournalNotes: true,
								shareUrl: "/share/abcdef0123456789",
							},
						],
					}),
			})
			.mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: "test-token" }) });

		const { result } = renderHook(() => useShare());
		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.activeShareLinks).toHaveLength(1);
		expect(result.current.activeShareLinks[0].token).toBe("abcdef0123456789");
	});

	it("revokes an active share link", async () => {
		(global.fetch as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						shareLinks: [
							{
								token: "abcdef0123456789",
								takenBy: "Alice",
								scheduleDays: 30,
								createdAt: "2026-05-17T12:00:00.000Z",
								expiresAt: null,
								allowJournalNotes: false,
								shareUrl: "/share/abcdef0123456789",
							},
						],
					}),
			})
			.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

		const { result } = renderHook(() => useShare());
		const meds: Medication[] = [
			{
				id: 1,
				name: "Med1",
				takenBy: ["Alice"],
				packageType: "blister",
				packCount: 1,
				blistersPerPack: 1,
				pillsPerBlister: 10,
				looseTablets: 0,
				blisters: [],
				updatedAt: null,
			},
		];

		act(() => {
			result.current.openShareDialog(meds);
		});

		await act(async () => {
			await Promise.resolve();
		});

		await act(async () => {
			await result.current.revokeShareLink("abcdef0123456789");
		});

		expect(authFetchMock).toHaveBeenCalledWith("/api/share/abcdef0123456789", { method: "DELETE" });
		expect(result.current.activeShareLinks).toEqual([]);
	});

	it("allows changing selected person, days, and expiry", () => {
		const { result } = renderHook(() => useShare());

		act(() => {
			result.current.setShareSelectedPerson("Bob");
			result.current.setShareSelectedDays(90);
			result.current.setShareSelectedExpiryDays(30);
			result.current.setShareAllowJournalNotes(true);
		});

		expect(result.current.shareSelectedPerson).toBe("Bob");
		expect(result.current.shareSelectedDays).toBe(90);
		expect(result.current.shareSelectedExpiryDays).toBe(30);
		expect(result.current.shareAllowJournalNotes).toBe(true);
	});
});
