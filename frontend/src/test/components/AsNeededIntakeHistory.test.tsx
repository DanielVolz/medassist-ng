import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsNeededIntakeHistory } from "../../components/AsNeededIntakeHistory";
import type { AsNeededIntakeEvent } from "../../types";

const listAsNeededIntakes = vi.fn();

vi.mock("../../hooks/useAsNeededIntakes", () => ({
	useAsNeededIntakes: () => ({ listAsNeededIntakes }),
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
		quantity: 0.5,
		quantityUnit: "pills",
		person: "Alex",
		source: "owner_as_needed",
		status: "active",
		revision: 1,
		stockEffect: 0.5,
		stockEffectReason: "applied",
		stockCutoffAt: null,
		replacementForEventId: null,
		reversedAt: null,
		journal: null,
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

describe("AsNeededIntakeHistory", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("renders active and reversed corrections with trusted times, journal context, person and stock reason", async () => {
		listAsNeededIntakes.mockResolvedValueOnce({
			events: [
				event({
					journal: {
						doseId: "as-needed:event-1",
						mood: "better",
						note: "Helped quickly",
						createdAt: "x",
						updatedAt: "x",
					},
				}),
				event({
					eventId: "event-0",
					status: "reversed",
					person: null,
					stockEffect: 0,
					stockEffectReason: "superseded_by_correction",
					reversedAt: "2026-08-15T13:00:00.000Z",
					replacementForEventId: "event-1",
					journal: null,
				}),
			],
			nextCursor: null,
		});
		render(<AsNeededIntakeHistory medicationId={9} canRecordNow onRecordNow={vi.fn()} />);

		await screen.findByText("asNeeded.history.title");
		expect(screen.getByText("asNeeded.lifecycle.active_no_schedule")).toBeInTheDocument();
		expect(screen.getByText("Alex")).toBeInTheDocument();
		expect(screen.getByText("asNeeded.record.noPerson")).toBeInTheDocument();
		expect(screen.getByText("asNeeded.history.stockReason.applied")).toBeInTheDocument();
		expect(screen.getByText("asNeeded.history.stockReason.superseded_by_correction")).toBeInTheDocument();
		expect(screen.getByText("asNeeded.history.replacementFor")).toBeInTheDocument();
		expect(screen.getByText("asNeeded.history.noJournal")).toBeInTheDocument();
		expect(screen.getByText(/Helped quickly/)).toBeInTheDocument();
		const times = document.querySelectorAll("time");
		expect(times).toHaveLength(2);
		expect(times[0]).toHaveAttribute("dateTime", "2026-08-15T12:30:00.000Z");
	});

	it("hides empty history when intake is ineligible, but keeps the eligible empty state and Record now action", async () => {
		listAsNeededIntakes.mockResolvedValue({ events: [], nextCursor: null });
		const { rerender } = render(<AsNeededIntakeHistory medicationId={9} canRecordNow={false} onRecordNow={vi.fn()} />);
		await waitFor(() => expect(screen.queryByText("asNeeded.history.title")).not.toBeInTheDocument());

		const onRecordNow = vi.fn();
		rerender(<AsNeededIntakeHistory medicationId={9} canRecordNow onRecordNow={onRecordNow} />);
		await screen.findByText("asNeeded.history.empty");
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.record.action" }));
		expect(onRecordNow).toHaveBeenCalledOnce();
	});

	it("retries safe failures and deduplicates cursor pages", async () => {
		listAsNeededIntakes
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ events: [event()], nextCursor: "cursor-2" })
			.mockResolvedValueOnce({ events: [event(), event({ eventId: "event-2", person: "Bea" })], nextCursor: null });
		render(<AsNeededIntakeHistory medicationId={9} canRecordNow onRecordNow={vi.fn()} />);

		await screen.findByText("asNeeded.history.errorMessage");
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.history.retry" }));
		await screen.findByText("Alex");
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.history.loadMore" }));
		await screen.findByText("Bea");
		expect(screen.getAllByText("Alex")).toHaveLength(1);
		expect(screen.getAllByText("Bea")).toHaveLength(1);
		expect(listAsNeededIntakes).toHaveBeenLastCalledWith(9, "cursor-2");
	});

	it("aborts stale first-page work and ignores its late response after medication changes", async () => {
		const first = deferred<{ events: AsNeededIntakeEvent[]; nextCursor: string | null }>();
		listAsNeededIntakes.mockImplementationOnce((_id: number, _cursor: string | undefined, signal: AbortSignal) => {
			expect(signal.aborted).toBe(false);
			return first.promise;
		});
		listAsNeededIntakes.mockResolvedValueOnce({
			events: [event({ medicationId: 10, person: "New" })],
			nextCursor: null,
		});
		const { rerender } = render(<AsNeededIntakeHistory medicationId={9} canRecordNow onRecordNow={vi.fn()} />);
		rerender(<AsNeededIntakeHistory medicationId={10} canRecordNow onRecordNow={vi.fn()} />);

		await screen.findByText("New");
		first.resolve({ events: [event({ person: "Stale" })], nextCursor: null });
		await waitFor(() => expect(screen.queryByText("Stale")).not.toBeInTheDocument());
		expect(listAsNeededIntakes.mock.calls[0][2].aborted).toBe(true);
	});
});
