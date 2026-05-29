/* biome-ignore-all lint/a11y/noLabelWithoutControl: planner uses custom DateTimeInput control wrappers */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateTimeInput, MedicationAvatar } from "../components";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import type { PlannerRow } from "../types";
import { getMedDisplayName, isAmountBasedPackageType, isLiquidContainerPackageType, isTubePackageType } from "../types";
import { toInputValue } from "../utils/formatters";

function localDateAtStartOfDay(days = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(0, 0, 0, 0);
	return d;
}

function defaultPlannerRange(): { start: string; end: string } {
	return {
		start: toInputValue(localDateAtStartOfDay()),
		end: toInputValue(localDateAtStartOfDay(3)),
	};
}

// Convert datetime-local value to ISO string
function toIsoString(value: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDate(value: string): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

export function PlannerPage() {
	const { t } = useTranslation();
	const { user, authFetch } = useAuth();
	const { meds, settings, openMedDetail } = useAppContext();

	// Local state for planner
	const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
	const [plannerLoading, setPlannerLoading] = useState(false);
	const [range, setRange] = useState<{ start: string; end: string }>(() => defaultPlannerRange());
	const [includeUntilStart, setIncludeUntilStart] = useState(false);
	const [sendingPlannerEmail, setSendingPlannerEmail] = useState(false);
	const [plannerEmailResult, setPlannerEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [plannerError, setPlannerError] = useState<string | null>(null);
	const [hasCalculated, setHasCalculated] = useState(false);

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
				setRange(defaultPlannerRange());
			}

			if (savedIncludeUntilStart) {
				setIncludeUntilStart(savedIncludeUntilStart === "true");
			} else {
				setIncludeUntilStart(false);
			}
		} else {
			setPlannerRows([]);
			setRange(defaultPlannerRange());
			setIncludeUntilStart(false);
		}
	}, [user?.id]);

	async function runPlanner(e: React.FormEvent) {
		e.preventDefault();
		const start = toDate(range.start);
		const end = toDate(range.end);
		const startDate = toIsoString(range.start);
		const endDate = toIsoString(range.end);
		setPlannerError(null);
		setPlannerEmailResult(null);
		setHasCalculated(false);
		if (!start || !end || !startDate || !endDate || end <= start) {
			setPlannerRows([]);
			setPlannerError(t("planner.errors.invalidDateRange"));
			setHasCalculated(true);
			return;
		}

		setPlannerLoading(true);
		try {
			const body = { startDate, endDate, includeUntilStart };
			const res = await authFetch("/api/medications/usage", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				const message =
					data && typeof data === "object" && "error" in data && typeof data.error === "string"
						? data.error
						: t("planner.errors.calculateFailed");
				throw new Error(message);
			}
			if (!Array.isArray(data)) {
				throw new Error(t("planner.errors.calculateFailed"));
			}
			const rows = data as PlannerRow[];
			setPlannerRows(rows);
			setHasCalculated(true);
			if (user?.id) {
				localStorage.setItem(userStorageKey(user.id, "plannerRange"), JSON.stringify(range));
				localStorage.setItem(userStorageKey(user.id, "plannerRows"), JSON.stringify(rows));
				localStorage.setItem(userStorageKey(user.id, "plannerIncludeUntilStart"), String(includeUntilStart));
			}
		} catch (error) {
			setPlannerRows([]);
			setPlannerError(error instanceof Error && error.message ? error.message : t("planner.errors.calculateFailed"));
			setHasCalculated(true);
		} finally {
			setPlannerLoading(false);
		}
	}

	function resetRange() {
		setRange(defaultPlannerRange());
		setIncludeUntilStart(false);
		setPlannerRows([]);
		setPlannerError(null);
		setPlannerEmailResult(null);
		setHasCalculated(false);
		if (user?.id) {
			localStorage.removeItem(userStorageKey(user.id, "plannerRange"));
			localStorage.removeItem(userStorageKey(user.id, "plannerRows"));
			localStorage.removeItem(userStorageKey(user.id, "plannerIncludeUntilStart"));
		}
	}

	const canSendNotification =
		(settings.emailEnabled && settings.notificationEmail) || (settings.shoutrrrEnabled && settings.shoutrrrUrl);

	const getDiscreteUnitLabel = (packageType: string | undefined, count: number): string => {
		if (packageType === "inhaler") return count === 1 ? t("common.puff") : t("common.puffs");
		if (packageType === "injection") return count === 1 ? t("common.injection") : t("common.injections");
		return count === 1 ? t("common.pill") : t("common.pills");
	};

	const getUsageUnitLabel = (medicationId: number, count: number): string => {
		const med = meds.find((m) => m.id === medicationId);
		if (isLiquidContainerPackageType(med?.packageType)) {
			return t("form.ml");
		}
		if (isTubePackageType(med?.packageType)) {
			return med?.medicationForm === "liquid" ? t("form.ml") : t("blisters.applications");
		}
		return getDiscreteUnitLabel(med?.packageType, count);
	};

	const getAvailableLabel = (medicationId: number, loosePills: number): string => {
		const med = meds.find((m) => m.id === medicationId);
		const roundedLoose = Math.round(loosePills * 10) / 10;
		if (isLiquidContainerPackageType(med?.packageType)) {
			return `${roundedLoose} ${t("form.ml")}`;
		}
		if (isTubePackageType(med?.packageType)) {
			const unit = med?.medicationForm === "liquid" ? t("form.ml") : t("blisters.applications");
			return `${roundedLoose} ${unit}`;
		}
		return `${roundedLoose} ${getDiscreteUnitLabel(med?.packageType, roundedLoose)}`;
	};

	async function sendPlannerNotification() {
		if (!canSendNotification || plannerRows.length === 0) return;
		const start = toDate(range.start);
		const end = toDate(range.end);
		const startDate = toIsoString(range.start);
		const endDate = toIsoString(range.end);
		if (!start || !end || !startDate || !endDate || end <= start) {
			setPlannerEmailResult({ success: false, message: t("planner.errors.invalidDateRange") });
			return;
		}

		setSendingPlannerEmail(true);
		setPlannerEmailResult(null);

		try {
			const res = await authFetch("/api/planner/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: settings.notificationEmail,
					startDate,
					endDate,
					includeUntilStart,
					rows: plannerRows,
				}),
			});
			const data = await res.json().catch(() => null);
			if (res.ok) {
				setPlannerEmailResult({
					success: true,
					message: data && typeof data.message === "string" ? data.message : t("common.sent"),
				});
			} else {
				setPlannerEmailResult({
					success: false,
					message: data && typeof data.error === "string" ? data.error : t("common.sendFailed"),
				});
			}
		} catch {
			setPlannerEmailResult({ success: false, message: t("common.networkError") });
		}
		setSendingPlannerEmail(false);
	}

	return (
		<section className="grid">
			<article className="card" data-testid="planner-form-card">
				<div className="card-head" data-testid="planner-page-header">
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
						<label className="planner-checkbox" data-testid="planner-include-until-start">
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
				{plannerError && (
					<p className="danger-text" role="alert">
						{plannerError}
					</p>
				)}
				{hasCalculated && !plannerError && plannerRows.length === 0 && (
					<p className="info-text">{t("planner.noResults")}</p>
				)}
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
									meds.find((m) => m.id === row.medicationId) ||
									meds.find((m) => getMedDisplayName(m) === row.medicationName);
								const remainingRefills = med?.prescriptionEnabled ? (med.prescriptionRemainingRefills ?? 0) : null;
								const openMedication = () => {
									if (med) openMedDetail(med);
								};
								return (
									<button
										type="button"
										key={row.medicationId}
										className={med ? "table-row clickable" : "table-row"}
										disabled={!med}
										aria-label={t("planner.openMedication", { name: row.medicationName })}
										onClick={openMedication}
									>
										<span data-label={t("planner.table.medication")} className="cell-with-avatar">
											<MedicationAvatar name={row.medicationName} imageUrl={med?.imageUrl} />
											{row.medicationName}
										</span>
										<span data-label={t("planner.table.usage")}>
											<span>
												<strong>{row.plannerUsage}</strong>&nbsp;
												{getUsageUnitLabel(row.medicationId, row.plannerUsage)}
											</span>
										</span>
										<span data-label={t("planner.table.blistersNeeded")}>
											{isAmountBasedPackageType(row.packageType) ? "–" : `${row.blistersNeeded} × ${row.blisterSize}`}
										</span>
										<span data-label={t("planner.table.prescriptionRefills")}>{remainingRefills ?? "–"}</span>
										<span data-label={t("planner.table.available")}>
											{isAmountBasedPackageType(row.packageType) ? (
												getAvailableLabel(row.medicationId, row.loosePills)
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
									</button>
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
