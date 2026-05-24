import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportReviewModal } from "../../components/ImportReviewModal";

vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next");
	return {
		...actual,
		useTranslation: () => ({
			t: (key: string) => key,
		}),
	};
});

const importPreview = {
	version: "1.6",
	exportedAt: "2026-05-21T10:00:00.000Z",
	includeSensitiveData: true,
	incoming: {
		medications: 1,
		doseHistory: 2,
		refillHistory: 3,
		shareLinks: 4,
		journalEntries: 1,
		imageCount: 1,
		hasSettings: true,
	},
	current: {
		medications: 5,
		doseHistory: 6,
		refillHistory: 7,
		shareLinks: 8,
		hasSettings: true,
	},
	warnings: {
		replacesExistingData: true,
		regeneratesShareLinks: true,
		containsImages: true,
		containsSensitiveData: true,
	},
};

describe("ImportReviewModal", () => {
	it("stays closed without an open preview", () => {
		const { container } = render(
			<ImportReviewModal
				isOpen={false}
				importPreview={importPreview}
				formattedExportedAt="May 21, 2026"
				importing={false}
				exporting={false}
				onClose={vi.fn()}
				onBackup={vi.fn()}
				onConfirm={vi.fn()}
			/>
		);

		expect(container.firstChild).toBeNull();
	});

	it("supports overlay, Escape, backup, and confirm actions", () => {
		const onClose = vi.fn();
		const onBackup = vi.fn();
		const onConfirm = vi.fn();
		const { container } = render(
			<ImportReviewModal
				isOpen={true}
				importPreview={importPreview}
				formattedExportedAt="May 21, 2026"
				importing={false}
				exporting={false}
				onClose={onClose}
				onBackup={onBackup}
				onConfirm={onConfirm}
			/>
		);

		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText("exportImport.confirmImport")).toBeInTheDocument();

		fireEvent.click(container.querySelector(".modal-content") as Element);
		expect(onClose).not.toHaveBeenCalled();

		fireEvent.click(screen.getByText("exportImport.backupFirst"));
		expect(onBackup).toHaveBeenCalledTimes(1);

		fireEvent.click(screen.getByText("exportImport.confirmButton"));
		expect(onConfirm).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);

		fireEvent.click(container.querySelector(".modal-overlay") as Element);
		expect(onClose).toHaveBeenCalledTimes(2);
	});
});
