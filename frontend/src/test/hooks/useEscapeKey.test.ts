import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscapeKey } from "../../hooks/useEscapeKey";

describe("useEscapeKey", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers only while active, removes the same listener, and uses the latest close callback", () => {
		const firstClose = vi.fn();
		const secondClose = vi.fn();
		const addListener = vi.spyOn(document, "addEventListener");
		const removeListener = vi.spyOn(document, "removeEventListener");
		const { rerender, unmount } = renderHook(({ active, onClose }) => useEscapeKey(active, onClose), {
			initialProps: { active: false, onClose: firstClose },
		});

		expect(addListener).not.toHaveBeenCalledWith("keydown", expect.any(Function), false);

		rerender({ active: true, onClose: firstClose });
		const registration = addListener.mock.calls.find(([type]) => type === "keydown");
		expect(registration).toEqual(["keydown", expect.any(Function), false]);

		rerender({ active: true, onClose: secondClose });
		act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

		expect(firstClose).not.toHaveBeenCalled();
		expect(secondClose).toHaveBeenCalledTimes(1);
		expect(addListener.mock.calls.filter(([type]) => type === "keydown")).toHaveLength(1);

		unmount();
		expect(removeListener).toHaveBeenCalledWith("keydown", registration?.[1], false);
	});

	it("captures and consumes Escape for a nested modal before bubble handlers run", () => {
		const onClose = vi.fn();
		const parentHandler = vi.fn();
		document.addEventListener("keydown", parentHandler);
		const { unmount } = renderHook(() => useEscapeKey(true, onClose, { capture: true }));
		const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

		act(() => document.dispatchEvent(event));

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(parentHandler).not.toHaveBeenCalled();
		expect(event.defaultPrevented).toBe(true);

		unmount();
		document.removeEventListener("keydown", parentHandler);
	});
});
