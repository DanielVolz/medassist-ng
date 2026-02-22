import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../components/Lightbox";

describe("Lightbox", () => {
	const defaultProps = {
		src: "/test-image.jpg",
		alt: "Test Image",
		onClose: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders image with correct src and alt", () => {
		render(<Lightbox {...defaultProps} />);

		const img = screen.getByAltText("Test Image");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("src", "/test-image.jpg");
	});

	it("renders close button", () => {
		render(<Lightbox {...defaultProps} />);

		expect(screen.getByText("×")).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", () => {
		const onClose = vi.fn();
		render(<Lightbox {...defaultProps} onClose={onClose} />);

		fireEvent.click(screen.getByText("×"));

		expect(onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		const onClose = vi.fn();
		const { container } = render(<Lightbox {...defaultProps} onClose={onClose} />);

		const overlay = container.querySelector(".lightbox-overlay");
		fireEvent.click(overlay!);

		expect(onClose).toHaveBeenCalled();
	});

	it("calls onClose when Escape key is pressed", () => {
		const onClose = vi.fn();
		const { container } = render(<Lightbox {...defaultProps} onClose={onClose} />);

		const overlay = container.querySelector(".lightbox-overlay");
		fireEvent.keyDown(overlay!, { key: "Escape" });

		expect(onClose).toHaveBeenCalled();
	});

	it("does not call onClose when image is clicked", () => {
		const onClose = vi.fn();
		render(<Lightbox {...defaultProps} onClose={onClose} />);

		fireEvent.click(screen.getByAltText("Test Image"));

		expect(onClose).not.toHaveBeenCalled();
	});

	it("applies correct CSS classes", () => {
		const { container } = render(<Lightbox {...defaultProps} />);

		expect(container.querySelector(".lightbox-overlay")).toBeInTheDocument();
		expect(container.querySelector(".lightbox-close")).toBeInTheDocument();
		expect(container.querySelector(".lightbox-image")).toBeInTheDocument();
	});
});
