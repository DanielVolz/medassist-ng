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

	it("includes modal-specific state in the pushed history entry", () => {
		const onClose = vi.fn();

		renderHook(() => useModalHistory(true, "medDetail", onClose, { state: { medId: 42 } }));

		expect(window.history.pushState).toHaveBeenCalledWith({ modal: "medDetail", medId: 42 }, "");
	});

	it("direct close closes locally and removes the modal history entry", () => {
		const onClose = vi.fn();
		vi.spyOn(window.history, "back").mockImplementation(() => {});

		const { result } = renderHook(() => useModalHistory(true, "journal-editor", onClose));

		act(() => {
			result.current.closeModal();
		});

		expect(onClose).toHaveBeenCalledTimes(1);
		expect(window.history.back).toHaveBeenCalledTimes(1);

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

	it("closes only the top modal when nested modal-history hooks are open", () => {
		const parentClose = vi.fn();
		const nestedClose = vi.fn();

		renderHook(() => {
			useModalHistory(true, "parent-modal", parentClose);
			useModalHistory(true, "nested-modal", nestedClose);
		});

		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(nestedClose).toHaveBeenCalledTimes(1);
		expect(parentClose).not.toHaveBeenCalled();
	});
});
