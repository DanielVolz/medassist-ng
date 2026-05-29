import { type InputHTMLAttributes, useCallback, useRef } from "react";

interface LocalizedDateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
	value: string;
	displayValue: string;
	inputType: "date" | "datetime-local";
}

export function LocalizedDateInput({
	value,
	displayValue,
	inputType,
	placeholder,
	className,
	...rest
}: LocalizedDateInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	const handleClick = useCallback(() => {
		try {
			inputRef.current?.showPicker();
		} catch {
			inputRef.current?.focus();
		}
	}, []);

	return (
		<div
			className={`date-input-wrapper ${className ?? ""}`}
			onClick={handleClick}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") handleClick();
			}}
		>
			<span className="date-input-display" aria-hidden="true">
				{displayValue || placeholder || ""}
			</span>
			<input ref={inputRef} type={inputType} className="date-input-native" value={value} {...rest} />
		</div>
	);
}
