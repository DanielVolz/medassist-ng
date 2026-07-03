import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";
import { formatDateTime, getNumericLocale, withFormattingTimezone } from "../../utils/formatters";

type Translate = (key: string) => string;

const EXPLICIT_TIMEZONE_SUFFIX = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function hasExplicitTimezone(value: string): boolean {
	return EXPLICIT_TIMEZONE_SUFFIX.test(value.trim());
}

function formatAbsoluteJournalDateTime(value: string, locale: string): string | null {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	const dateLabel = date.toLocaleDateString(
		locale,
		withFormattingTimezone({
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		})
	);
	const timeLabel = date.toLocaleTimeString(
		locale,
		withFormattingTimezone({
			hour: "2-digit",
			minute: "2-digit",
		})
	);

	return `${dateLabel} ${timeLabel}`;
}

export function formatJournalDisplayDateTime(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const trimmed = value.trim();
	const locale = getNumericLocale();

	if (hasExplicitTimezone(trimmed)) {
		return formatAbsoluteJournalDateTime(trimmed, locale) ?? formatDateTime(trimmed, locale);
	}

	return formatDateTime(trimmed, locale);
}

export function getJournalSourceLabel(entry: IntakeJournalEntry, t: Translate): string {
	if (entry.takenSource === "automatic") {
		return t("journal.context.sourceAutomaticReminder");
	}

	return entry.markedBy ? t("journal.context.sourceSharedLink") : t("journal.context.sourceOwnerApp");
}
