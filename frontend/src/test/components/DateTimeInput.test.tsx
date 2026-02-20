import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateTimeInput } from "../../components/DateTimeInput";

vi.mock("../../utils/formatters", () => ({
	formatDateTime: vi.fn(() => "14.02.2026, 20:30"),
	getNumericLocale: vi.fn(() => "de-DE"),
}));

describe("DateTimeInput", () => {
	it("renders placeholder when value is empty", () => {
		render(<DateTimeInput value="" onChange={vi.fn()} placeholder="Select date time" />);

		expect(screen.getByText("Select date time")).toBeInTheDocument();
		expect(screen.getByDisplayValue("")).toHaveAttribute("type", "datetime-local");
	});

	it("renders formatted datetime display", () => {
		render(<DateTimeInput value="2026-02-14T20:30" onChange={vi.fn()} />);

		expect(screen.getByText("14.02.2026, 20:30")).toBeInTheDocument();
		expect(screen.getByDisplayValue("2026-02-14T20:30")).toBeInTheDocument();
	});

	it("uses picker on click and keyboard", () => {
		render(<DateTimeInput value="2026-02-14T20:30" onChange={vi.fn()} />);

		const input = screen.getByDisplayValue("2026-02-14T20:30") as HTMLInputElement & {
			showPicker?: () => void;
		};
		const showPicker = vi.fn();
		input.showPicker = showPicker;
		const wrapper = input.closest(".date-input-wrapper") as HTMLElement;

		fireEvent.click(wrapper);
		fireEvent.keyDown(wrapper, { key: "Enter" });

		expect(showPicker).toHaveBeenCalledTimes(2);
	});
});
