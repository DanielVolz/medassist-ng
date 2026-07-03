import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IntakeJournalModal } from "../../components/intake-journal/IntakeJournalModal";
import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";
import { setDefaultFormattingTimezone } from "../../utils/formatters";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("../../components/MedicationAvatar", () => ({
	MedicationAvatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

afterEach(() => {
	setDefaultFormattingTimezone(null);
});

function buildEntry(overrides: Partial<IntakeJournalEntry> = {}): IntakeJournalEntry {
	return {
		doseTrackingId: 1,
		doseId: "1-0-1760000000000-pillamn",
		medicationId: 1,
		medicationName: "Liquid Container",
		scheduledFor: "2026-05-17T11:55:00.000Z",
		takenAt: "2026-05-17T19:23:00.000Z",
		dismissed: false,
		takenSource: "manual",
		markedBy: "pillamn",
		note: "",
		updatedAt: null,
		createdAt: null,
		...overrides,
	};
}

describe("IntakeJournalModal", () => {
	it("displays taken-at instants in the configured local timezone", () => {
		setDefaultFormattingTimezone("Europe/Berlin");
		const entry = buildEntry({
			scheduledFor: "2026-07-03T07:00:00.000+02:00",
			takenAt: "2026-07-03T04:47:00.000Z",
		});

		render(
			<IntakeJournalModal
				isOpen
				entry={entry}
				isLoading={false}
				isSaving={false}
				isDeleting={false}
				error={null}
				onClose={vi.fn()}
				onSave={vi.fn()}
				onDelete={vi.fn()}
			/>
		);

		expect(screen.getByText("03.07.2026 07:00")).toBeInTheDocument();
		expect(screen.getByText("03.07.2026 06:47")).toBeInTheDocument();
	});

	it("keeps no-offset journal timestamps as local wall time", () => {
		setDefaultFormattingTimezone("Europe/Berlin");
		const entry = buildEntry({
			scheduledFor: "2026-07-03T07:00:00.000",
			takenAt: "2026-07-03T04:47:00.000",
		});

		render(
			<IntakeJournalModal
				isOpen
				entry={entry}
				isLoading={false}
				isSaving={false}
				isDeleting={false}
				error={null}
				onClose={vi.fn()}
				onSave={vi.fn()}
				onDelete={vi.fn()}
			/>
		);

		expect(screen.getByText("03.07.2026 07:00")).toBeInTheDocument();
		expect(screen.getByText("03.07.2026 04:47")).toBeInTheDocument();
	});

	it("closes after a successful save", async () => {
		const onSave = vi.fn(async () => true);
		const onClose = vi.fn();
		const onDelete = vi.fn();
		const entry = buildEntry();
		render(
			<IntakeJournalModal
				isOpen
				entry={entry}
				isLoading={false}
				isSaving={false}
				isDeleting={false}
				error={null}
				onClose={onClose}
				onSave={onSave}
				onDelete={onDelete}
			/>
		);

		fireEvent.change(screen.getByLabelText("journal.editor.noteLabel"), {
			target: { value: "Shared note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "common.save" }));

		expect(onSave).toHaveBeenCalledWith("Shared note");
		await waitFor(() => {
			expect(onClose).toHaveBeenCalled();
		});
	});

	it("keeps the modal open when save fails", async () => {
		const onSave = vi.fn(async () => false);
		const onClose = vi.fn();
		const entry = buildEntry();
		render(
			<IntakeJournalModal
				isOpen
				entry={entry}
				isLoading={false}
				isSaving={false}
				isDeleting={false}
				error={null}
				onClose={onClose}
				onSave={onSave}
				onDelete={vi.fn()}
			/>
		);

		fireEvent.change(screen.getByLabelText("journal.editor.noteLabel"), {
			target: { value: "Shared note" },
		});
		fireEvent.click(screen.getByRole("button", { name: "common.save" }));

		await waitFor(() => {
			expect(onSave).toHaveBeenCalledWith("Shared note");
		});
		expect(onClose).not.toHaveBeenCalled();
	});
});
