import { Alert } from "@mantine/core";
import { normalizeIntakeMood } from "@medassist/shared";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsNeededIntakes } from "../hooks/useAsNeededIntakes";
import { useIntakeJournal } from "../hooks/useIntakeJournal";
import type { AsNeededIntakeEvent } from "../types";
import { AppButton } from "../ui/primitives/AppButton";
import { getNumericLocale, withFormattingTimezone } from "../utils/formatters";
import { getIntakeMoodLabel } from "../utils/intake-mood";
import classes from "./AsNeededIntakeHistory.module.css";
import { IntakeJournalModal } from "./intake-journal/IntakeJournalModal";

type AsNeededIntakeHistoryProps = {
	medicationId: number;
	canRecordNow: boolean;
	onTake: () => void;
	onUndo?: (eventId: string) => Promise<void>;
};

function formatQuantity(value: number): string {
	return value.toLocaleString(getNumericLocale(), { maximumFractionDigits: 3 });
}

function formatTrustedDateTime(value: string): string {
	return new Date(value).toLocaleString(
		getNumericLocale(),
		withFormattingTimezone({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
	);
}

export function AsNeededIntakeHistory({ medicationId, canRecordNow, onTake, onUndo }: AsNeededIntakeHistoryProps) {
	const { t } = useTranslation();
	const { listAsNeededIntakes } = useAsNeededIntakes();
	const [expanded, setExpanded] = useState(false);
	const [events, setEvents] = useState<AsNeededIntakeEvent[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState(false);
	const [undoPendingIds, setUndoPendingIds] = useState<Set<string>>(() => new Set());
	const [undoErrorIds, setUndoErrorIds] = useState<Set<string>>(() => new Set());
	const requestedRef = useRef(false);
	const requestVersionRef = useRef(0);
	const firstPageAbortRef = useRef<AbortController | null>(null);
	const intakeJournal = useIntakeJournal({ manageProgrammaticClose: true });

	const loadFirstPage = useCallback(async () => {
		firstPageAbortRef.current?.abort();
		const controller = new AbortController();
		firstPageAbortRef.current = controller;
		const requestVersion = ++requestVersionRef.current;
		setLoading(true);
		setLoadingMore(false);
		setError(false);
		try {
			const result = await listAsNeededIntakes(medicationId, undefined, controller.signal);
			if (requestVersion !== requestVersionRef.current) return;
			setEvents(result.events);
			setNextCursor(result.nextCursor);
		} catch {
			if (!controller.signal.aborted && requestVersion === requestVersionRef.current) setError(true);
		} finally {
			if (requestVersion === requestVersionRef.current) setLoading(false);
		}
	}, [listAsNeededIntakes, medicationId]);

	useEffect(() => {
		if (!expanded || requestedRef.current) return;
		requestedRef.current = true;
		void loadFirstPage();
	}, [expanded, loadFirstPage]);

	useEffect(
		() => () => {
			firstPageAbortRef.current?.abort();
			requestVersionRef.current += 1;
		},
		[]
	);

	const loadMore = async () => {
		if (!nextCursor || loadingMore) return;
		const requestVersion = requestVersionRef.current;
		setLoadingMore(true);
		setError(false);
		try {
			const result = await listAsNeededIntakes(medicationId, nextCursor);
			if (requestVersion !== requestVersionRef.current) return;
			setEvents((current) => {
				const knownIds = new Set(current.map((event) => event.eventId));
				return [...current, ...result.events.filter((event) => !knownIds.has(event.eventId))];
			});
			setNextCursor(result.nextCursor);
		} catch {
			if (requestVersion === requestVersionRef.current) setError(true);
		} finally {
			if (requestVersion === requestVersionRef.current) setLoadingMore(false);
		}
	};

	const undo = async (eventId: string) => {
		if (!onUndo || undoPendingIds.has(eventId)) return;
		setUndoPendingIds((current) => new Set(current).add(eventId));
		setUndoErrorIds((current) => {
			const next = new Set(current);
			next.delete(eventId);
			return next;
		});
		try {
			await onUndo(eventId);
			setEvents((current) => current.filter((event) => event.eventId !== eventId));
		} catch {
			setUndoErrorIds((current) => new Set(current).add(eventId));
		} finally {
			setUndoPendingIds((current) => {
				const next = new Set(current);
				next.delete(eventId);
				return next;
			});
		}
	};

	const openJournal = (event: AsNeededIntakeEvent) => {
		void intakeJournal.openJournalEditor(event.journal?.doseId ?? `as-needed:${event.eventId}`);
	};

	const saveJournal = async (
		note: string,
		mood: Parameters<typeof intakeJournal.saveJournalNote>[1]
	): Promise<boolean> => {
		const saved = await intakeJournal.saveJournalNote(note, mood);
		if (saved) await loadFirstPage();
		return saved;
	};

	const deleteJournal = async () => {
		const deleted = await intakeJournal.deleteJournalNote();
		if (!deleted) return;
		await loadFirstPage();
		intakeJournal.closeJournalEditor();
	};

	return (
		<section className={classes.section} aria-labelledby="as-needed-history-title">
			<div className={classes.headingRow}>
				<AppButton
					type="button"
					tone="ghost"
					size="compact-sm"
					className={classes.disclosure}
					aria-controls="as-needed-history-content"
					aria-expanded={expanded}
					rightSection={<ChevronDown aria-hidden="true" className={classes.chevron} size={16} />}
					onClick={() => setExpanded((current) => !current)}
				>
					<span id="as-needed-history-title">{t("asNeeded.history.title")}</span>
				</AppButton>
				{canRecordNow ? (
					<AppButton type="button" tone="primary" size="xs" onClick={onTake}>
						{t("dose.take")}
					</AppButton>
				) : null}
			</div>

			<div id="as-needed-history-content" className={classes.content} hidden={!expanded}>
				{expanded ? (
					<>
						{loading ? <p className={classes.state}>{t("asNeeded.history.loading")}</p> : null}
						{error ? (
							<Alert color="red" title={t("asNeeded.history.errorTitle")}>
								{t("asNeeded.history.errorMessage")}
								<AppButton type="button" tone="secondary" size="xs" onClick={() => void loadFirstPage()}>
									{t("asNeeded.history.retry")}
								</AppButton>
							</Alert>
						) : null}
						{!loading && !error && events.length === 0 ? (
							<p className={classes.state}>{t("asNeeded.history.empty")}</p>
						) : null}

						<div className={classes.list}>
							{events.map((event) => {
								const mood = normalizeIntakeMood(event.journal?.mood);
								const undoPending = undoPendingIds.has(event.eventId);
								return (
									<article className={classes.entry} key={event.eventId}>
										<div className={classes.entryHeading}>
											<strong>
												{formatQuantity(event.quantity)}{" "}
												{t(`asNeeded.units.${event.quantityUnit}`, { count: event.quantity })}
											</strong>
											<time dateTime={event.occurredAt}>{formatTrustedDateTime(event.occurredAt)}</time>
										</div>
										{event.person ? (
											<p className={classes.person}>
												{t("asNeeded.history.person")}: {event.person}
											</p>
										) : null}
										<div className={classes.journal}>
											<p>
												{event.journal
													? [mood ? getIntakeMoodLabel(mood, t) : null, event.journal.note]
															.filter(Boolean)
															.join(" · ") || t("journal.history.noNote")
													: t("asNeeded.history.noJournal")}
											</p>
											<AppButton type="button" tone="ghost" size="xs" onClick={() => openJournal(event)}>
												{t(event.journal ? "journal.actions.edit" : "journal.actions.add")}
											</AppButton>
										</div>
										<div className={classes.undoRow}>
											{undoErrorIds.has(event.eventId) ? (
												<p role="alert" className={classes.undoError}>
													{t("asNeeded.undo.error")}
												</p>
											) : null}
											{onUndo ? (
												<AppButton
													type="button"
													tone="ghost"
													size="xs"
													loading={undoPending}
													onClick={() => void undo(event.eventId)}
												>
													{t("dose.undoAction")}
												</AppButton>
											) : null}
										</div>
									</article>
								);
							})}
						</div>
						{nextCursor ? (
							<AppButton type="button" tone="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
								{loadingMore ? t("asNeeded.history.loadingMore") : t("asNeeded.history.loadMore")}
							</AppButton>
						) : null}
					</>
				) : null}
			</div>

			<IntakeJournalModal
				isOpen={intakeJournal.journalEditorOpen}
				entry={intakeJournal.journalEvent}
				isLoading={intakeJournal.journalEventLoading}
				isSaving={intakeJournal.journalEventSaving}
				isDeleting={intakeJournal.journalEventDeleting}
				error={intakeJournal.journalEventError}
				onClose={intakeJournal.closeJournalEditor}
				onSave={saveJournal}
				onDelete={deleteJournal}
				readOnly={false}
			/>
		</section>
	);
}
