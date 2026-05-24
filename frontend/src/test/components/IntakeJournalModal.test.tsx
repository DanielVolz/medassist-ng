import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntakeJournalModal } from "../../components/intake-journal/IntakeJournalModal";
import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

vi.mock("../../components/MedicationAvatar", () => ({
	MedicationAvatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

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
