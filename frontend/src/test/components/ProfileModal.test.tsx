import { fireEvent, render, screen, within } from "@testing-library/react";
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

		const closeBtn = within(screen.getByTestId("app-modal-footer")).getByRole("button", {
			name: /common\.close/i,
		});
		expect(closeBtn).toBeInTheDocument();
	});

	it("places profile content and footer in the shared modal scroll layout", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const scrollArea = screen.getByTestId("app-modal-scroll-area");
		const profile = screen.getByTestId("user-profile");
		const footer = screen.getByTestId("app-modal-footer");

		expect(scrollArea).toContainElement(profile);
		expect(scrollArea).not.toContainElement(footer);
		expect(footer.parentElement).toBe(scrollArea.parentElement);
	});

	it("calls onClose when close button clicked", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const closeBtn = within(screen.getByTestId("app-modal-footer")).getByRole("button", {
			name: /common\.close/i,
		});
		fireEvent.click(closeBtn);

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when overlay clicked", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		const overlay = document.querySelector(".mantine-Modal-overlay");
		if (overlay) {
			fireEvent.click(overlay);
		}

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not call onClose when modal content clicked", () => {
		const onClose = vi.fn();
		render(<ProfileModal isOpen={true} onClose={onClose} />);

		fireEvent.click(screen.getByRole("dialog"));

		expect(onClose).not.toHaveBeenCalled();
	});

	// ESC key handling is tested at the App level — the global handler in
	// App.tsx manages Escape for all modals, so per-component ESC tests are
	// not applicable here.
});
