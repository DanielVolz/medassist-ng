import { forEachScheduledOccurrenceInRange, type Intake, parseIntakesJson } from "../utils/scheduler-utils.js";

export { normalizeDateTime } from "../utils/date-time.js";

function isIntakeUnit(value: unknown): value is "ml" | "tsp" | "tbsp" {
	return value === "ml" || value === "tsp" || value === "tbsp";
}

export function parseRawIntakeUnits(intakesJson: string | null | undefined): Array<"ml" | "tsp" | "tbsp" | null> {
	if (!intakesJson) return [];
	try {
		const parsed = JSON.parse(intakesJson);
		if (!Array.isArray(parsed)) return [];
		return parsed.map((item: unknown) => {
			if (!item || typeof item !== "object") return null;
			const unit = (item as Record<string, unknown>).intakeUnit;
			return isIntakeUnit(unit) ? unit : null;
		});
	} catch {
		return [];
	}
}

export function parseIntakesWithUnits(
	intakesJson: string | null | undefined,
	legacyRow: { usageJson: string; everyJson: string; startJson: string },
	medicationIntakeRemindersEnabled?: boolean
): Intake[] {
	const intakes = parseIntakesJson(intakesJson, legacyRow, medicationIntakeRemindersEnabled);
	const rawUnits = parseRawIntakeUnits(intakesJson);
	if (rawUnits.length === 0) return intakes;

	return intakes.map((intake, idx) => ({
		...intake,
		intakeUnit: rawUnits[idx] ?? intake.intakeUnit ?? null,
	}));
}

export function calculateUsageInRange(
	blisters: Array<
		Pick<Intake, "usage" | "every" | "start" | "scheduleMode" | "weekdays"> & { peopleMultiplier?: number }
	>,
	start: Date,
	end: Date
): number {
	if (end.getTime() <= start.getTime()) {
		return 0;
	}

	let total = 0;
	blisters.forEach((blister) => {
		forEachScheduledOccurrenceInRange(blister, start.getTime(), end.getTime() - 1, () => {
			total += blister.usage * (blister.peopleMultiplier ?? 1);
		});
	});
	return Number(total.toFixed(2));
}
