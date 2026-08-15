import { Alert, Stack, Text } from "@mantine/core";
import { normalizeIntakeMood } from "@medassist/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AsNeededIntakeRequestError, useAsNeededIntakes } from "../hooks/useAsNeededIntakes";
import { useIntakeJournal } from "../hooks/useIntakeJournal";
import { useModalHistory } from "../hooks/useModalHistory";
import type { AsNeededIntakeEvent, AsNeededIntakeMutationResponse } from "../types";
import { AppButton } from "../ui/primitives/AppButton";
import { StatusBadge } from "../ui/primitives/StatusBadge";
import { getNumericLocale, withFormattingTimezone } from "../utils/formatters";
import { getIntakeMoodLabel } from "../utils/intake-mood";
import classes from "./AsNeededIntakeHistory.module.css";
import { ConfirmModal } from "./ConfirmModal";
import { IntakeJournalModal } from "./intake-journal/IntakeJournalModal";

type AsNeededIntakeHistoryProps = {
	medicationId: number;
	canRecordNow: boolean;
	onRecordNow: () => void;
	onReplace?: (event: AsNeededIntakeEvent) => void;
	onReverse?: (input: {
		eventId: string;
		expectedRevision: number;
		idempotencyKey: string;
	}) => Promise<AsNeededIntakeMutationResponse>;
};

