import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateInput, MonthInput } from "../../components/DateInput";

vi.mock("../../utils/formatters", () => ({
	formatDate: vi.fn(() => "14.02.2026"),
	formatMonth: vi.fn(() => "02.2026"),
	getNumericLocale: vi.fn(() => "de-DE"),
	toMonthValue: vi.fn((value: string) => value.slice(0, 7)),
}));

describe("DateInput", () => {
	it("renders placeholder display when value is empty", () => {
		render(<DateInput value="" onChange={vi.fn()} placeholder="Select date" />);

		expect(screen.getByText("Select date")).toBeInTheDocument();
		expect(screen.getByDisplayValue("")).toHaveAttribute("type", "date");
	});

	it("renders formatted date display when value exists", () => {
		render(<DateInput value="2026-02-14" onChange={vi.fn()} />);

		expect(screen.getByText("14.02.2026")).toBeInTheDocument();
		expect(screen.getByDisplayValue("2026-02-14")).toBeInTheDocument();
	});

	it("renders month input with month/year display", () => {
		render(<MonthInput value="2026-02-14" onChange={vi.fn()} />);

		const picker = screen.getByRole("button", { name: "02.2026" });
		expect(picker).toHaveAttribute("data-dates-input", "true");
		expect(picker).toHaveAttribute("type", "button");
		expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
	});

	it("tries showPicker on wrapper click", () => {
		render(<DateInput value="2026-02-14" onChange={vi.fn()} />);

		const input = screen.getByDisplayValue("2026-02-14") as HTMLInputElement & {
			showPicker?: () => void;
		};
		const showPicker = vi.fn();
		input.showPicker = showPicker;

		fireEvent.click(input.closest(".date-input-wrapper") as HTMLElement);
		expect(showPicker).toHaveBeenCalledTimes(1);
	});

	it("falls back to focus when showPicker throws", () => {
		render(<DateInput value="2026-02-14" onChange={vi.fn()} />);

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

	it("triggers picker fallback on Enter and Space", () => {
		render(<DateInput value="2026-02-14" onChange={vi.fn()} />);

		const input = screen.getByDisplayValue("2026-02-14") as HTMLInputElement & {
			showPicker?: () => void;
		};
		const showPicker = vi.fn();
		input.showPicker = showPicker;
		const wrapper = input.closest(".date-input-wrapper") as HTMLElement;

		fireEvent.keyDown(wrapper, { key: "Enter" });
		fireEvent.keyDown(wrapper, { key: " " });

		expect(showPicker).toHaveBeenCalledTimes(2);
	});
});
