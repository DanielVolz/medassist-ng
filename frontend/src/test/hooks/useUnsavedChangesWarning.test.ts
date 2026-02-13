import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesWarning } from "../../hooks/useUnsavedChangesWarning";

describe("useUnsavedChangesWarning", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers and unregisters beforeunload listener", () => {
		const addListenerSpy = vi.spyOn(window, "addEventListener");
		const removeListenerSpy = vi.spyOn(window, "removeEventListener");

		const { unmount } = renderHook(() => useUnsavedChangesWarning(false));

		const beforeUnloadCall = addListenerSpy.mock.calls.find((call) => call[0] === "beforeunload");
		expect(beforeUnloadCall).toBeDefined();

		const handler = beforeUnloadCall?.[1] as EventListener;
		unmount();

		expect(removeListenerSpy).toHaveBeenCalledWith("beforeunload", handler);
	});

	it("sets returnValue when unsaved changes exist", () => {
		const addListenerSpy = vi.spyOn(window, "addEventListener");
		renderHook(() => useUnsavedChangesWarning(true));

		const beforeUnloadCall = addListenerSpy.mock.calls.find((call) => call[0] === "beforeunload");
		const handler = beforeUnloadCall?.[1] as (event: BeforeUnloadEvent) => unknown;

		const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
		handler(event);

		expect(event.preventDefault).toHaveBeenCalled();
		expect(event.returnValue).toBe("common.unsavedChanges.message");
	});

	it("does not set returnValue when there are no unsaved changes", () => {
		const addListenerSpy = vi.spyOn(window, "addEventListener");
		renderHook(() => useUnsavedChangesWarning(false));

		const beforeUnloadCall = addListenerSpy.mock.calls.find((call) => call[0] === "beforeunload");
		const handler = beforeUnloadCall?.[1] as (event: BeforeUnloadEvent) => unknown;

		const event = { preventDefault: vi.fn(), returnValue: undefined } as unknown as BeforeUnloadEvent;
		handler(event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(event.returnValue).toBeUndefined();
	});
});
