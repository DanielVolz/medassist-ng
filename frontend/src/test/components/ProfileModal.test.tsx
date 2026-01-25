import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProfileModal from "../../components/ProfileModal";

// Mock Auth UserProfile component
vi.mock("../../components/Auth", () => ({
	UserProfile: ({ onClose: _onClose }: { onClose: () => void }) => (
		<div data-testid="user-profile">User Profile Content</div>
	),
}));

describe("ProfileModal", () => {
	it("renders nothing when not open", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={false} onClose={onClose} />);

		expect(screen.queryByTestId("user-profile")).not.toBeInTheDocument();
	});

	it("renders modal when open", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		expect(screen.getByTestId("user-profile")).toBeInTheDocument();
	});

	it("renders close button", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const closeBtn = screen.getByText("×");
		expect(closeBtn).toBeInTheDocument();
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const closeBtn = screen.getByText("×");
		fireEvent.click(closeBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when overlay clicked", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const overlay = document.querySelector(".modal-overlay");
		if (overlay) {
			fireEvent.click(overlay);
		}

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose when modal content clicked", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const content = document.querySelector(".modal-content");
		if (content) {
			fireEvent.click(content);
		}

		expect(onClose).not.toHaveBeenCalled();
	});
});
