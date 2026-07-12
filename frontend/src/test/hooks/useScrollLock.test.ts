import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollLock } from "../../hooks/useScrollLock";

describe("useScrollLock", () => {
	beforeEach(() => {
		Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
		vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	});

	afterEach(() => {
		document.documentElement.className = "";
		document.documentElement.removeAttribute("style");
		document.body.className = "";
		document.body.removeAttribute("style");
		vi.restoreAllMocks();
	});

	it("locks at the first active overlay and restores the saved position after the final cleanup", () => {
		const first = renderHook(() => useScrollLock(true));
		const second = renderHook(() => useScrollLock(true));

		expect(document.documentElement.classList.contains("modal-open")).toBe(true);
		expect(document.body.style.position).toBe("fixed");
		expect(document.body.style.top).toBe("-240px");

		first.unmount();
		expect(document.body.style.position).toBe("fixed");
		expect(window.scrollTo).not.toHaveBeenCalled();

		second.unmount();
		expect(document.documentElement.classList.contains("modal-open")).toBe(false);
		expect(document.body.style.position).toBe("");
		expect(document.documentElement.style.overflow).toBe("");
		expect(window.scrollTo).toHaveBeenCalledWith(0, 240);
	});

	it("unlocks when an active hook transitions to inactive", () => {
		const { rerender } = renderHook(({ active }) => useScrollLock(active), { initialProps: { active: true } });

		rerender({ active: false });

		expect(document.body.classList.contains("modal-open")).toBe(false);
		expect(window.scrollTo).toHaveBeenCalledWith(0, 240);
	});
});
