import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MedicationAvatar } from "../../components/MedicationAvatar";

describe("MedicationAvatar", () => {
	it("renders initials when no image provided", () => {
		render(<MedicationAvatar name="Test Medication" />);

		expect(screen.getByText("TM")).toBeInTheDocument();
	});

	it("uses first two initials from medication name", () => {
		render(<MedicationAvatar name="Very Long Medication Name" />);

		expect(screen.getByText("VL")).toBeInTheDocument();
	});

	it("handles single word names", () => {
		render(<MedicationAvatar name="Aspirin" />);

		expect(screen.getByText("A")).toBeInTheDocument();
	});

	it("renders image when imageUrl provided", () => {
		render(<MedicationAvatar name="Test Med" imageUrl="test-image.jpg" />);

		const img = screen.getByAltText("Test Med");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("src", "/api/images/test-image.jpg");
	});

	it("applies small size class by default", () => {
		const { container } = render(<MedicationAvatar name="Test" />);

		expect(container.querySelector(".med-avatar-sm")).toBeInTheDocument();
	});

	it("applies medium size class", () => {
		const { container } = render(<MedicationAvatar name="Test" size="md" />);

		expect(container.querySelector(".med-avatar-md")).toBeInTheDocument();
	});

	it("applies large size class", () => {
		const { container } = render(<MedicationAvatar name="Test" size="lg" />);

		expect(container.querySelector(".med-avatar-lg")).toBeInTheDocument();
	});

	it("handles empty name with fallback", () => {
		render(<MedicationAvatar name="" />);

		expect(screen.getByText("?")).toBeInTheDocument();
	});

	it("converts initials to uppercase", () => {
		render(<MedicationAvatar name="lower case" />);

		expect(screen.getByText("LC")).toBeInTheDocument();
	});

	it("adds initials class when no image", () => {
		const { container } = render(<MedicationAvatar name="Test" />);

		expect(container.querySelector(".med-avatar-initials")).toBeInTheDocument();
	});
});
