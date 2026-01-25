import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TagInput } from "../../components/TagInput";

describe("TagInput", () => {
	const defaultProps = {
		tags: [] as string[],
		inputValue: "",
		onInputChange: vi.fn(),
		onAddTag: vi.fn(),
		onRemoveTag: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders input element", () => {
		render(<TagInput {...defaultProps} />);
		expect(screen.getByRole("combobox")).toBeInTheDocument();
	});

	it("renders existing tags", () => {
		render(<TagInput {...defaultProps} tags={["Tag1", "Tag2"]} />);
		expect(screen.getByText("Tag1")).toBeInTheDocument();
		expect(screen.getByText("Tag2")).toBeInTheDocument();
	});

	it("calls onInputChange when typing", () => {
		render(<TagInput {...defaultProps} />);
		const input = screen.getByRole("combobox");
		fireEvent.change(input, { target: { value: "new tag" } });
		expect(defaultProps.onInputChange).toHaveBeenCalledWith("new tag");
	});

	it("calls onAddTag when Enter is pressed with value", () => {
		render(<TagInput {...defaultProps} inputValue="new tag" />);
		const input = screen.getByRole("combobox");
		fireEvent.keyDown(input, { key: "Enter" });
		expect(defaultProps.onAddTag).toHaveBeenCalledWith("new tag");
	});

	it("calls onAddTag when comma is pressed with value", () => {
		render(<TagInput {...defaultProps} inputValue="new tag" />);
		const input = screen.getByRole("combobox");
		fireEvent.keyDown(input, { key: "," });
		expect(defaultProps.onAddTag).toHaveBeenCalledWith("new tag");
	});

	it("does not call onAddTag when Enter pressed with empty value", () => {
		render(<TagInput {...defaultProps} inputValue="" />);
		const input = screen.getByRole("combobox");
		fireEvent.keyDown(input, { key: "Enter" });
		expect(defaultProps.onAddTag).not.toHaveBeenCalled();
	});

	it("calls onRemoveTag when Backspace is pressed with empty input", () => {
		render(<TagInput {...defaultProps} tags={["Tag1", "Tag2"]} inputValue="" />);
		const input = screen.getByRole("combobox");
		fireEvent.keyDown(input, { key: "Backspace" });
		expect(defaultProps.onRemoveTag).toHaveBeenCalledWith("Tag2");
	});

	it("does not call onRemoveTag when Backspace pressed with value", () => {
		render(<TagInput {...defaultProps} tags={["Tag1"]} inputValue="text" />);
		const input = screen.getByRole("combobox");
		fireEvent.keyDown(input, { key: "Backspace" });
		expect(defaultProps.onRemoveTag).not.toHaveBeenCalled();
	});

	it("calls onRemoveTag when tag remove button is clicked", () => {
		render(<TagInput {...defaultProps} tags={["Tag1", "Tag2"]} />);
		const removeButtons = screen.getAllByText("×");
		fireEvent.click(removeButtons[0]);
		expect(defaultProps.onRemoveTag).toHaveBeenCalledWith("Tag1");
	});

	it("calls onAddTag on blur when there is a value", () => {
		render(<TagInput {...defaultProps} inputValue="pending tag" />);
		const input = screen.getByRole("combobox");
		fireEvent.blur(input);
		expect(defaultProps.onAddTag).toHaveBeenCalledWith("pending tag");
	});

	it("shows placeholder when no tags", () => {
		render(<TagInput {...defaultProps} placeholder="Enter tags" />);
		expect(screen.getByPlaceholderText("Enter tags")).toBeInTheDocument();
	});

	it("shows addPlaceholder when tags exist", () => {
		render(<TagInput {...defaultProps} tags={["Tag1"]} placeholder="Enter tags" addPlaceholder="Add more" />);
		expect(screen.getByPlaceholderText("Add more")).toBeInTheDocument();
	});

	it("applies maxLength attribute", () => {
		render(<TagInput {...defaultProps} maxLength={50} />);
		const input = screen.getByRole("combobox");
		expect(input).toHaveAttribute("maxLength", "50");
	});

	it("shows error message when provided", () => {
		render(<TagInput {...defaultProps} error="This field is required" />);
		expect(screen.getByText("This field is required")).toBeInTheDocument();
	});

	it("renders datalist for suggestions", () => {
		const { container } = render(
			<TagInput {...defaultProps} suggestions={["Option1", "Option2"]} datalistId="test-datalist" />
		);
		const datalist = container.querySelector("#test-datalist");
		expect(datalist).toBeInTheDocument();
		expect(datalist?.querySelectorAll("option").length).toBe(2);
	});

	it("excludes already selected tags from suggestions", () => {
		const { container } = render(
			<TagInput
				{...defaultProps}
				tags={["Option1"]}
				suggestions={["Option1", "Option2", "Option3"]}
				datalistId="test-datalist"
			/>
		);
		const datalist = container.querySelector("#test-datalist");
		expect(datalist?.querySelectorAll("option").length).toBe(2);
	});
});
