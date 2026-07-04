/**
 * DateInput - Custom date input that displays dates in the regional locale format.
 *
 * Overlays a formatted date string on top of a native <input type="date">,
 * so the browser calendar popup still works but the displayed text
 * uses our locale-aware formatting (e.g., 14.02.2026 for Germany).
 */
import { MonthPickerInput } from "@mantine/dates";
import { Calendar } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { formatDate, formatMonth, getNumericLocale, toMonthValue } from "../utils/formatters";
import classes from "./DateInput.module.css";
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

export function MonthInput({ value, onChange, placeholder, className, disabled, id, name, required }: DateInputProps) {
	const locale = getNumericLocale();
	const monthValue = toMonthValue(value);

	const handleChange = (nextValue: string | null) => {
		const nextMonthValue = toMonthValue(nextValue);
		onChange({
			currentTarget: { value: nextMonthValue },
			target: { value: nextMonthValue },
		} as React.ChangeEvent<HTMLInputElement>);
	};

	return (
		<MonthPickerInput
			id={id}
			name={name}
			required={required}
			disabled={disabled}
			value={monthValue || null}
			onChange={handleChange}
			placeholder={placeholder}
			locale={locale}
			valueFormat="MM/YYYY"
			valueFormatter={({ date }) => (date ? formatMonth(toMonthValue(date as string | Date), locale) : "")}
			rightSection={<Calendar size={18} aria-hidden="true" />}
			rightSectionPointerEvents="none"
			popoverProps={{ withinPortal: true, zIndex: 2600 }}
			className={["month-picker-wrapper", classes.monthPickerRoot, className].filter(Boolean).join(" ")}
			classNames={{
				input: ["month-picker-input", classes.monthPickerInput].join(" "),
				section: classes.monthPickerSection,
			}}
		/>
	);
}
