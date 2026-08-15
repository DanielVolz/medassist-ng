import { Minus, Plus } from "lucide-react";
import classes from "./FormNumberStepper.module.css";

interface FormNumberStepperProps {
	inputId?: string;
	value: string;
	onChange: (nextValue: string) => void;
	min?: number;
	max?: number;
	step?: number;
	allowDecimal?: boolean;
	decrementLabel: string;
	incrementLabel: string;
	className?: string;
}

const DECIMAL_ROUNDING_FACTOR = 1000;

function clamp(value: number, min: number, max?: number): number {
	const clampedMin = Math.max(min, value);
	if (max == null) return clampedMin;
	return Math.min(max, clampedMin);
}

function normalizeDecimal(value: number): number {
	return Math.round(value * DECIMAL_ROUNDING_FACTOR) / DECIMAL_ROUNDING_FACTOR;
}

function toDisplayValue(value: number, allowDecimal: boolean): string {
	if (!allowDecimal) return String(Math.max(0, Math.trunc(value)));
	const normalized = normalizeDecimal(value);
	return normalized.toString();
}

function sanitizeRawInput(raw: string, allowDecimal: boolean): string {
	const normalizedRaw = raw.replace(",", ".");
	if (allowDecimal) {
		const cleaned = normalizedRaw.replace(/[^\d.]/g, "");
		const [integerPart = "", ...fractionalParts] = cleaned.split(".");
		if (fractionalParts.length === 0) return integerPart;
		return `${integerPart}.${fractionalParts.join("")}`;
	}
	return normalizedRaw.replace(/\D/g, "");
}

function parseInputValue(raw: string, allowDecimal: boolean): number | null {
	if (raw.trim() === "") return null;
	const parsed = allowDecimal ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
	if (Number.isNaN(parsed)) return null;
	return parsed;
}

export function FormNumberStepper({
	inputId,
	value,
	onChange,
	min = 0,
	max,
	step = 1,
	allowDecimal = false,
	decrementLabel,
	incrementLabel,
	className = "",
}: FormNumberStepperProps) {
	const parsed = parseInputValue(value, allowDecimal);
	const baseValue = parsed ?? min;
	const canDecrement = baseValue > min;
	const canIncrement = max == null || baseValue < max;

	const normalizedClassName = [classes.numberStepper, className].filter(Boolean).join(" ");

	const handleStep = (direction: -1 | 1) => {
		const nextRaw = clamp(baseValue + direction * step, min, max);
		onChange(toDisplayValue(nextRaw, allowDecimal));
	};

	const handleInputChange = (nextRaw: string) => {
		onChange(sanitizeRawInput(nextRaw, allowDecimal));
	};

	const handleBlur = () => {
		const nextParsed = parseInputValue(value, allowDecimal);
		if (nextParsed == null) return;
		const clamped = clamp(nextParsed, min, max);
		onChange(toDisplayValue(clamped, allowDecimal));
	};

	return (
		<div className={normalizedClassName}>
			{/* Input first in DOM so <label> associates with it, not the decrement button.
			    CSS order restores the visual layout: [−] [input] [+]. */}
			<input
				id={inputId}
				type="text"
				inputMode={allowDecimal ? "decimal" : "numeric"}
				pattern={allowDecimal ? "[0-9]*\\.?[0-9]*" : "[0-9]*"}
				value={value}
				onChange={(e) => handleInputChange(e.target.value)}
				onBlur={handleBlur}
			/>
			<button
				type="button"
				className={[classes.stepperButton, classes.decrement].join(" ")}
				onClick={() => handleStep(-1)}
				disabled={!canDecrement}
				aria-label={decrementLabel}
			>
				<Minus size={16} aria-hidden="true" />
			</button>
			<button
				type="button"
				className={[classes.stepperButton, classes.increment].join(" ")}
				onClick={() => handleStep(1)}
				disabled={!canIncrement}
				aria-label={incrementLabel}
			>
				<Plus size={16} aria-hidden="true" />
			</button>
		</div>
	);
}
