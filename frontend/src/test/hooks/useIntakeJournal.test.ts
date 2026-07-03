import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type IntakeJournalEntry, useIntakeJournal } from "../../hooks/useIntakeJournal";

const authFetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({
		authFetch: authFetchMock,
	}),
}));

function buildEntry(overrides: Partial<IntakeJournalEntry> = {}): IntakeJournalEntry {
	return {
		doseTrackingId: 1,
		doseId: "11-0-1760000000000-Daniel",
		medicationId: 11,
		medicationName: "Journal Med",
		scheduledFor: "2026-02-10T08:00:00.000Z",
		takenAt: "2026-02-10T08:05:00.000Z",
		dismissed: false,
		takenSource: "manual",
		markedBy: "Daniel",
		mood: null,
		note: null,
		updatedAt: null,
		createdAt: null,
		...overrides,
	};
}

describe("useIntakeJournal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authFetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("loads an event and updates local note state on save and delete", async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		const initialEntry = buildEntry();
		const savedEntry = buildEntry({
			mood: "good",
			note: "Took after breakfast",
			createdAt: "2026-02-10T08:06:00.000Z",
			updatedAt: "2026-02-10T08:07:00.000Z",
		});

		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ entry: initialEntry }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ entry: savedEntry }),
			})
			.mockResolvedValueOnce({ ok: true });

		const { result } = renderHook(() => useIntakeJournal());

		await act(async () => {
			await result.current.openJournalEditor(initialEntry.doseId);
		});

		expect(authFetchMock).toHaveBeenNthCalledWith(
			1,
			`/api/intake-journal/event/${encodeURIComponent(initialEntry.doseId)}`
		);
		expect(result.current.journalEditorOpen).toBe(true);
		expect(result.current.journalTargetDoseId).toBe(initialEntry.doseId);
		expect(result.current.journalEvent).toEqual(initialEntry);

		let saveResult = false;
		await act(async () => {
			saveResult = await result.current.saveJournalNote("Took after breakfast", "good");
		});

		expect(saveResult).toBe(true);
		expect(authFetchMock).toHaveBeenNthCalledWith(
			2,
			`/api/intake-journal/event/${encodeURIComponent(initialEntry.doseId)}`,
			expect.objectContaining({
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ note: "Took after breakfast", mood: "good" }),
			})
		);
		expect(result.current.journalEvent?.note).toBe("Took after breakfast");
		expect(result.current.journalEvent?.mood).toBe("good");

		let deleteResult = false;
		await act(async () => {
			deleteResult = await result.current.deleteJournalNote();
		});

		expect(deleteResult).toBe(true);
		expect(authFetchMock).toHaveBeenNthCalledWith(
			3,
			`/api/intake-journal/event/${encodeURIComponent(initialEntry.doseId)}`,
			expect.objectContaining({ method: "DELETE" })
		);
		expect(result.current.journalEvent).toEqual(
			expect.objectContaining({
				doseId: initialEntry.doseId,
				mood: null,
				note: null,
				createdAt: null,
				updatedAt: null,
			})
		);
	});

	it("loads filtered history and reopens an entry in the editor", async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		const historyEntry = buildEntry({
			doseId: "11-0-1760086400000-Daniel",
			mood: "neutral",
			note: "Evening note",
			updatedAt: "2026-02-11T18:30:00.000Z",
			createdAt: "2026-02-11T18:20:00.000Z",
		});

		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ entries: [historyEntry] }),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve({ entry: historyEntry }),
			});

		const { result } = renderHook(() => useIntakeJournal());

		act(() => {
			result.current.setJournalHistoryFilters({
				medicationId: 11,
				from: "2026-02-11T00:00:00.000Z",
				to: "2026-02-11T23:59:59.000Z",
				limit: 25,
			});
			result.current.openJournalHistory();
		});

		await waitFor(() => {
			expect(result.current.journalHistoryEntries).toEqual([historyEntry]);
		});

		expect(authFetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/intake-journal?medicationId=11&from=2026-02-11T00%3A00%3A00.000Z&to=2026-02-11T23%3A59%3A59.000Z&limit=25"
		);

		await act(async () => {
			await result.current.reopenJournalHistoryEntry(historyEntry.doseId);
		});

		expect(authFetchMock).toHaveBeenNthCalledWith(
			2,
			`/api/intake-journal/event/${encodeURIComponent(historyEntry.doseId)}`
		);
		expect(result.current.journalHistoryOpen).toBe(false);
		expect(result.current.journalEditorOpen).toBe(true);
		expect(result.current.journalTargetDoseId).toBe(historyEntry.doseId);
		expect(result.current.journalEvent).toEqual(historyEntry);
	});

	it("surfaces owner access errors instead of swallowing them", async () => {
		const fetchMock = global.fetch as ReturnType<typeof vi.fn>;
		fetchMock.mockResolvedValueOnce({
			ok: false,
			json: () => Promise.resolve({ error: "Tracked dose event not found for the current owner" }),
		});

		const { result } = renderHook(() => useIntakeJournal());

		await act(async () => {
			await result.current.openJournalEditor("99-0-1760000000000-Daniel");
		});

		expect(result.current.journalEvent).toBeNull();
		expect(result.current.journalEventError).toBe("Tracked dose event not found for the current owner");
	});
});
