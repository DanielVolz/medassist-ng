import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppCheckbox } from "../../ui/primitives/AppCheckbox";
import { AppSwitch } from "../../ui/primitives/AppSwitch";
import { AppTooltipIcon } from "../../ui/primitives/AppTooltip";

describe("tooltip-enabled form primitives", () => {
	it("renders a separate accessible info button for checkbox tooltips", () => {
		render(<AppCheckbox checked={false} label="Reminder" onChange={vi.fn()} tooltip="Reminder help" />);

		expect(screen.getByRole("checkbox", { name: "Reminder" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Reminder help" })).toBeInTheDocument();
	});

	it("does not add an extra info button when checkbox tooltip is omitted", () => {
		render(<AppCheckbox checked={false} label="Reminder" onChange={vi.fn()} />);

		expect(screen.getByRole("checkbox", { name: "Reminder" })).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("renders a separate accessible info button for switch tooltips", () => {
		render(<AppSwitch checked={false} label="Repeat reminders" onChange={vi.fn()} tooltip="Repeat help" />);

		expect(screen.getByRole("switch")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Repeat help" })).toBeInTheDocument();
	});

	it("does not add an extra info button when switch tooltip is omitted", () => {
		render(<AppSwitch checked={false} label="Repeat reminders" onChange={vi.fn()} />);

		expect(screen.getByRole("switch")).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("opens app tooltip icons from touch input", async () => {
		render(<AppTooltipIcon label="Mobile help" />);

		fireEvent.touchStart(screen.getByRole("button", { name: "Mobile help" }));

		await waitFor(() => {
			expect(screen.getByRole("tooltip")).toHaveTextContent("Mobile help");
		});
	});
});
