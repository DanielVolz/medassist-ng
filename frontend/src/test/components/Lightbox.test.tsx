import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

		const closeButton = screen.getByRole("button", { name: "common.close" });
		expect(closeButton).toBeInTheDocument();
		expect(closeButton).not.toHaveTextContent("common.close");
	});

	it("calls onClose when close button is clicked", () => {
		const onClose = vi.fn();
		render(<Lightbox {...defaultProps} onClose={onClose} />);

		fireEvent.click(screen.getByRole("button", { name: "common.close" }));

		expect(onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		const onClose = vi.fn();
		const { container } = render(<Lightbox {...defaultProps} onClose={onClose} />);

		const overlay = container.firstElementChild;
		fireEvent.click(overlay!);

		expect(onClose).toHaveBeenCalled();
	});

	it("calls onClose when Escape key is pressed", () => {
		const onClose = vi.fn();
		render(<Lightbox {...defaultProps} onClose={onClose} />);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(onClose).toHaveBeenCalled();
	});

	it("does not call onClose when image is clicked", () => {
		const onClose = vi.fn();
		render(<Lightbox {...defaultProps} onClose={onClose} />);

		fireEvent.click(screen.getByAltText("Test Image"));

		expect(onClose).not.toHaveBeenCalled();
	});

	it("renders the overlay, close control, and image", () => {
		const { container } = render(<Lightbox {...defaultProps} />);

		const overlay = container.firstElementChild;
		const image = screen.getByAltText("Test Image");

		expect(overlay).toBeInTheDocument();
		expect(overlay).toContainElement(screen.getByRole("button", { name: "common.close" }));
		expect(overlay).toContainElement(image);
	});
});
