import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalHistory } from "../../hooks/useModalHistory";

describe("useModalHistory", () => {
	beforeEach(() => {
		vi.spyOn(window.history, "pushState").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("pushes a modal history entry and closes the modal on browser back", () => {
		const onClose = vi.fn();
		const { rerender } = renderHook(({ isOpen }) => useModalHistory(isOpen, "journal-editor", onClose), {
			initialProps: { isOpen: false },
		});

		rerender({ isOpen: true });

		expect(window.history.pushState).toHaveBeenCalledWith({ modal: "journal-editor" }, "");

		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("stops parent popstate handlers when a nested modal consumes browser back", () => {
		const onClose = vi.fn();
		const parentClose = vi.fn();
		window.addEventListener("popstate", parentClose);

		renderHook(() => useModalHistory(true, "nested-confirm", onClose));

		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(parentClose).not.toHaveBeenCalled();

		window.removeEventListener("popstate", parentClose);
	});
});
