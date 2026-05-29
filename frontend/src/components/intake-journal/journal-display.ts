import type { IntakeJournalEntry } from "../../hooks/useIntakeJournal";
import { formatDateTime, getNumericLocale } from "../../utils/formatters";

type Translate = (key: string) => string;

export function formatJournalDisplayDateTime(value: string | null): string | null {
	if (!value) {
		return null;
	}

	return formatDateTime(value, getNumericLocale());
}

export function getJournalSourceLabel(entry: IntakeJournalEntry, t: Translate): string {
	if (entry.takenSource === "automatic") {
		return t("journal.context.sourceAutomaticReminder");
	}

	return entry.markedBy ? t("journal.context.sourceSharedLink") : t("journal.context.sourceOwnerApp");
}
