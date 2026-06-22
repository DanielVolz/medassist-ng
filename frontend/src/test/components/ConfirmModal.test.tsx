import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmModal } from "../../components/ConfirmModal";

describe("ConfirmModal", () => {
	const defaultProps = {
		title: "Confirm Action",
		message: "Are you sure you want to proceed?",
		confirmLabel: "Yes",
		cancelLabel: "No",
		onConfirm: vi.fn(),
		onCancel: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders title", () => {
		render(<ConfirmModal {...defaultProps} />);
		expect(screen.getByText("Confirm Action")).toBeInTheDocument();
	});

	it("renders message as string", () => {
		render(<ConfirmModal {...defaultProps} />);
		expect(screen.getByText("Are you sure you want to proceed?")).toBeInTheDocument();
	});

	it("renders message as ReactNode", () => {
		render(<ConfirmModal {...defaultProps} message={<span data-testid="custom-message">Custom message</span>} />);
		expect(screen.getByTestId("custom-message")).toBeInTheDocument();
	});

	it("renders confirm and cancel buttons", () => {
		render(<ConfirmModal {...defaultProps} />);
		expect(screen.getByText("Yes")).toBeInTheDocument();
		expect(screen.getByText("No")).toBeInTheDocument();
	});

	it("calls onConfirm when confirm button is clicked", () => {
		render(<ConfirmModal {...defaultProps} />);
		fireEvent.click(screen.getByText("Yes"));
		expect(defaultProps.onConfirm).toHaveBeenCalled();
	});

	it("calls onCancel when cancel button is clicked", () => {
		render(<ConfirmModal {...defaultProps} />);
		fireEvent.click(screen.getByText("No"));
		expect(defaultProps.onCancel).toHaveBeenCalled();
	});

	it("calls onCancel when close button is clicked", () => {
		render(<ConfirmModal {...defaultProps} />);
		fireEvent.click(screen.getByRole("button", { name: /close/i }));
		expect(defaultProps.onCancel).toHaveBeenCalled();
	});

	it("calls onCancel when overlay is clicked", () => {
		render(<ConfirmModal {...defaultProps} />);
		const overlay = document.querySelector(".mantine-Modal-overlay");
		expect(overlay).toBeInTheDocument();
		fireEvent.click(overlay as HTMLElement);
		expect(defaultProps.onCancel).toHaveBeenCalled();
	});

	it("does not call onCancel when modal content is clicked", () => {
		render(<ConfirmModal {...defaultProps} />);
		fireEvent.click(screen.getByRole("dialog"));
		expect(defaultProps.onCancel).not.toHaveBeenCalled();
	});

	it("disables buttons when loading", () => {
		render(<ConfirmModal {...defaultProps} isLoading={true} />);
		expect(screen.getByRole("button", { name: "Yes" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "No" })).toBeDisabled();
	});

	it("applies primary variant by default", () => {
		render(<ConfirmModal {...defaultProps} />);
		expect(screen.getByTestId("confirm-modal-confirm")).toHaveAttribute("data-confirm-variant", "primary");
	});

	it("applies danger variant when specified", () => {
		render(<ConfirmModal {...defaultProps} confirmVariant="danger" />);
		expect(screen.getByTestId("confirm-modal-confirm")).toHaveAttribute("data-confirm-variant", "danger");
	});

	it("applies success variant when specified", () => {
		render(<ConfirmModal {...defaultProps} confirmVariant="success" />);
		expect(screen.getByTestId("confirm-modal-confirm")).toHaveAttribute("data-confirm-variant", "success");
	});

	it("applies warning variant when specified", () => {
		render(<ConfirmModal {...defaultProps} confirmVariant="warning" />);
		expect(screen.getByTestId("confirm-modal-confirm")).toHaveAttribute("data-confirm-variant", "warning");
	});

	it("applies custom overlay class", () => {
		render(<ConfirmModal {...defaultProps} overlayClassName="nested-confirm" />);
		const modalRoot = document.querySelector(".nested-confirm");
		expect(modalRoot).toBeInTheDocument();
	});

	it("calls onCancel when Escape is pressed", () => {
		render(<ConfirmModal {...defaultProps} />);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
	});
});
