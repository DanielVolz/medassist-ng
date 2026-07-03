import { INTAKE_MOODS, type IntakeMood } from "@medassist/shared";

export type { IntakeMood };
export { INTAKE_MOODS };

export const INTAKE_MOOD_EMOJI: Record<IntakeMood, string> = {
	very_bad: "😣",
	bad: "🙁",
	neutral: "😐",
	good: "🙂",
	very_good: "😄",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function getIntakeMoodLabel(mood: IntakeMood, t: Translate): string {
	return t(`journal.mood.values.${mood}`);
}

export function getIntakeMoodDisplay(mood: IntakeMood, t: Translate): string {
	return `${INTAKE_MOOD_EMOJI[mood]} ${getIntakeMoodLabel(mood, t)}`;
}
