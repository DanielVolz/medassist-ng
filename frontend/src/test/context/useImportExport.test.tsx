import { act, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useImportExport } from "../../context/useImportExport";

const feedbackMock = vi.hoisted(() => ({ showFeedback: vi.fn() }));
const authFetchMock = vi.fn();

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({
		user: { id: 7, username: "owner" },
		authFetch: authFetchMock,
	}),
}));

vi.mock("../../context/FeedbackContext", () => ({
	useFeedback: () => ({
		showFeedback: feedbackMock.showFeedback,
	}),
}));

function createHook(onImportComplete = vi.fn()) {
	return renderHook(() => useImportExport({ onImportComplete }));
}

function installFileReader(result: string) {
	class MockFileReader {
		onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
		readAsText = vi.fn(() => {
			this.onload?.({ target: { result } } as unknown as ProgressEvent<FileReader>);
		});
	}
	vi.stubGlobal("FileReader", MockFileReader as unknown as typeof FileReader);
}

describe("useImportExport", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authFetchMock.mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ version: "1", medications: [] }),
			text: () => Promise.resolve('{"imported":{"medications":1,"doseHistory":2,"refillHistory":3,"shareLinks":4}}'),
		});
	});

	it("exports non-sensitive data with images by default", async () => {
		const click = vi.fn();
		const appendChild = vi.spyOn(document.body, "appendChild");
		const removeChild = vi.spyOn(document.body, "removeChild");
		const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export-url");
		const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const originalCreateElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
			const element = originalCreateElement(tagName);
			if (tagName === "a") {
				Object.defineProperty(element, "click", { value: click, configurable: true });
			}
			return element;
		});

		const { result } = createHook();

		await act(async () => {
			await result.current.handleExport();
		});

		expect(authFetchMock).toHaveBeenCalledWith("/api/export?includeSensitive=false&includeImages=true");
		expect(createObjectURL).toHaveBeenCalled();
		expect(click).toHaveBeenCalled();
		expect(appendChild).toHaveBeenCalled();
		expect(removeChild).toHaveBeenCalled();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:export-url");
	});

	it("requests sensitive export only when explicitly requested", async () => {
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sensitive-export-url");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

		const { result } = createHook();

		await act(async () => {
			await result.current.handleExport(false, true);
		});

		expect(authFetchMock).toHaveBeenCalledWith("/api/export?includeSensitive=true&includeImages=false");
	});

	it("loads an import preview and opens the confirmation state", async () => {
		const payload = { version: "1", exportedAt: "2026-01-01T00:00:00.000Z", medications: [] };
		const preview = {
			version: "1",
			exportedAt: "2026-01-01T00:00:00.000Z",
			includeSensitiveData: false,
			incoming: {
				medications: 1,
				doseHistory: 0,
				refillHistory: 0,
				shareLinks: 0,
				journalEntries: 0,
				imageCount: 0,
				hasSettings: false,
			},
			current: {
				medications: 0,
				doseHistory: 0,
				refillHistory: 0,
				shareLinks: 0,
				hasSettings: true,
			},
			warnings: {
				replacesExistingData: true,
				regeneratesShareLinks: false,
				containsImages: false,
				containsSensitiveData: false,
			},
		};
		authFetchMock.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(JSON.stringify({ preview })) });
		installFileReader(JSON.stringify(payload));

		const { result } = createHook();
		const file = new File(["ok"], "backup.json", { type: "application/json" });

		act(() => {
			result.current.handleImportFileSelect({
				target: { files: [file], value: "backup.json" },
			} as unknown as React.ChangeEvent<HTMLInputElement>);
		});

		await waitFor(() => {
			expect(authFetchMock).toHaveBeenCalledWith(
				"/api/import/preview",
				expect.objectContaining({
					method: "POST",
					body: JSON.stringify(payload),
				})
			);
			expect(result.current.showImportConfirm).toBe(true);
			expect(result.current.pendingImportData).toEqual(payload);
			expect(result.current.importPreview).toEqual(preview);
		});
	});

	it("confirms import, stores result counts, and reloads app data through callback", async () => {
		const onImportComplete = vi.fn();
		const { result } = createHook(onImportComplete);

		act(() => {
			result.current.setPendingImportData({ version: "1", exportedAt: "2026-01-01T00:00:00.000Z" });
		});

		await act(async () => {
			await result.current.handleImportConfirm();
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/import",
			expect.objectContaining({
				method: "POST",
			})
		);
		expect(onImportComplete).toHaveBeenCalled();
		expect(result.current.importResult).toEqual({ medications: 1, doses: 2, refills: 3, shares: 4 });
		expect(result.current.pendingImportData).toBeNull();
		expect(result.current.importPreview).toBeNull();
	});

	it("rejects invalid import files without calling preview endpoint", () => {
		installFileReader("not-json");

		const { result } = createHook();
		const file = new File(["bad"], "bad.json", { type: "application/json" });

		act(() => {
			result.current.handleImportFileSelect({
				target: { files: [file], value: "bad.json" },
			} as unknown as React.ChangeEvent<HTMLInputElement>);
		});

		expect(authFetchMock).not.toHaveBeenCalled();
		expect(feedbackMock.showFeedback).toHaveBeenCalledWith({ message: "exportImport.invalidFile", tone: "error" });
	});
});
