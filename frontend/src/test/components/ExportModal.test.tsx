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
		fireEvent.click(screen.getByText("×"));
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		const { container } = render(<ExportModal {...defaultProps} />);
		const overlay = container.querySelector(".modal-overlay");
		fireEvent.click(overlay!);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("renders export options", () => {
		const { container } = render(<ExportModal {...defaultProps} />);
		// Should have action card buttons
		const actionCards = container.querySelectorAll(".action-card");
		expect(actionCards.length).toBe(2);
	});

	it("calls onExport with true when export with images button clicked", () => {
		const { container } = render(<ExportModal {...defaultProps} />);
		const actionCards = container.querySelectorAll(".action-card");
		fireEvent.click(actionCards[0]);
		expect(defaultProps.onClose).toHaveBeenCalled();
		expect(defaultProps.onExport).toHaveBeenCalledWith(true);
	});

	it("calls onExport with false when export data only button clicked", () => {
		const { container } = render(<ExportModal {...defaultProps} />);
		const actionCards = container.querySelectorAll(".action-card");
		fireEvent.click(actionCards[1]);
		expect(defaultProps.onClose).toHaveBeenCalled();
		expect(defaultProps.onExport).toHaveBeenCalledWith(false);
	});

	it("disables buttons when exporting", () => {
		const { container } = render(<ExportModal {...defaultProps} exporting={true} />);
		const actionCards = container.querySelectorAll(".action-card");
		actionCards.forEach((card) => {
			expect(card).toBeDisabled();
		});
	});

	it("renders cancel button", () => {
		render(<ExportModal {...defaultProps} />);
		expect(screen.getByText(/exportImport\.cancelButton/i)).toBeInTheDocument();
	});

	it("calls onClose when cancel button is clicked", () => {
		render(<ExportModal {...defaultProps} />);
		fireEvent.click(screen.getByText(/exportImport\.cancelButton/i));
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("does not trigger export actions while exporting", () => {
		const { container } = render(<ExportModal {...defaultProps} exporting={true} />);
		const actionCards = container.querySelectorAll(".action-card");

		fireEvent.click(actionCards[0]);
		fireEvent.click(actionCards[1]);

		expect(defaultProps.onExport).not.toHaveBeenCalled();
	});
});
