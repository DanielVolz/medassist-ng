import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerHistoryPopGuard, useModalHistory } from "../../hooks/useModalHistory";

describe("useModalHistory", () => {
	beforeEach(() => {
		vi.spyOn(window.history, "pushState").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("runs registered pop guards before later listeners and stops a handled pop", () => {
		const guard = vi.fn(() => true);
		const laterListener = vi.fn();
		const unregister = registerHistoryPopGuard(guard);
		window.addEventListener("popstate", laterListener);

		act(() => {
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(guard).toHaveBeenCalledTimes(1);
		expect(laterListener).not.toHaveBeenCalled();
		unregister();
		window.removeEventListener("popstate", laterListener);
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

	it("reuses a matching current history entry when opted in", () => {
		vi.spyOn(window.history, "state", "get").mockReturnValue({ modal: "medDetail", medId: 42 });

		renderHook(() =>
			useModalHistory(true, "medDetail", vi.fn(), {
				state: { medId: 42 },
				reuseCurrentEntry: true,
			})
		);

		expect(window.history.pushState).not.toHaveBeenCalled();
	});

	it("pushes a new entry when the current modal state does not match", () => {
		vi.spyOn(window.history, "state", "get").mockReturnValue({ modal: "medDetail", medId: 42 });

		renderHook(() =>
			useModalHistory(true, "medDetail", vi.fn(), {
				state: { medId: 43 },
				reuseCurrentEntry: true,
			})
		);

		expect(window.history.pushState).toHaveBeenCalledWith({ modal: "medDetail", medId: 43 }, "");
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

	it("does not let a programmatic child close consume the parent on the resulting popstate", () => {
		vi.spyOn(window.history, "back").mockImplementation(() => {});
		const parentClose = vi.fn();
		const childClose = vi.fn();
		const { result } = renderHook(() => {
			useModalHistory(true, "parent", parentClose);
			return useModalHistory(true, "child", childClose);
		});
		act(() => result.current.closeModal());
		act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(childClose).toHaveBeenCalledTimes(1);
		expect(parentClose).not.toHaveBeenCalled();
		act(() => window.dispatchEvent(new PopStateEvent("popstate")));
		expect(parentClose).toHaveBeenCalledTimes(1);
	});
});
