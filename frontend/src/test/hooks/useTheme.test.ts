import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme } from "../../hooks/useTheme";

describe("useTheme", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
		// Reset mock to default behavior
		(window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {});
		// Mock matchMedia to return dark system theme by default
		Object.defineProperty(window, "matchMedia", {
			writable: true,
			value: vi.fn().mockImplementation((query: string) => ({
				matches: false,
				media: query,
				onchange: null,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				dispatchEvent: vi.fn(),
				addListener: vi.fn(),
				removeListener: vi.fn(),
			})),
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns dark as default theme", () => {
		const { result } = renderHook(() => useTheme());
		expect(result.current.theme).toBe("dark");
		expect(result.current.themePreference).toBe("dark");
	});

	it("reads theme preference from localStorage", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("light");
		const { result } = renderHook(() => useTheme());
		expect(result.current.theme).toBe("light");
		expect(result.current.themePreference).toBe("light");
	});

	it("toggles theme through light → dark → system → light", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("light");
		const { result } = renderHook(() => useTheme());
		expect(result.current.themePreference).toBe("light");

		act(() => {
			result.current.toggleTheme();
		});
		expect(result.current.themePreference).toBe("dark");

		act(() => {
			result.current.toggleTheme();
		});
		expect(result.current.themePreference).toBe("system");

		act(() => {
			result.current.toggleTheme();
		});
		expect(result.current.themePreference).toBe("light");
	});

	it("sets theme preference directly", () => {
		const { result } = renderHook(() => useTheme());
		expect(result.current.themePreference).toBe("dark");

		act(() => {
			result.current.setThemePreference("light");
		});
		expect(result.current.themePreference).toBe("light");
		expect(result.current.theme).toBe("light");

		act(() => {
			result.current.setThemePreference("system");
		});
		expect(result.current.themePreference).toBe("system");
		// System resolves to dark (matchMedia returns false for light)
		expect(result.current.theme).toBe("dark");
	});

	it("saves theme preference to localStorage on change", () => {
		const { result } = renderHook(() => useTheme());

		act(() => {
			result.current.setThemePreference("light");
		});
		expect(window.localStorage.setItem).toHaveBeenCalledWith("theme", "light");

		act(() => {
			result.current.setThemePreference("system");
		});
		expect(window.localStorage.setItem).toHaveBeenCalledWith("theme", "system");
	});

	it("sets data-theme attribute on document", () => {
		const { result } = renderHook(() => useTheme());
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

		act(() => {
			result.current.setThemePreference("light");
		});
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	});
});
