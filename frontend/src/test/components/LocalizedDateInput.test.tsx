import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalizedDateInput } from "../../components/LocalizedDateInput";

describe("LocalizedDateInput", () => {
	it("renders a formatted display over the native input", () => {
		render(<LocalizedDateInput value="2026-02-14" displayValue="14.02.2026" inputType="date" onChange={vi.fn()} />);

		expect(screen.getByText("14.02.2026")).toHaveAttribute("aria-hidden", "true");
		expect(screen.getByDisplayValue("2026-02-14")).toHaveAttribute("type", "date");
	});

	it("uses the placeholder as display text when no formatted value exists", () => {
		render(
			<LocalizedDateInput
				value=""
				displayValue=""
				inputType="datetime-local"
				placeholder="Select date time"
				onChange={vi.fn()}
			/>
		);

		expect(screen.getByText("Select date time")).toBeInTheDocument();
		expect(screen.getByDisplayValue("")).toHaveAttribute("type", "datetime-local");
	});

	it("opens the native picker from mouse and keyboard interactions", () => {
		render(<LocalizedDateInput value="2026-02-14" displayValue="14.02.2026" inputType="date" onChange={vi.fn()} />);

		const input = screen.getByDisplayValue("2026-02-14") as HTMLInputElement & {
			showPicker?: () => void;
		};
		const showPicker = vi.fn();
		input.showPicker = showPicker;
		const wrapper = input.closest(".date-input-wrapper") as HTMLElement;

		fireEvent.click(wrapper);
		fireEvent.keyDown(wrapper, { key: "Enter" });
		fireEvent.keyDown(wrapper, { key: " " });

		expect(showPicker).toHaveBeenCalledTimes(3);
	});

	it("falls back to focusing the input when showPicker is unavailable", () => {
		render(<LocalizedDateInput value="2026-02-14" displayValue="14.02.2026" inputType="date" onChange={vi.fn()} />);

		const input = screen.getByDisplayValue("2026-02-14") as HTMLInputElement & {
			showPicker?: () => void;
		};
		input.showPicker = vi.fn(() => {
			throw new Error("showPicker not supported");
		});
		const focusSpy = vi.spyOn(input, "focus").mockImplementation(() => {});

		fireEvent.click(input.closest(".date-input-wrapper") as HTMLElement);

		expect(focusSpy).toHaveBeenCalledTimes(1);
	});
});
