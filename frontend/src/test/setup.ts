import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock fetch globally
global.fetch = vi.fn();

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
	writable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock navigator.clipboard
Object.defineProperty(navigator, "clipboard", {
	value: {
		writeText: vi.fn().mockResolvedValue(undefined),
		readText: vi.fn().mockResolvedValue(""),
	},
	writable: true,
});

// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = vi.fn().mockReturnValue("blob:test-url");
global.URL.revokeObjectURL = vi.fn();

// Mock window.history
const mockHistoryPushState = vi.fn();
const mockHistoryBack = vi.fn();
Object.defineProperty(window, "history", {
	value: {
		pushState: mockHistoryPushState,
		back: mockHistoryBack,
		replaceState: vi.fn(),
		state: null,
		length: 1,
		scrollRestoration: "auto",
		go: vi.fn(),
		forward: vi.fn(),
	},
	writable: true,
});

// Mock react-i18next globally
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			if (options?.count !== undefined) return `${key}_${options.count}`;
			if (options?.max !== undefined) return `Max ${options.max} chars`;
			if (options?.days !== undefined) return `${key} (${options.days} days)`;
			return key;
		},
		i18n: {
			language: "en",
			changeLanguage: vi.fn(),
		},
	}),
	I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
	initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// Reset mocks before each test
beforeEach(() => {
	vi.clearAllMocks();
	localStorageMock.getItem.mockReturnValue(null);
	mockHistoryPushState.mockClear();
	mockHistoryBack.mockClear();
});
