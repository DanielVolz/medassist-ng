import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { useAppContext } from "../context";
import { MedicationAvatar } from "../components";
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
		end: toInputValue(plusDaysIso(3))
	});
	const [sendingPlannerEmail, setSendingPlannerEmail] = useState(false);
	const [plannerEmailResult, setPlannerEmailResult] = useState<{ success: boolean; message: string } | null>(null);

	// Load user-specific planner data when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const savedRows = localStorage.getItem(userStorageKey(user.id, "plannerRows"));
			const savedRange = localStorage.getItem(userStorageKey(user.id, "plannerRange"));
			
			if (savedRows) {
				try { setPlannerRows(JSON.parse(savedRows)); } catch { setPlannerRows([]); }
			} else {
				setPlannerRows([]);
			}
			
			if (savedRange) {
				try { setRange(JSON.parse(savedRange)); } catch { /* keep default */ }
			} else {
				setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
			}
		} else {
			setPlannerRows([]);
			setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		}
	}, [user?.id]);

	async function runPlanner(e: React.FormEvent) {
		e.preventDefault();
		setPlannerLoading(true);
		const body = { startDate: toIsoString(range.start), endDate: toIsoString(range.end) };
		const rows = await fetch("/api/medications/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
			.then((res) => res.json())
			.catch(() => []) as PlannerRow[];
		setPlannerRows(rows);
		setPlannerLoading(false);
		// Save to user-specific localStorage
		if (user?.id) {
			localStorage.setItem(userStorageKey(user.id, "plannerRange"), JSON.stringify(range));
			localStorage.setItem(userStorageKey(user.id, "plannerRows"), JSON.stringify(rows));
		}
	}

	function resetRange() {
		setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		setPlannerRows([]);
		if (user?.id) {
			localStorage.removeItem(userStorageKey(user.id, "plannerRange"));
			localStorage.removeItem(userStorageKey(user.id, "plannerRows"));
		}
	}

	async function sendPlannerEmail() {
		if (!settings.notificationEmail || plannerRows.length === 0) return;
		setSendingPlannerEmail(true);
		setPlannerEmailResult(null);

		try {
			const res = await fetch("/api/planner/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: settings.notificationEmail,
					from: range.start,
					until: range.end,
					rows: plannerRows,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setPlannerEmailResult({ success: true, message: data.message || "Email sent!" });
			} else {
				setPlannerEmailResult({ success: false, message: data.error || "Failed to send" });
			}
		} catch {
			setPlannerEmailResult({ success: false, message: "Network error" });
		}
		setSendingPlannerEmail(false);
	}

	return (
		<section className="grid">
			<article className="card">
				<div className="card-head">
					<h2>{t('planner.title')}</h2>
				</div>
				<form className="planner" onSubmit={runPlanner}>
					<label>
						{t('planner.from')}
						<input type="datetime-local" step="60" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
					</label>
					<label>
						{t('planner.until')}
						<input type="datetime-local" step="60" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
					</label>
					<div className="planner-actions">
						<button type="button" className="ghost" onClick={resetRange}>{t('common.reset')}</button>
						<button type="submit" disabled={plannerLoading}>{plannerLoading ? t('planner.calculating') : t('planner.calculate')}</button>
					</div>
				</form>
				{plannerRows.length > 0 && (
					<>
						<div className="table">
							<div className="table-head">
								<span>{t('planner.table.medication')}</span>
								<span>{t('planner.table.usage')}</span>
								<span>{t('planner.table.blistersNeeded')}</span>
								<span>{t('planner.table.available')}</span>
								<span>{t('table.status')}</span>
							</div>
							{plannerRows.map((row) => {
								const med = meds.find(m => m.name === row.medicationName);
								return (
									<div key={row.medicationId} className="table-row clickable" onClick={() => med && openMedDetail(med)}>
										<span data-label={t('planner.table.medication')} className="cell-with-avatar"><MedicationAvatar name={row.medicationName} imageUrl={med?.imageUrl} />{row.medicationName}</span>
										<span data-label={t('planner.table.usage')}><strong>{row.plannerUsage}</strong>&nbsp;{t('common.pills')}</span>
										<span data-label={t('planner.table.blisters')}>{row.blistersNeeded} × {row.blisterSize}</span>
										<span data-label={t('planner.table.available')}>
											{row.fullBlisters} {t('common.blisters')}{row.loosePills > 0 && ` + ${row.loosePills} ${t('common.pills')}`}
										</span>
										<span data-label={t('table.status')} className={row.enough ? "status-chip success" : "status-chip danger"}>{row.enough ? t('status.enough') : t('status.outOfStock')}</span>
									</div>
								);
							})}
						</div>
						{settings.emailEnabled && settings.notificationEmail && (
							<div className="planner-email-action">
								<button type="button" className="ghost" onClick={sendPlannerEmail} disabled={sendingPlannerEmail}>
									{sendingPlannerEmail ? t('common.sending') : t('planner.sendEmail')}
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
