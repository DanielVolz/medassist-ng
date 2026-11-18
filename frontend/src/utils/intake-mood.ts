import { INTAKE_MOODS, type IntakeMood } from "@medassist/shared";
import type { TranslationFunction } from "../i18n/types";

export type { IntakeMood };
export { INTAKE_MOODS };

const INTAKE_MOOD_EMOJI: Record<IntakeMood, string> = {
	very_bad: "😣",
	bad: "🙁",
	neutral: "😐",
	good: "🙂",
	very_good: "😄",
};

export function getIntakeMoodLabel(mood: IntakeMood, t: TranslationFunction): string {
	return t(`journal.mood.values.${mood}`);
}

export function getIntakeMoodDisplay(mood: IntakeMood, t: TranslationFunction): string {
	return `${INTAKE_MOOD_EMOJI[mood]} ${getIntakeMoodLabel(mood, t)}`;
}
