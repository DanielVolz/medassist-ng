/**
 * DateTimeInput - Custom datetime input that displays date+time in the regional locale format.
 *
 * Overlays a formatted datetime string on top of a native <input type="datetime-local">,
 * so the browser datetime popup still works but the displayed text
 * uses our locale-aware formatting (e.g., 14.02.2026, 20:30 for Germany).
 */
import type { InputHTMLAttributes } from "react";
import { formatDateTime, getNumericLocale } from "../utils/formatters";
import { LocalizedDateInput } from "./LocalizedDateInput";

interface DateTimeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DateTimeInput({ value, placeholder, className, ...rest }: DateTimeInputProps) {
	const locale = getNumericLocale();
	const displayValue = value ? formatDateTime(value, locale) : "";

	return (
		<LocalizedDateInput
			inputType="datetime-local"
			value={value}
			displayValue={displayValue}
			placeholder={placeholder}
			className={className}
			{...rest}
		/>
	);
}
