import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getStoredTheme,
	loadCollapsedDaysFromStorage,
	plusDaysIso,
	saveCollapsedDaysToStorage,
	saveTheme,
	todayIso,
	userStorageKey,
} from "../../utils/storage";

describe("userStorageKey", () => {
	it("generates user-specific storage key", () => {
		expect(userStorageKey(123, "testKey")).toBe("testKey_user_123");
	});

	it("works with string userId", () => {
		expect(userStorageKey("456", "myKey")).toBe("myKey_user_456");
	});
});

describe("todayIso", () => {
	it("returns today date in ISO format", () => {
		const result = todayIso();
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		const today = new Date();
		const year = today.getFullYear();
		const month = String(today.getMonth() + 1).padStart(2, "0");
		const day = String(today.getDate()).padStart(2, "0");
		expect(result).toBe(`${year}-${month}-${day}`);
	});
});

describe("plusDaysIso", () => {
	it("returns date N days from today", () => {
		const today = new Date();
		const expectedDate = new Date(today);
		expectedDate.setDate(expectedDate.getDate() + 7);

		const result = plusDaysIso(7);
		expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		const year = expectedDate.getFullYear();
		const month = String(expectedDate.getMonth() + 1).padStart(2, "0");
		const day = String(expectedDate.getDate()).padStart(2, "0");
		expect(result).toBe(`${year}-${month}-${day}`);
	});

	it("handles zero days", () => {
		expect(plusDaysIso(0)).toBe(todayIso());
	});

	it("handles negative days", () => {
		const today = new Date();
		const expectedDate = new Date(today);
		expectedDate.setDate(expectedDate.getDate() - 3);

		const result = plusDaysIso(-3);
		const year = expectedDate.getFullYear();
		const month = String(expectedDate.getMonth() + 1).padStart(2, "0");
		const day = String(expectedDate.getDate()).padStart(2, "0");
		expect(result).toBe(`${year}-${month}-${day}`);
	});
});

describe("loadCollapsedDaysFromStorage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
	});

	it("returns empty sets when no data in storage", () => {
		const result = loadCollapsedDaysFromStorage("collapsed", "expanded");
		expect(result.collapsed.size).toBe(0);
		expect(result.expanded.size).toBe(0);
	});

	it("loads collapsed days from localStorage", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
			if (key === "collapsed") return JSON.stringify(["2024-01-01", "2024-01-02"]);
			return null;
		});

		const result = loadCollapsedDaysFromStorage("collapsed", "expanded");
		expect(result.collapsed.has("2024-01-01")).toBe(true);
		expect(result.collapsed.has("2024-01-02")).toBe(true);
		expect(result.collapsed.size).toBe(2);
	});

	it("loads expanded days from localStorage", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
			if (key === "expanded") return JSON.stringify(["2024-01-03"]);
			return null;
		});

		const result = loadCollapsedDaysFromStorage("collapsed", "expanded");
		expect(result.expanded.has("2024-01-03")).toBe(true);
		expect(result.expanded.size).toBe(1);
	});

	it("handles invalid JSON gracefully", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("invalid-json");

		const result = loadCollapsedDaysFromStorage("collapsed", "expanded");
		expect(result.collapsed.size).toBe(0);
		expect(result.expanded.size).toBe(0);
	});

	it("handles non-array JSON gracefully", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('{"not": "array"}');

		const result = loadCollapsedDaysFromStorage("collapsed", "expanded");
		expect(result.collapsed.size).toBe(0);
	});
});

describe("saveCollapsedDaysToStorage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("saves state to localStorage", () => {
		const state = { "2024-01-01": true, "2024-01-02": false };
		saveCollapsedDaysToStorage("testKey", state);

		expect(window.localStorage.setItem).toHaveBeenCalledWith("testKey", JSON.stringify(state));
	});

	it("handles storage errors gracefully", () => {
		(window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("Storage full");
		});

		// Should not throw
		expect(() => {
			saveCollapsedDaysToStorage("testKey", { key: true });
		}).not.toThrow();
	});
});

describe("getStoredTheme", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
	});

	it('returns "dark" as default', () => {
		expect(getStoredTheme()).toBe("dark");
	});

	it("returns stored theme", () => {
		(window.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("light");
		expect(getStoredTheme()).toBe("light");
	});
});

describe("saveTheme", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset mock to default behavior
		(window.localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(() => {});
	});

	it("saves theme to localStorage", () => {
		saveTheme("light");
		expect(window.localStorage.setItem).toHaveBeenCalledWith("theme", "light");
	});

	it("saves dark theme", () => {
		saveTheme("dark");
		expect(window.localStorage.setItem).toHaveBeenCalledWith("theme", "dark");
	});
});
