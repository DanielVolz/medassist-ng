import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShareDialog } from "../../components/ShareDialog";

describe("ShareDialog", () => {
	const defaultProps = {
		show: true,
		sharePeople: ["Alice", "Bob"],
		shareSelectedPerson: "Alice",
		onShareSelectedPersonChange: vi.fn(),
		shareSelectedDays: 30,
		onShareSelectedDaysChange: vi.fn(),
		shareSelectedExpiryDays: null,
		onShareSelectedExpiryDaysChange: vi.fn(),
		shareAllowJournalNotes: false,
		onShareAllowJournalNotesChange: vi.fn(),
		shareGenerating: false,
		shareLink: null,
		onShareLinkChange: vi.fn(),
		shareCopied: false,
		onShareCopiedChange: vi.fn(),
		activeShareLinks: [],
		activeSharesLoading: false,
		revokingShareToken: null,
		onClose: vi.fn(),
		onGenerateShareLink: vi.fn(),
		onRevokeShareLink: vi.fn().mockResolvedValue(true),
		onCopyShareLink: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when show is false", () => {
		const { container } = render(<ShareDialog {...defaultProps} show={false} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders dialog when show is true", () => {
		render(<ShareDialog {...defaultProps} />);
		expect(screen.getByText(/share\.title/i)).toBeInTheDocument();
	});

	it("renders no people message when sharePeople is empty", () => {
		render(<ShareDialog {...defaultProps} sharePeople={[]} />);
		expect(screen.getByText(/share\.noPeople/i)).toBeInTheDocument();
	});

	it("renders person selection dropdown", () => {
		render(<ShareDialog {...defaultProps} />);
		expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "Bob" })).toBeInTheDocument();
	});

	it("renders the translated all-people option label", () => {
		render(<ShareDialog {...defaultProps} sharePeople={["all", "Alice"]} shareSelectedPerson="all" />);
		expect(screen.getByRole("option", { name: "share.allPeople" })).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument();
	});

	it("renders period selection dropdown", () => {
		render(<ShareDialog {...defaultProps} />);
		// The dropdown renders with 3 options for time periods
		const options = screen.getAllByRole("option");
		expect(options.length).toBeGreaterThanOrEqual(3);
	});

	it("calls onClose when close button is clicked", () => {
		render(<ShareDialog {...defaultProps} />);
		const closeButtons = screen.getAllByRole("button", { name: /common\.close/i });
		fireEvent.click(closeButtons[closeButtons.length - 1]);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("calls onClose when overlay is clicked", () => {
		const { container } = render(<ShareDialog {...defaultProps} />);
		const overlay = container.querySelector(".modal-overlay");
		fireEvent.click(overlay!);
		expect(defaultProps.onClose).toHaveBeenCalled();
	});

	it("shows generated link", () => {
		render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" />);
		const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
		expect(inputs[0]).toHaveValue("http://example.com/share/abc123");
		expect(inputs).toHaveLength(1);
	});

	it("calls onCopyShareLink when copy button is clicked", () => {
		render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" />);
		fireEvent.click(screen.getByRole("button", { name: /share\.copyLink/i }));
		expect(defaultProps.onCopyShareLink).toHaveBeenCalled();
	});

	it("shows copied indicator after copy", () => {
		render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" shareCopied={true} />);
		expect(screen.getByRole("button", { name: /share\.copied/i })).toBeInTheDocument();
	});

	it("selects link text when input is clicked", () => {
		render(<ShareDialog {...defaultProps} shareLink="http://example.com/share/abc123" />);
		const input = screen.getAllByRole("textbox")[0] as HTMLInputElement;
		const selectMock = vi.fn();
		input.select = selectMock;
		fireEvent.click(input);
		expect(selectMock).toHaveBeenCalled();
	});

	it("calls person and period change callbacks", () => {
		render(<ShareDialog {...defaultProps} />);

		const selects = screen.getAllByRole("combobox");
		fireEvent.change(selects[0], { target: { value: "Bob" } });
		fireEvent.change(selects[1], { target: { value: "90" } });
		fireEvent.change(selects[2], { target: { value: "30" } });
		fireEvent.click(screen.getByLabelText(/share\.allowJournalNotes/i));

		expect(defaultProps.onShareSelectedPersonChange).toHaveBeenCalledWith("Bob");
		expect(defaultProps.onShareSelectedDaysChange).toHaveBeenCalledWith(90);
		expect(defaultProps.onShareSelectedExpiryDaysChange).toHaveBeenCalledWith(30);
		expect(defaultProps.onShareAllowJournalNotesChange).toHaveBeenCalledWith(true);
	});

	it("disables generate button when no person is selected", () => {
		render(<ShareDialog {...defaultProps} shareSelectedPerson="" />);

		const generateButton = screen.getByRole("button", { name: /share\.generateLink/i });
		expect(generateButton).toBeDisabled();
	});

	it("keeps active share management collapsed until opened", () => {
		render(
			<ShareDialog
				{...defaultProps}
				activeShareLinks={[
					{
						token: "abcdef0123456789",
						takenBy: "Alice",
						scheduleDays: 30,
						createdAt: "2026-05-17T12:00:00.000Z",
						expiresAt: null,
						allowJournalNotes: true,
						shareUrl: "/share/abcdef0123456789",
					},
				]}
			/>
		);

		expect(screen.getByText(/share\.manageLinksSummary/i)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /share\.revoke/i })).not.toBeInTheDocument();

		fireEvent.click(screen.getByText(/share\.manageLinksSummary/i));

		expect(screen.getByRole("button", { name: /share\.revoke/i })).toBeInTheDocument();
	});

	it("uses an in-app confirm modal before revoking an active share link", async () => {
		render(
			<ShareDialog
				{...defaultProps}
				activeShareLinks={[
					{
						token: "abcdef0123456789",
						takenBy: "Alice",
						scheduleDays: 30,
						createdAt: "2026-05-17T12:00:00.000Z",
						expiresAt: null,
						allowJournalNotes: true,
						shareUrl: "/share/abcdef0123456789",
					},
				]}
			/>
		);

		fireEvent.click(screen.getByText(/share\.manageLinksSummary/i));
		fireEvent.click(screen.getByRole("button", { name: /share\.revoke/i }));

		expect(screen.getByText(/share\.revokeConfirm/i)).toBeInTheDocument();

		fireEvent.click(screen.getAllByRole("button", { name: /share\.revoke/i })[1]);

		expect(defaultProps.onRevokeShareLink).toHaveBeenCalledWith("abcdef0123456789");
	});
});
