import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PasswordInput } from "../../components/PasswordInput";

describe("PasswordInput", () => {
	it("renders password input with hidden text by default", () => {
		render(<PasswordInput id="test-password" value="secret123" onChange={() => {}} />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		expect(input).toBeInTheDocument();
		expect(input.type).toBe("password");
	});

	it("toggles password visibility when eye button is clicked", () => {
		render(<PasswordInput id="test-password" value="secret123" onChange={() => {}} />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		const toggleButton = screen.getByRole("button", { name: /show password/i });

		// Initially password is hidden
		expect(input.type).toBe("password");

		// Click to show password
		fireEvent.click(toggleButton);
		expect(input.type).toBe("text");

		// Click again to hide password
		fireEvent.click(toggleButton);
		expect(input.type).toBe("password");
	});

	it("calls onChange when input value changes", () => {
		const handleChange = vi.fn();
		render(<PasswordInput id="test-password" value="" onChange={handleChange} />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "newpassword" } });

		expect(handleChange).toHaveBeenCalled();
	});

	it("passes through required attribute", () => {
		render(<PasswordInput id="test-password" value="" onChange={() => {}} required />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		expect(input.required).toBe(true);
	});

	it("passes through minLength and maxLength attributes", () => {
		render(<PasswordInput id="test-password" value="" onChange={() => {}} minLength={8} maxLength={128} />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		expect(input.minLength).toBe(8);
		expect(input.maxLength).toBe(128);
	});

	it("passes through placeholder attribute", () => {
		render(<PasswordInput id="test-password" value="" onChange={() => {}} placeholder="Enter password" />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		expect(input.placeholder).toBe("Enter password");
	});

	it("passes through autoComplete attribute", () => {
		render(<PasswordInput id="test-password" value="" onChange={() => {}} autoComplete="new-password" />);

		const input = document.getElementById("test-password") as HTMLInputElement;
		expect(input.autocomplete).toBe("new-password");
	});

	it("toggle button has correct aria-label", () => {
		render(<PasswordInput id="test-password" value="" onChange={() => {}} />);

		const toggleButton = screen.getByRole("button", { name: /show password/i });
		expect(toggleButton).toBeInTheDocument();

		fireEvent.click(toggleButton);

		const hideButton = screen.getByRole("button", { name: /hide password/i });
		expect(hideButton).toBeInTheDocument();
	});

	it("toggle button has tabIndex -1 to prevent focus during form navigation", () => {
		render(<PasswordInput id="test-password" value="" onChange={() => {}} />);

		const toggleButton = screen.getByRole("button");
		expect(toggleButton.tabIndex).toBe(-1);
	});
});
