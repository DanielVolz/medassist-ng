import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordNowModal } from "../../components/RecordNowModal";
import { AsNeededIntakeRequestError } from "../../hooks/useAsNeededIntakes";
import type { AsNeededIntakeMutationResponse, Medication } from "../../types";
import { setDefaultFormattingTimezone } from "../../utils/formatters";

function medication(overrides: Partial<Medication> = {}): Medication {
	return {
		id: 8,
		name: "As-needed medicine",
		genericName: "",
		packageType: "blister",
		medicationForm: "tablet",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		looseTablets: 10,
		takenBy: ["Alex"],
		intakes: [],
		blisters: [],
		intakeRemindersEnabled: false,
		notes: "",
		expiryDate: "",
		imageUrl: null,
		updatedAt: null,
		...overrides,
	};
}

function response(): AsNeededIntakeMutationResponse {
	return {
		event: {
			eventType: "as_needed",
			eventId: "event-8",
			medicationId: 8,
			medication: {
				name: "As-needed medicine",
				genericName: null,
				medicationForm: "tablet",
				packageType: "blister",
				isObsolete: false,
				hasRegularSchedule: false,
				lifecycle: "active_no_schedule",
				recordEligibility: { eligible: true, reason: "eligible" },
			},
			occurredAt: "2026-08-15T08:30:00.000Z",
			recordedAt: "2026-08-15T08:30:01.000Z",
			quantity: 0.5,
			quantityUnit: "pills",
			person: null,
			source: "owner_as_needed",
			status: "active",
			revision: 1,
			stockEffect: 0.5,
			stockEffectReason: "applied",
			stockCutoffAt: null,
			replacementForEventId: null,
			reversedAt: null,
			journal: null,
		},
		inventory: { currentStock: 9.5, unit: "pills", capacity: 10, reconciliationRequired: false },
	};
}

describe("RecordNowModal", () => {
	beforeEach(() => {
		vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "modal-intent-key") });
		setDefaultFormattingTimezone("Europe/Berlin");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		setDefaultFormattingTimezone(null);
	});

	it("uses the tablet default of 1, supports 0.5 steps and None/self, and sends the stable key on retry", async () => {
		const onRecord = vi
			.fn()
			.mockRejectedValueOnce(new AsNeededIntakeRequestError("NETWORK_ERROR"))
			.mockResolvedValueOnce(response());
		render(
			<RecordNowModal existingPeople={["Alex"]} medication={medication()} onClose={vi.fn()} onRecord={onRecord} />
		);

		expect(screen.getByRole("textbox")).toHaveValue("1");
		expect(screen.getByText("asNeeded.record.stockEffect")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "asNeeded.record.decreaseQuantity" }));
		expect(screen.getByRole("textbox")).toHaveValue("0.5");
		fireEvent.click(screen.getByRole("button", { name: "dose.take" }));
		await screen.findByText("asNeeded.errors.network");
		fireEvent.click(screen.getByRole("button", { name: "common.retry" }));

		await screen.findByText("asNeeded.record.successTitle");
		expect(onRecord).toHaveBeenCalledTimes(2);
		expect(onRecord.mock.calls[0][0]).toEqual(onRecord.mock.calls[1][0]);
		expect(onRecord).toHaveBeenLastCalledWith({
			medicationId: 8,
			quantity: 0.5,
			person: null,
			idempotencyKey: "modal-intent-key",
		});
		expect(screen.getByTestId("app-modal-footer")).toBeInTheDocument();
		await waitFor(() => expect(document.activeElement).toHaveTextContent("asNeeded.record.successTitle"));
	});

	it("enforces topical one-application semantics and leaves no measured stock effect", () => {
		render(
			<RecordNowModal
				existingPeople={["Alex"]}
				medication={medication({ packageType: "tube", medicationForm: "topical" })}
				onClose={vi.fn()}
				onRecord={vi.fn()}
			/>
		);

		expect(screen.getByRole("textbox")).toHaveValue("1");
		expect(screen.getByText("asNeeded.record.noStockEffect")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "asNeeded.record.increaseQuantity" })).toBeDisabled();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "2" } });
		expect(screen.getByText("asNeeded.errors.invalidQuantity")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "dose.take" })).toBeDisabled();
	});

	it("keeps the dialog pending and blocks duplicate submits until the latest response arrives", async () => {
		let resolveRequest: ((value: AsNeededIntakeMutationResponse) => void) | undefined;
		const onRecord = vi.fn(
			() =>
				new Promise<AsNeededIntakeMutationResponse>((resolve) => {
					resolveRequest = resolve;
				})
		);
		render(
			<RecordNowModal existingPeople={["Alex"]} medication={medication()} onClose={vi.fn()} onRecord={onRecord} />
		);

		const confirm = screen.getByRole("button", { name: "dose.take" });
		fireEvent.click(confirm);
		fireEvent.click(confirm);
		expect(onRecord).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("status")).toHaveTextContent("asNeeded.record.saving");
		expect(screen.getByRole("button", { name: "common.cancel" })).toBeDisabled();

		resolveRequest?.(response());
		await screen.findByText("asNeeded.record.successTitle");
	});

	it("offers all existing people for an ordinary Take without a replacement mode", () => {
		render(
			<RecordNowModal existingPeople={["Sam", "Alex"]} medication={medication()} onClose={vi.fn()} onRecord={vi.fn()} />
		);

		const person = screen.getByLabelText("asNeeded.record.person");
		expect(person).toHaveValue("");
		expect(screen.getByRole("option", { name: "Sam" })).toBeInTheDocument();
		expect(screen.queryByText(/replacement|correction/i)).not.toBeInTheDocument();
	});
});
