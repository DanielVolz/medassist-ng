/**
 * DateTimeInput - Custom datetime input that displays date+time in the regional locale format.
 *
 * Overlays a formatted datetime string on top of a native <input type="datetime-local">,
 * so the browser datetime popup still works but the displayed text
 * uses our locale-aware formatting (e.g., 14.02.2026, 20:30 for Germany).
 */
import { type InputHTMLAttributes, useCallback, useRef } from "react";
import { formatDateTime, getNumericLocale } from "../utils/formatters";

interface DateTimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DateTimeInput({ value, placeholder, className, ...rest }: DateTimeInputProps) {
	const locale = getNumericLocale();
	// datetime-local value is "YYYY-MM-DDTHH:MM" — formatDateTime handles this format
	const displayValue = value ? formatDateTime(value, locale) : "";
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
		<div className={`date-input-wrapper ${className ?? ""}`} onClick={handleClick}>
			<span className="date-input-display" aria-hidden="true">
				{displayValue || placeholder || ""}
			</span>
			<input ref={inputRef} type="datetime-local" className="date-input-native" value={value} {...rest} />
		</div>
	);
}
