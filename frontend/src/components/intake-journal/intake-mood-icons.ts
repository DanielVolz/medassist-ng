import { Angry, Frown, Laugh, type LucideIcon, Meh, Smile } from "lucide-react";
import type { IntakeMood } from "../../utils/intake-mood";

export const INTAKE_MOOD_ICONS: Record<IntakeMood, LucideIcon> = {
	very_bad: Angry,
	bad: Frown,
	neutral: Meh,
	good: Smile,
	very_good: Laugh,
};
