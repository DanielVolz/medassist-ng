import { Alert } from "@mantine/core";
import { normalizeIntakeMood } from "@medassist/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsNeededIntakes } from "../hooks/useAsNeededIntakes";
import type { AsNeededIntakeEvent } from "../types";
import { AppButton } from "../ui/primitives/AppButton";
import { StatusBadge } from "../ui/primitives/StatusBadge";
import { getNumericLocale, withFormattingTimezone } from "../utils/formatters";
import { getIntakeMoodLabel } from "../utils/intake-mood";
import classes from "./AsNeededIntakeHistory.module.css";

type AsNeededIntakeHistoryProps = {
	medicationId: number;
	canRecordNow: boolean;
	onRecordNow: () => void;
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

export function AsNeededIntakeHistory({ medicationId, canRecordNow, onRecordNow }: AsNeededIntakeHistoryProps) {
	const { t } = useTranslation();
	const { listAsNeededIntakes } = useAsNeededIntakes();
	const [events, setEvents] = useState<AsNeededIntakeEvent[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState(false);
	const requestVersionRef = useRef(0);
	const firstPageAbortRef = useRef<AbortController | null>(null);

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

	useEffect(() => {
		void loadFirstPage();
		return () => {
			firstPageAbortRef.current?.abort();
			requestVersionRef.current += 1;
		};
	}, [loadFirstPage]);

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

	if (!canRecordNow && !loading && !error && events.length === 0) return null;
	const lifecycle = events[0]?.medication.lifecycle ?? (canRecordNow ? "active_no_schedule" : null);

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
			{!loading && events.length === 0 ? <p className={classes.state}>{t("asNeeded.history.empty")}</p> : null}

			<div className={classes.list}>
				{events.map((event) => {
					const mood = normalizeIntakeMood(event.journal?.mood);
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
								<strong>{t("asNeeded.history.journal")}</strong>
								{event.journal ? (
									<p>
										{[mood ? getIntakeMoodLabel(mood, t) : null, event.journal.note].filter(Boolean).join(" · ") ||
											t("journal.history.noNote")}
									</p>
								) : (
									<p>{t("asNeeded.history.noJournal")}</p>
								)}
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
		</section>
	);
}
