/**
 * DateInput - Custom date input that displays dates in the regional locale format.
 *
 * Overlays a formatted date string on top of a native <input type="date">,
 * so the browser calendar popup still works but the displayed text
 * uses our locale-aware formatting (e.g., 14.02.2026 for Germany).
 */
import type { InputHTMLAttributes } from "react";
import { formatDate, getNumericLocale } from "../utils/formatters";
import { LocalizedDateInput } from "./LocalizedDateInput";

interface DateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function DateInput({ value, placeholder, className, ...rest }: DateInputProps) {
	const locale = getNumericLocale();
	const displayValue = value ? formatDate(value, locale) : "";

	return (
		<LocalizedDateInput
			inputType="date"
			value={value}
			displayValue={displayValue}
			placeholder={placeholder}
			className={className}
			{...rest}
		/>
	);
}