type ReversalIntent = {
	event: AsNeededIntakeEvent;
	idempotencyKey: string;
	replaceAfter: boolean;
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

function getReversalErrorKey(code: string): string {
	if (code === "NETWORK_ERROR") return "asNeeded.reversal.errors.network";
	if (code === "EVENT_VERSION_CONFLICT") return "asNeeded.reversal.errors.revision";
	if (code === "IDEMPOTENCY_KEY_REUSED") return "asNeeded.reversal.errors.intentConflict";
	if (code === "READ_ONLY" || code === "API_KEY_SCOPE_FORBIDDEN") return "asNeeded.errors.readOnly";
	return "asNeeded.reversal.errors.generic";
}

function getJournalActionKey(event: AsNeededIntakeEvent): string {
	if (event.status === "reversed") return "journal.actions.view";
	if (event.journal) return "journal.actions.edit";
	return "journal.actions.add";
}

export function AsNeededIntakeHistory({
	medicationId,
	canRecordNow,
	onRecordNow,
	onReplace,
	onReverse,
}: AsNeededIntakeHistoryProps) {
	const { t } = useTranslation();
	const { listAsNeededIntakes } = useAsNeededIntakes();
	const [events, setEvents] = useState<AsNeededIntakeEvent[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState(false);
	const [reversalIntent, setReversalIntent] = useState<ReversalIntent | null>(null);
	const [reversalPending, setReversalPending] = useState(false);
	const [reversalError, setReversalError] = useState<string | null>(null);
	const [actionNotice, setActionNotice] = useState<{ tone: "green" | "yellow" | "red"; key: string } | null>(null);
	const [replacementReady, setReplacementReady] = useState<AsNeededIntakeEvent | null>(null);
	const [journalTargetStatus, setJournalTargetStatus] = useState<AsNeededIntakeEvent["status"] | null>(null);
	const requestVersionRef = useRef(0);
	const firstPageAbortRef = useRef<AbortController | null>(null);
	const actionFeedbackRef = useRef<HTMLDivElement>(null);
	const refreshHistoryRef = useRef<() => Promise<void>>(async () => undefined);
	const handleJournalEventReversed = useCallback(() => {
		setActionNotice({ tone: "yellow", key: "journalReconciled" });
		void refreshHistoryRef.current();
	}, []);
	const intakeJournal = useIntakeJournal({
		manageProgrammaticClose: true,
		onEventReversed: handleJournalEventReversed,
	});
	const dismissReversal = useCallback(() => {
		setReversalIntent(null);
		setReversalError(null);
	}, []);
	const { closeModal: closeReversal } = useModalHistory(
		Boolean(reversalIntent),
		"as-needed-reversal-confirm",
		dismissReversal,
		{ state: reversalIntent ? { eventId: reversalIntent.event.eventId } : undefined }
	);

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
			if (requestVersion === requestVersionRef.current) setError(true);
		} finally {
			if (requestVersion === requestVersionRef.current) setLoading(false);
		}
	}, [listAsNeededIntakes, medicationId]);
	refreshHistoryRef.current = loadFirstPage;

	useEffect(() => {
		void loadFirstPage();
		return () => {
			firstPageAbortRef.current?.abort();
			requestVersionRef.current += 1;
		};
	}, [loadFirstPage]);

	useEffect(() => {
		if (actionNotice || reversalError) actionFeedbackRef.current?.focus();
	}, [actionNotice, reversalError]);

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

	const beginReversal = (event: AsNeededIntakeEvent, replaceAfter: boolean) => {
		setReversalIntent({ event, idempotencyKey: crypto.randomUUID(), replaceAfter });
		setReversalError(null);
		setActionNotice(null);
		setReplacementReady(null);
	};

	const submitReversal = async () => {
		if (!reversalIntent || !onReverse || reversalPending) return;
		setReversalPending(true);
		setReversalError(null);
		try {
			const result = await onReverse({
				eventId: reversalIntent.event.eventId,
				expectedRevision: reversalIntent.event.revision,
				idempotencyKey: reversalIntent.idempotencyKey,
			});
			setEvents((current) => current.map((event) => (event.eventId === result.event.eventId ? result.event : event)));
			if (reversalIntent.replaceAfter) {
				setReplacementReady(result.event);
				setActionNotice({
					tone: result.inventory.reconciliationRequired ? "yellow" : "green",
					key: result.inventory.reconciliationRequired ? "correctionReadyReconciliation" : "correctionReady",
				});
			} else {
				setActionNotice({
					tone: result.inventory.reconciliationRequired ? "yellow" : "green",
					key: result.inventory.reconciliationRequired ? "reconciliation" : "reversed",
				});
			}
			closeReversal();
		} catch (requestError) {
			if (requestError instanceof AsNeededIntakeRequestError) {
				if (requestError.code === "EVENT_VERSION_CONFLICT") {
					closeReversal();
					setActionNotice({ tone: "red", key: "revisionChanged" });
					await loadFirstPage();
				} else {
					setReversalError(getReversalErrorKey(requestError.code));
				}
			} else {
				setReversalError("asNeeded.reversal.errors.generic");
			}
		} finally {
			setReversalPending(false);
		}
	};

	const openJournal = (event: AsNeededIntakeEvent) => {
		setJournalTargetStatus(event.status);
		void intakeJournal.openJournalEditor(event.journal?.doseId ?? `as-needed:${event.eventId}`);
	};

	const closeJournal = () => {
		setJournalTargetStatus(null);
		intakeJournal.closeJournalEditor();
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
		closeJournal();
	};

	if (!canRecordNow && !loading && !error && events.length === 0) return null;
	const lifecycle = events[0]?.medication.lifecycle ?? (canRecordNow ? "active_no_schedule" : null);
	let reversalConfirmLabel = t("asNeeded.reversal.confirm");
	if (reversalPending) reversalConfirmLabel = t("asNeeded.reversal.saving");
	else if (reversalError) reversalConfirmLabel = t("common.retry");
	const replacedEventIds = new Set(
		events.map((event) => event.replacementForEventId).filter((eventId): eventId is string => eventId !== null)
	);

	return (
		<section className={classes.section} aria-labelledby="as-needed-history-title">
			<div className={classes.headingRow}>
				<div className={classes.headingBlock}>
					<h3 id="as-needed-history-title">{t("asNeeded.history.title")}</h3>
					{lifecycle ? <StatusBadge tone="info">{t(`asNeeded.lifecycle.${lifecycle}`)}</StatusBadge> : null}
				</div>
				{canRecordNow ? (
					<AppButton type="button" tone="primary" size="xs" onClick={onRecordNow}>
						{t("asNeeded.record.action")}
					</AppButton>
				) : null}
			</div>
			<p className={classes.description}>{t("asNeeded.history.description")}</p>

			{loading ? <p className={classes.state}>{t("asNeeded.history.loading")}</p> : null}
			{error ? (
				<Alert color="red" title={t("asNeeded.history.errorTitle")}>
					{t("asNeeded.history.errorMessage")}
					<AppButton type="button" tone="secondary" size="xs" onClick={() => void loadFirstPage()}>
						{t("asNeeded.history.retry")}
					</AppButton>
				</Alert>
			) : null}
			{actionNotice ? (
				<Alert
					ref={actionFeedbackRef}
					tabIndex={-1}
					color={actionNotice.tone}
					title={t(`asNeeded.reversal.notice.${actionNotice.key}Title`)}
				>
					{t(`asNeeded.reversal.notice.${actionNotice.key}Message`)}
					{replacementReady && onReplace ? (
						<AppButton
							type="button"
							tone="primary"
							size="xs"
							onClick={() => {
								onReplace(replacementReady);
								setReplacementReady(null);
								setActionNotice(null);
							}}
						>
							{t("asNeeded.replacement.action")}
						</AppButton>
					) : null}
				</Alert>
			) : null}
			{!loading && events.length === 0 ? <p className={classes.state}>{t("asNeeded.history.empty")}</p> : null}

			<div className={classes.list}>
				{events.map((event) => {
					const mood = normalizeIntakeMood(event.journal?.mood);
					const canOpenJournal = event.status === "active" || event.journal !== null;
					return (
						<article className={classes.entry} key={event.eventId}>
							<div className={classes.entryHeading}>
								<strong>
									{formatQuantity(event.quantity)}{" "}
									{t(`asNeeded.units.${event.quantityUnit}`, { count: event.quantity })}
								</strong>
								<StatusBadge tone={event.status === "active" ? "success" : "danger"}>
									{t(`asNeeded.history.status.${event.status}`)}
								</StatusBadge>
							</div>
							<time dateTime={event.occurredAt}>{formatTrustedDateTime(event.occurredAt)}</time>
							<dl className={classes.meta}>
								<div>
									<dt>{t("asNeeded.history.person")}</dt>
									<dd>{event.person ?? t("asNeeded.record.noPerson")}</dd>
								</div>
								<div>
									<dt>{t("asNeeded.history.stockEffect")}</dt>
									<dd>
										{event.stockEffect > 0 ? "−" : ""}
										{formatQuantity(event.stockEffect)}{" "}
										{t(`asNeeded.units.${event.quantityUnit}`, { count: event.stockEffect })}
										<span>{t(`asNeeded.history.stockReason.${event.stockEffectReason}`)}</span>
									</dd>
								</div>
							</dl>
							{event.reversedAt ? (
								<p>{t("asNeeded.history.reversedAt", { time: formatTrustedDateTime(event.reversedAt) })}</p>
							) : null}
							{event.replacementForEventId ? (
								<p>{t("asNeeded.history.replacementFor", { eventId: event.replacementForEventId })}</p>
							) : null}
							<div className={classes.journal}>
								<div className={classes.journalHeading}>
									<strong>{t("asNeeded.history.journal")}</strong>
									{canOpenJournal ? (
										<AppButton type="button" tone="ghost" size="xs" onClick={() => openJournal(event)}>
											{t(getJournalActionKey(event))}
										</AppButton>
									) : null}
								</div>
								{event.journal ? (
									<p>
										{[mood ? getIntakeMoodLabel(mood, t) : null, event.journal.note].filter(Boolean).join(" · ") ||
											t("journal.history.noNote")}
									</p>
								) : (
									<p>{t("asNeeded.history.noJournal")}</p>
								)}
							</div>
							{event.status === "active" && onReverse ? (
								<div className={classes.entryActions}>
									<AppButton type="button" tone="danger" size="xs" onClick={() => beginReversal(event, false)}>
										{t("asNeeded.reversal.action")}
									</AppButton>
									{event.medication.recordEligibility.eligible && onReplace ? (
										<AppButton type="button" tone="secondary" size="xs" onClick={() => beginReversal(event, true)}>
											{t("asNeeded.replacement.correctAction")}
										</AppButton>
									) : null}
								</div>
							) : null}
							{event.status === "reversed" &&
							!replacedEventIds.has(event.eventId) &&
							replacementReady?.eventId !== event.eventId &&
							event.medication.recordEligibility.eligible &&
							onReplace ? (
								<div className={classes.entryActions}>
									<AppButton type="button" tone="secondary" size="xs" onClick={() => onReplace(event)}>
										{t("asNeeded.replacement.action")}
									</AppButton>
								</div>
							) : null}
						</article>
					);
				})}
			</div>
			{nextCursor ? (
				<AppButton type="button" tone="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
					{loadingMore ? t("asNeeded.history.loadingMore") : t("asNeeded.history.loadMore")}
				</AppButton>
			) : null}
			{reversalIntent ? (
				<ConfirmModal
					title={t(
						reversalIntent.replaceAfter ? "asNeeded.replacement.reverseTitle" : "asNeeded.reversal.confirmTitle"
					)}
					message={
						<Stack gap="sm">
							<Text>
								{t(
									reversalIntent.replaceAfter
										? "asNeeded.replacement.reverseMessage"
										: "asNeeded.reversal.confirmMessage",
									{
										quantity: formatQuantity(reversalIntent.event.quantity),
										unit: t(`asNeeded.units.${reversalIntent.event.quantityUnit}`, {
											count: reversalIntent.event.quantity,
										}),
									}
								)}
							</Text>
							{reversalError ? (
								<Alert ref={actionFeedbackRef} tabIndex={-1} color="red">
									{t(reversalError)}
								</Alert>
							) : null}
						</Stack>
					}
					confirmLabel={reversalConfirmLabel}
					cancelLabel={t("common.cancel")}
					onConfirm={() => void submitReversal()}
					onCancel={() => {
						if (!reversalPending) closeReversal();
					}}
					isLoading={reversalPending}
					confirmVariant="danger"
					overlayClassName="nested-confirm"
					captureEscape
				/>
			) : null}
			<IntakeJournalModal
				isOpen={intakeJournal.journalEditorOpen}
				entry={intakeJournal.journalEvent}
				isLoading={intakeJournal.journalEventLoading}
				isSaving={intakeJournal.journalEventSaving}
				isDeleting={intakeJournal.journalEventDeleting}
				error={intakeJournal.journalEventError}
				onClose={closeJournal}
				onSave={saveJournal}
				onDelete={deleteJournal}
				readOnly={
					journalTargetStatus === "reversed" ||
					(intakeJournal.journalEvent?.eventType === "as_needed" && intakeJournal.journalEvent.status === "reversed")
				}
			/>
		</section>
	);
}
