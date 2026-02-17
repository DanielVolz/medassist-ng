/**
 * DateInput - Custom date input that displays dates in the regional locale format.
 *
 * Overlays a formatted date string on top of a native <input type="date">,
 * so the browser calendar popup still works but the displayed text
 * uses our locale-aware formatting (e.g., 14.02.2026 for Germany).
 */
import { type InputHTMLAttributes, useCallback, useRef } from "react";
import { formatDate, getNumericLocale } from "../utils/formatters";

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DateInput({ value, placeholder, className, ...rest }: DateInputProps) {
	const locale = getNumericLocale();
	const displayValue = value ? formatDate(value, locale) : "";
	const inputRef = useRef<HTMLInputElement>(null);

	const handleClick = useCallback(() => {
		try {
			inputRef.current?.showPicker();
		} catch {
			// showPicker() may throw in some browsers — fallback to focus
			inputRef.current?.focus();
		}
	}, []);

	return (
		<div
			className={`date-input-wrapper ${className ?? ""}`}
			onClick={handleClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") handleClick();
			}}
		>
			<span className="date-input-display" aria-hidden="true">
				{displayValue || placeholder || ""}
			</span>
			<input ref={inputRef} type="date" className="date-input-native" value={value} {...rest} />
		</div>
	);
}
