/* biome-ignore-all lint/a11y/noLabelWithoutControl: planner uses custom DateTimeInput control wrappers */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateTimeInput, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import type { PlannerRow } from "../types";
import { toInputValue } from "../utils/formatters";

// Date helpers
function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function plusDaysIso(days: number): string {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString().slice(0, 10);
}

// Convert datetime-local value to ISO string
function toIsoString(value: string): string {
	if (!value) return new Date().toISOString();
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

export function PlannerPage() {
	const { t } = useTranslation();
	const { user } = useAuth();
	const { meds, settings, openMedDetail } = useAppContext();

	// Local state for planner
	const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
	const [plannerLoading, setPlannerLoading] = useState(false);
	const [range, setRange] = useState<{ start: string; end: string }>({
		start: toInputValue(todayIso()),
		end: toInputValue(plusDaysIso(3)),
	});
	const [includeUntilStart, setIncludeUntilStart] = useState(false);
	const [sendingPlannerEmail, setSendingPlannerEmail] = useState(false);
	const [plannerEmailResult, setPlannerEmailResult] = useState<{ success: boolean; message: string } | null>(null);

	// Load user-specific planner data when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const savedRows = localStorage.getItem(userStorageKey(user.id, "plannerRows"));
			const savedRange = localStorage.getItem(userStorageKey(user.id, "plannerRange"));
			const savedIncludeUntilStart = localStorage.getItem(userStorageKey(user.id, "plannerIncludeUntilStart"));

			if (savedRows) {
				try {
					setPlannerRows(JSON.parse(savedRows));
				} catch {
					setPlannerRows([]);
				}
			} else {
				setPlannerRows([]);
			}

			if (savedRange) {
				try {
					setRange(JSON.parse(savedRange));
				} catch {
					/* keep default */
				}
			} else {
				setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
			}

			if (savedIncludeUntilStart) {
				setIncludeUntilStart(savedIncludeUntilStart === "true");
			} else {
				setIncludeUntilStart(false);
			}
		} else {
			setPlannerRows([]);
			setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
			setIncludeUntilStart(false);
		}
	}, [user?.id]);

	async function runPlanner(e: React.FormEvent) {
		e.preventDefault();
		setPlannerLoading(true);
		const body = { startDate: toIsoString(range.start), endDate: toIsoString(range.end), includeUntilStart };
		const rows = (await fetch("/api/medications/usage", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(body),
		})
			.then((res) => res.json())
			.catch(() => [])) as PlannerRow[];
		setPlannerRows(rows);
		setPlannerLoading(false);
		// Save to user-specific localStorage
		if (user?.id) {
			localStorage.setItem(userStorageKey(user.id, "plannerRange"), JSON.stringify(range));
			localStorage.setItem(userStorageKey(user.id, "plannerRows"), JSON.stringify(rows));
			localStorage.setItem(userStorageKey(user.id, "plannerIncludeUntilStart"), String(includeUntilStart));
		}
	}

	function resetRange() {
		setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		setIncludeUntilStart(false);
		setPlannerRows([]);
		if (user?.id) {
			localStorage.removeItem(userStorageKey(user.id, "plannerRange"));
			localStorage.removeItem(userStorageKey(user.id, "plannerRows"));
			localStorage.removeItem(userStorageKey(user.id, "plannerIncludeUntilStart"));
		}
	}

	const canSendNotification =
		(settings.emailEnabled && settings.notificationEmail) || (settings.shoutrrrEnabled && settings.shoutrrrUrl);

	async function sendPlannerNotification() {
		if (!canSendNotification || plannerRows.length === 0) return;
		setSendingPlannerEmail(true);
		setPlannerEmailResult(null);

		try {
			const res = await fetch("/api/planner/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					email: settings.notificationEmail,
					from: range.start,
					until: range.end,
					rows: plannerRows,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setPlannerEmailResult({ success: true, message: data.message || t("common.sent") });
			} else {
				setPlannerEmailResult({ success: false, message: data.error || t("common.sendFailed") });
			}
		} catch {
			setPlannerEmailResult({ success: false, message: t("common.networkError") });
		}
		setSendingPlannerEmail(false);
	}

	return (
		<section className="grid">
			<article className="card">
				<div className="card-head">
					<h2>{t("planner.title")}</h2>
				</div>
				<form className="planner" onSubmit={runPlanner}>
					<label>
						{t("planner.from")}
						<DateTimeInput
							step="60"
							value={range.start}
							onChange={(e) => setRange({ ...range, start: e.target.value })}
						/>
					</label>
					<label>
						{t("planner.until")}
						<DateTimeInput step="60" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
					</label>
					<div className="planner-checkbox-row">
						<label className="planner-checkbox">
							<input
								type="checkbox"
								checked={includeUntilStart}
								onChange={(e) => setIncludeUntilStart(e.target.checked)}
							/>
							{t("planner.includeUntilStart")}
						</label>
						<span className="info-tooltip small" data-tooltip={t("planner.includeUntilStartTooltip")}>
							ⓘ
						</span>
					</div>
					<div className="planner-actions">
						<button type="button" className="ghost" onClick={resetRange}>
							{t("common.reset")}
						</button>
						<button type="submit" disabled={plannerLoading}>
							{plannerLoading ? t("planner.calculating") : t("planner.calculate")}
						</button>
					</div>
				</form>
				{plannerRows.length > 0 && (
					<>
						<div className="table table-6">
							<div className="table-head">
								<span>{t("planner.table.medication")}</span>
								<span>{t("planner.table.usage")}</span>
								<span>{t("planner.table.blistersNeeded")}</span>
								<span>{t("planner.table.prescriptionRefills")}</span>
								<span>{t("planner.table.available")}</span>
								<span>{t("table.status")}</span>
							</div>
							{plannerRows.map((row) => {
								const med =
									meds.find((m) => m.id === row.medicationId) || meds.find((m) => m.name === row.medicationName);
								const remainingRefills = med?.prescriptionEnabled ? (med.prescriptionRemainingRefills ?? 0) : null;
								return (
									<div
										key={row.medicationId}
										className="table-row clickable"
										onClick={() => med && openMedDetail(med)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												if (med) openMedDetail(med);
											}
										}}
									>
										<span data-label={t("planner.table.medication")} className="cell-with-avatar">
											<MedicationAvatar name={row.medicationName} imageUrl={med?.imageUrl} />
											{row.medicationName}
										</span>
										<span data-label={t("planner.table.usage")}>
											<span>
												<strong>{row.plannerUsage}</strong>&nbsp;
												{row.plannerUsage === 1 ? t("common.pill") : t("common.pills")}
											</span>
										</span>
										<span data-label={t("planner.table.blisters")}>
											{row.packageType === "bottle" ? "–" : `${row.blistersNeeded} × ${row.blisterSize}`}
										</span>
										<span data-label={t("planner.table.prescriptionRefills")}>{remainingRefills ?? "–"}</span>
										<span data-label={t("planner.table.available")}>
											{row.packageType === "bottle" ? (
												`${Math.round(row.loosePills * 10) / 10} ${Math.round(row.loosePills * 10) / 10 === 1 ? t("common.pill") : t("common.pills")}`
											) : (
												<>
													{row.fullBlisters} {t("common.blisters")}
													{row.loosePills > 0 &&
														` + ${Math.round(row.loosePills * 10) / 10} ${Math.round(row.loosePills * 10) / 10 === 1 ? t("common.pill") : t("common.pills")}`}
												</>
											)}
										</span>
										<span
											data-label={t("table.status")}
											className={row.enough ? "status-chip success" : "status-chip danger"}
										>
											{row.enough ? t("status.enough") : t("status.outOfStock")}
										</span>
									</div>
								);
							})}
						</div>
						{canSendNotification && (
							<div className="planner-email-action">
								<button
									type="button"
									className="ghost"
									onClick={sendPlannerNotification}
									disabled={sendingPlannerEmail}
								>
									{sendingPlannerEmail ? t("common.sending") : t("planner.sendNotification")}
								</button>
								{plannerEmailResult && (
									<span className={plannerEmailResult.success ? "success-text" : "danger-text"}>
										{plannerEmailResult.message}
									</span>
								)}
							</div>
						)}
					</>
				)}
			</article>
		</section>
	);
}
