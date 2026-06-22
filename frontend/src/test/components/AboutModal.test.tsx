import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AboutModal from "../../components/AboutModal";

// Mock App module for constants
vi.mock("../../App", () => ({
	FRONTEND_VERSION: "1.0.0",
	GITHUB_URL: "https://github.com/test/repo",
}));

describe("AboutModal", () => {
	const defaultProps = {
		isOpen: true,
		onClose: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when not open", () => {
		const { container } = render(<AboutModal {...defaultProps} isOpen={false} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders when open", () => {
		render(<AboutModal {...defaultProps} />);
		expect(screen.getByText(/about\.appName/i)).toBeInTheDocument();
	});

	it("displays version number", () => {
		render(<AboutModal {...defaultProps} />);
		expect(screen.getByText(/1\.0\.0/)).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", () => {
		render(<AboutModal {...defaultProps} />);
		fireEvent.click(screen.getByRole("button", { name: /common\.close/i }));
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		render(<AboutModal {...defaultProps} />);
		// Mantine renders the modal in a portal; query the document instead of the container
		const overlay = document.querySelector(".mantine-Modal-overlay");
		expect(overlay).toBeInTheDocument();
		fireEvent.click(overlay as HTMLElement);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("does not call onClose when modal content is clicked", () => {
		render(<AboutModal {...defaultProps} />);
		fireEvent.click(screen.getByRole("dialog"));
		expect(defaultProps.onClose).not.toHaveBeenCalled();
	});

	it("renders GitHub link", () => {
		render(<AboutModal {...defaultProps} />);
		const links = screen.getAllByRole("link");
		expect(links.length).toBeGreaterThan(0);
	});

	it("renders version as link to GitHub release", () => {
		render(<AboutModal {...defaultProps} />);
		const versionLink = screen.getByText("1.0.0").closest("a");
		expect(versionLink).toHaveAttribute("href", "https://github.com/test/repo/releases/tag/v1.0.0");
		expect(versionLink).toHaveAttribute("target", "_blank");
	});

	it("shows up-to-date result after successful version check", async () => {
		vi.useFakeTimers();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ tag_name: "v1.0.0" }),
		});

		render(<AboutModal {...defaultProps} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /about\.checkForUpdates/i }));
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(screen.getByText(/about\.upToDate/i)).toBeInTheDocument();

		vi.useRealTimers();
	});

	it("shows update available result with download link", async () => {
		vi.useFakeTimers();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve({ tag_name: "v1.2.0" }),
		});

		render(<AboutModal {...defaultProps} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /about\.checkForUpdates/i }));
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(screen.getByText(/about\.updateAvailable/i)).toBeInTheDocument();

		const downloadLink = screen.getByRole("link", { name: /about\.downloadUpdate/i });
		expect(downloadLink).toHaveAttribute("href", "https://github.com/test/repo/releases/latest");

		vi.useRealTimers();
	});

	it("shows error result when update check fails", async () => {
		vi.useFakeTimers();
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: false,
			json: () => Promise.resolve({}),
		});

		render(<AboutModal {...defaultProps} />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /about\.checkForUpdates/i }));
			await vi.advanceTimersByTimeAsync(1000);
		});

		expect(screen.getByText(/about\.checkFailed/i)).toBeInTheDocument();

		vi.useRealTimers();
	});
});
