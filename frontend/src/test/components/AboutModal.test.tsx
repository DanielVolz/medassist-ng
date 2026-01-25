import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AboutModal from "../../components/AboutModal";

// Mock App module for constants
vi.mock("../../App", () => ({
	FRONTEND_VERSION: "1.0.0",
	GITHUB_URL: "https://github.com/test/repo",
}));

describe("AboutModal", () => {
	const defaultProps = {
		isOpen: true,
		onClose: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ version: "1.0.0" }),
		});
	});

	it("returns null when not open", () => {
		const { container } = render(<AboutModal {...defaultProps} isOpen={false} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders when open", () => {
		render(<AboutModal {...defaultProps} />);
		expect(screen.getByText(/about\.appName/i)).toBeInTheDocument();
	});

	it("displays version number", () => {
		render(<AboutModal {...defaultProps} />);
		expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", () => {
		render(<AboutModal {...defaultProps} />);
		fireEvent.click(screen.getByText("×"));
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		const { container } = render(<AboutModal {...defaultProps} />);
		const overlay = container.querySelector(".modal-overlay");
		fireEvent.click(overlay!);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("does not call onClose when modal content is clicked", () => {
		const { container } = render(<AboutModal {...defaultProps} />);
		const content = container.querySelector(".about-modal");
		if (content) {
			fireEvent.click(content);
			expect(defaultProps.onClose).not.toHaveBeenCalled();
		}
	});

	it("renders GitHub link", () => {
		render(<AboutModal {...defaultProps} />);
		const links = screen.getAllByRole("link");
		expect(links.length).toBeGreaterThan(0);
	});

	it("fetches backend version on open", async () => {
		render(<AboutModal {...defaultProps} />);
		expect(fetch).toHaveBeenCalledWith("/api/health");
	});
});
