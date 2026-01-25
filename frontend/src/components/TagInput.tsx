// =============================================================================
// TagInput Component - Reusable tag input with suggestions
// =============================================================================

import type { KeyboardEvent } from "react";

export interface TagInputProps {
	tags: string[];
	inputValue: string;
	onInputChange: (value: string) => void;
	onAddTag: (tag: string) => void;
	onRemoveTag: (tag: string) => void;
	suggestions?: string[];
	placeholder?: string;
	addPlaceholder?: string;
	maxLength?: number;
	error?: string;
	datalistId?: string;
}

export function TagInput({
	tags,
	inputValue,
	onInputChange,
	onAddTag,
	onRemoveTag,
	suggestions = [],
	placeholder = "",
	addPlaceholder = "",
	maxLength,
	error,
	datalistId = "tag-suggestions",
}: TagInputProps) {
	function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if ((e.key === "Enter" || e.key === ",") && inputValue.trim()) {
			e.preventDefault();
			onAddTag(inputValue);
		}
		if (e.key === "Backspace" && !inputValue && tags.length > 0) {
			onRemoveTag(tags[tags.length - 1]);
		}
	}

	return (
		<>
			<div className="tag-input-container">
				{tags.map((tag) => (
					<span key={tag} className="tag">
						{tag}
						<button type="button" className="tag-remove" onClick={() => onRemoveTag(tag)}>
							×
						</button>
					</span>
				))}
				<input
					value={inputValue}
					onChange={(e) => onInputChange(e.target.value)}
					onKeyDown={handleKeyDown}
					onBlur={() => {
						if (inputValue.trim()) onAddTag(inputValue);
					}}
					placeholder={tags.length === 0 ? placeholder : addPlaceholder}
					maxLength={maxLength}
					list={datalistId}
				/>
				{suggestions.length > 0 && (
					<datalist id={datalistId}>
						{suggestions
							.filter((s) => !tags.includes(s))
							.map((suggestion) => (
								<option key={suggestion} value={suggestion} />
							))}
					</datalist>
				)}
			</div>
			{error && <span className="field-error">{error}</span>}
		</>
	);
}
