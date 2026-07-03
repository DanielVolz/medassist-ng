import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppCheckbox } from "../../ui/primitives/AppCheckbox";
import { AppSwitch } from "../../ui/primitives/AppSwitch";
import { AppTooltip, AppTooltipIcon } from "../../ui/primitives/AppTooltip";

function makeRect({ x, y, width, height }: { x: number; y: number; width: number; height: number }): DOMRect {
	return {
		bottom: y + height,
		height,
		left: x,
		right: x + width,
		toJSON: () => ({}),
		top: y,
		width,
		x,
		y,
	} as DOMRect;
}

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

	it("opens app tooltip icons from touch input as body portals with aria-describedby", async () => {
		const { container } = render(<AppTooltipIcon label="Mobile help" />);

		const trigger = screen.getByRole("button", { name: "Mobile help" });
		fireEvent.touchStart(trigger);

		const tooltip = await screen.findByRole("tooltip");
		expect(tooltip).toHaveTextContent("Mobile help");
		expect(tooltip.id).toBeTruthy();
		expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);
		expect(tooltip.parentElement).toBe(document.body);
		expect(container).not.toContainElement(tooltip);
	});

	it("clamps app tooltips near the left mobile viewport edge", async () => {
		const originalInnerWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

		const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
			this: HTMLElement
		) {
			if (this.getAttribute("role") === "tooltip") {
				const styleLeft = Number.parseFloat(this.style.left || this.style.getPropertyValue("--app-tooltip-left"));
				const styleTop = Number.parseFloat(this.style.top || this.style.getPropertyValue("--app-tooltip-top"));
				return makeRect({
					x: Number.isFinite(styleLeft) ? styleLeft : 0,
					y: Number.isFinite(styleTop) ? styleTop : 0,
					width: 240,
					height: 42,
				});
			}

			if (
				this instanceof HTMLButtonElement ||
				(this instanceof HTMLElement && this.querySelector("button")?.textContent === "Edge target")
			) {
				return makeRect({ x: 2, y: 64, width: 20, height: 20 });
			}

			return makeRect({ x: 0, y: 0, width: 0, height: 0 });
		});

		try {
			render(
				<AppTooltip label="Edge help">
					<button type="button">Edge target</button>
				</AppTooltip>
			);

			fireEvent.touchStart(screen.getByRole("button", { name: "Edge target" }));
			const tooltip = await screen.findByRole("tooltip");

			await waitFor(() => {
				const bounds = tooltip.getBoundingClientRect();
				expect(bounds.left).toBeGreaterThanOrEqual(8);
				expect(bounds.right).toBeLessThanOrEqual(window.innerWidth - 8);
				expect(bounds.top).toBeGreaterThanOrEqual(0);
			});
		} finally {
			rectSpy.mockRestore();
			Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
		}
	});

	it("closes touch-opened app tooltips when the page scrolls or touch moves", async () => {
		render(<AppTooltipIcon label="Scroll help" />);

		const trigger = screen.getByRole("button", { name: "Scroll help" });
		fireEvent.touchStart(trigger);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Scroll help");

		fireEvent.touchMove(trigger);

		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});

		fireEvent.touchStart(trigger);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Scroll help");

		fireEvent.scroll(document);

		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});

		fireEvent.touchStart(trigger);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Scroll help");

		fireEvent.pointerMove(trigger, { pointerType: "touch" });

		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});
	});

	it("does not reopen from focus after a touch scroll closes the tooltip", async () => {
		render(<AppTooltipIcon label="Focus after touch help" />);

		const trigger = screen.getByRole("button", { name: "Focus after touch help" });
		fireEvent.touchStart(trigger);
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Focus after touch help");

		fireEvent.touchMove(trigger);
		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});

		fireEvent.focus(trigger);
		await new Promise((resolve) => window.setTimeout(resolve, 220));

		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
	});

	it("closes focus-opened app tooltips when the page scrolls", async () => {
		render(
			<AppTooltip label="Focused help" openDelay={0}>
				<button type="button">Focused target</button>
			</AppTooltip>
		);

		fireEvent.focus(screen.getByRole("button", { name: "Focused target" }));
		expect(await screen.findByRole("tooltip")).toHaveTextContent("Focused help");

		fireEvent.scroll(document);

		await waitFor(() => {
			expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
		});
	});
});
