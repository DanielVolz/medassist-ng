import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExportModal from "../../components/ExportModal";

describe("ExportModal", () => {
	const defaultProps = {
		isOpen: true,
		onClose: vi.fn(),
		onExport: vi.fn(),
		exporting: false,
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when not open", () => {
		const { container } = render(<ExportModal {...defaultProps} isOpen={false} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders when open", () => {
		render(<ExportModal {...defaultProps} />);
		expect(screen.getByText(/exportImport\.exportOptions/i)).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getAllByRole("button", { name: /common\.close/i })[0]);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		render(<ExportModal {...defaultProps} />);
		const overlay = document.querySelector(".mantine-Modal-overlay");
		expect(overlay).toBeInTheDocument();
		fireEvent.click(overlay!);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("renders export options", () => {
		render(<ExportModal {...defaultProps} />);
		expect(screen.getByTestId("export-option-with-images")).toBeInTheDocument();
		expect(screen.getByTestId("export-option-data-only")).toBeInTheDocument();
	});

	it("calls onExport with true when export with images button clicked", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getByTestId("export-option-with-images"));
		expect(defaultProps.onClose).toHaveBeenCalled();
		expect(defaultProps.onExport).toHaveBeenCalledWith(true, false);
	});

	it("calls onExport with false when export data only button clicked", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getByTestId("export-option-data-only"));
		expect(defaultProps.onClose).toHaveBeenCalled();
		expect(defaultProps.onExport).toHaveBeenCalledWith(false, false);
	});

	it("keeps sensitive export disabled and warning hidden by default", () => {
		render(<ExportModal {...defaultProps} />);
		expect(screen.getByLabelText(/exportImport\.includeSensitive/i)).not.toBeChecked();
		expect(screen.queryByText(/exportImport\.sensitiveWarning/i)).not.toBeInTheDocument();
	});

	it("shows the sensitive export warning only after explicit confirmation", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getByLabelText(/exportImport\.includeSensitive/i));
		expect(screen.getByText(/exportImport\.sensitiveWarning/i)).toBeInTheDocument();
	});

	it("passes sensitive export opt-in when selected", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getByLabelText(/exportImport\.includeSensitive/i));
		fireEvent.click(screen.getByTestId("export-option-with-images"));
		expect(defaultProps.onExport).toHaveBeenCalledWith(true, true);
	});

	it("disables buttons when exporting", () => {
		render(<ExportModal {...defaultProps} exporting={true} />);
		expect(screen.getByTestId("export-option-with-images")).toBeDisabled();
		expect(screen.getByTestId("export-option-data-only")).toBeDisabled();
	});

	it("renders cancel button", () => {
		render(<ExportModal {...defaultProps} />);
		expect(screen.getByText(/common\.close/i)).toBeInTheDocument();
	});

	it("calls onClose when cancel button is clicked", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getByText(/common\.close/i));
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("does not trigger export actions while exporting", () => {
		render(<ExportModal {...defaultProps} exporting={true} />);

		fireEvent.click(screen.getByTestId("export-option-with-images"));
		fireEvent.click(screen.getByTestId("export-option-data-only"));

		expect(defaultProps.onExport).not.toHaveBeenCalled();
	});
});
