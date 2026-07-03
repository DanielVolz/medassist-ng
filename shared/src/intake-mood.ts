export const INTAKE_MOODS = ["very_bad", "bad", "neutral", "good", "very_good"] as const;

export type IntakeMood = (typeof INTAKE_MOODS)[number];

const INTAKE_MOOD_SET = new Set<string>(INTAKE_MOODS);

export function isIntakeMood(value: unknown): value is IntakeMood {
	return typeof value === "string" && INTAKE_MOOD_SET.has(value);
}

export function normalizeIntakeMood(value: unknown): IntakeMood | null {
	return isIntakeMood(value) ? value : null;
}
