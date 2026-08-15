import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsNeededIntakeHistory } from "../../components/AsNeededIntakeHistory";
import type { AsNeededIntakeEvent } from "../../types";

const listAsNeededIntakes = vi.fn();
const openJournalEditor = vi.fn();
vi.mock("../../hooks/useAsNeededIntakes", () => ({ useAsNeededIntakes: () => ({ listAsNeededIntakes }) }));
vi.mock("../../hooks/useIntakeJournal", () => ({
	useIntakeJournal: () => ({
		journalEditorOpen: false,
		journalEvent: null,
		journalEventLoading: false,
		journalEventSaving: false,
		journalEventDeleting: false,
		journalEventError: null,
		openJournalEditor,
		closeJournalEditor: vi.fn(),
		saveJournalNote: vi.fn(),
		deleteJournalNote: vi.fn(),
	}),
}));

function event(overrides: Partial<AsNeededIntakeEvent> = {}): AsNeededIntakeEvent {
	return {
		eventType: "as_needed",
		eventId: "event-1",
		medicationId: 9,
		medication: {
			name: "Pain relief",
			genericName: null,
			medicationForm: "tablet",
			packageType: "blister",
			isObsolete: false,
			hasRegularSchedule: false,
			lifecycle: "active_no_schedule",
			recordEligibility: { eligible: true, reason: "eligible" },
		},
		occurredAt: "2026-08-15T12:30:00.000Z",
		recordedAt: "2026-08-15T12:30:01.000Z",
		quantity: 1,
		quantityUnit: "pills",
		person: "Alex",
		source: "owner_as_needed",
		status: "active",
		revision: 1,
		stockEffect: 1,
		stockEffectReason: "applied",
		stockCutoffAt: null,
		replacementForEventId: null,
		reversedAt: null,
		journal: null,
		...overrides,
	};
}

describe("AsNeededIntakeHistory", () => {
	afterEach(() => vi.clearAllMocks());

	it("stays collapsed and lazy until opened, requesting active-only bounded history", async () => {
		listAsNeededIntakes.mockResolvedValue({ events: [event()], nextCursor: null });
		render(<AsNeededIntakeHistory medicationId={9} canRecordNow onTake={vi.fn()} />);
		expect(listAsNeededIntakes).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.history.title" }));
		await screen.findByText("asNeeded.history.person: Alex");
		expect(listAsNeededIntakes).toHaveBeenCalledWith(9, undefined, expect.any(AbortSignal));
		expect(screen.queryByText(/Reverse|Correct|Correction|reversed/i)).not.toBeInTheDocument();
	});

	it("takes through the ordinary action, pages compact entries, keeps journal active, and removes Undo immediately", async () => {
		const onTake = vi.fn();
		const onUndo = vi.fn().mockResolvedValue(undefined);
		listAsNeededIntakes
			.mockResolvedValueOnce({ events: [event()], nextCursor: "next" })
			.mockResolvedValueOnce({ events: [event({ eventId: "event-2", person: null })], nextCursor: null });
		render(<AsNeededIntakeHistory medicationId={9} canRecordNow onTake={onTake} onUndo={onUndo} />);
		fireEvent.click(screen.getByRole("button", { name: "dose.take" }));
		expect(onTake).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.history.title" }));
		await screen.findByText("asNeeded.history.person: Alex");
		fireEvent.click(screen.getByRole("button", { name: "journal.actions.add" }));
		expect(openJournalEditor).toHaveBeenCalledWith("as-needed:event-1");
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.history.loadMore" }));
		await waitFor(() => expect(listAsNeededIntakes).toHaveBeenLastCalledWith(9, "next"));
		fireEvent.click(screen.getAllByRole("button", { name: "dose.undoAction" })[0]);
		await waitFor(() => expect(screen.queryByText("Alex")).not.toBeInTheDocument());
		expect(onUndo).toHaveBeenCalledWith("event-1");
	});
});
