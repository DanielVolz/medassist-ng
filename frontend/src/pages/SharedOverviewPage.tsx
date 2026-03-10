import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { MedicationAvatar } from "../components";
import type { SharedMedicationOverviewItem, SharedMedicationOverviewResponse } from "../types";
import { getSystemLocale } from "../utils/formatters";

type ThemePreference = "light" | "dark" | "system";

function getSystemTheme(): "light" | "dark" {
	if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
		return "light";
	}
	return "dark";
}

function formatPackageInfo(medication: SharedMedicationOverviewItem): string {
	if (medication.packageType === "blister") {
		return `${medication.packCount} x ${medication.blistersPerPack} x ${medication.pillsPerBlister}`;
	}

	if (medication.totalPills !== null) {
		return `${medication.packCount} x ${medication.totalPills}`;
	}

	return `${medication.packCount}`;
}

function formatDate(dateValue: string | null, locale: string): string {
	if (!dateValue) return "-";
	const parsed = new Date(`${dateValue}T00:00:00`);
	if (Number.isNaN(parsed.getTime())) return dateValue;
	return parsed.toLocaleDateString(locale);
}

export function SharedOverviewPage() {
	const { token } = useParams<{ token: string }>();
	const { t, i18n } = useTranslation();

	const [data, setData] = useState<SharedMedicationOverviewResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expiredAt, setExpiredAt] = useState<string | null>(null);

	const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
		if (typeof window !== "undefined") {
			const stored = localStorage.getItem("theme") as ThemePreference | null;
			if (stored === "light" || stored === "dark" || stored === "system") return stored;
		}
		return "dark";
	});
	const [themeMenuOpen, setThemeMenuOpen] = useState(false);
	const themeMenuRef = useRef<HTMLDivElement>(null);
	const resolvedTheme = themePreference === "system" ? getSystemTheme() : themePreference;

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolvedTheme);
		localStorage.setItem("theme", themePreference);
	}, [themePreference, resolvedTheme]);

	useEffect(() => {
		if (themePreference !== "system") return;
		const mq = window.matchMedia?.("(prefers-color-scheme: light)");
		if (!mq) return;
		const handler = () => {
			const resolved = mq.matches ? "light" : "dark";
			document.documentElement.setAttribute("data-theme", resolved);
		};
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [themePreference]);

	useEffect(() => {
		if (!themeMenuOpen) return;
		const handleClickOutside = (event: MouseEvent) => {
			if (themeMenuRef.current && !themeMenuRef.current.contains(event.target as Node)) {
				setThemeMenuOpen(false);
			}
		};
		document.addEventListener("click", handleClickOutside);
		return () => document.removeEventListener("click", handleClickOutside);
	}, [themeMenuOpen]);

	useEffect(() => {
		let isCancelled = false;

		async function loadOverview() {
			if (!token) {
				if (!isCancelled) {
					setLoading(false);
					setError(t("sharedOverview.error.notFound"));
				}
				return;
			}

			setLoading(true);
			setError(null);
			setExpiredAt(null);

			try {
				const response = await fetch(`/api/share/${token}/overview`);
				const responseData = await response.json().catch(() => ({}));

				if (!response.ok) {
					if (response.status === 404) {
						throw new Error("not_found");
					}
					if (response.status === 410) {
						setExpiredAt(responseData.expiredAt ?? null);
						throw new Error("expired");
					}
					if (response.status === 429) {
						throw new Error("rate_limited");
					}
					throw new Error("load_failed");
				}

				if (!isCancelled) {
					setData(responseData as SharedMedicationOverviewResponse);
				}
			} catch (loadError) {
				if (isCancelled) return;

				const message = loadError instanceof Error ? loadError.message : "load_failed";
				if (message === "not_found") {
					setError(t("sharedOverview.error.notFound"));
					return;
				}
				if (message === "expired") {
					setError(t("sharedOverview.error.expired"));
					return;
				}
				if (message === "rate_limited") {
					setError(t("sharedOverview.error.rateLimit"));
					return;
				}

				setError(t("sharedOverview.error.generic"));
			} finally {
				if (!isCancelled) {
					setLoading(false);
				}
			}
		}

		void loadOverview();

		return () => {
			isCancelled = true;
		};
	}, [token, t]);

	if (loading) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-loading shared-schedule-loading-skeleton" aria-busy="true">
					<h1>💊 MedAssist-ng</h1>
					<span className="screen-reader-only">{t("common.loading")}</span>
					<div className="skeleton-card">
						<span className="skeleton-line skeleton-line-long" />
						<span className="skeleton-line skeleton-line-medium" />
						<span className="skeleton-line skeleton-line-short" />
					</div>
				</div>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="shared-schedule-page">
				<div className={`shared-schedule-error${expiredAt ? " expired" : ""}`}>
					<h1>💊 MedAssist-ng</h1>
					{expiredAt ? <div className="expired-icon">⏰</div> : null}
					<h2>{t("sharedOverview.title")}</h2>
					<p className="error-message">{error ?? t("sharedOverview.error.generic")}</p>
					{expiredAt ? (
						<p className="expired-date">
							{t("sharedOverview.expiredOn", {
								date: new Date(expiredAt).toLocaleDateString(getSystemLocale(i18n.language)),
							})}
						</p>
					) : null}
				</div>
			</div>
		);
	}

	const locale = getSystemLocale(i18n.language);

	return (
		<div className="shared-schedule-page">
			<div className="shared-schedule-container shared-overview-container">
				<header className="shared-schedule-header">
					<h1>{t("sharedOverview.title", { person: data.takenBy })}</h1>
					<p className="shared-schedule-period">{t("sharedOverview.sharedBy", { user: data.sharedBy ?? "-" })}</p>
					<div className="shared-schedule-header-actions">
						<div className={`theme-menu ${themeMenuOpen ? "open" : ""}`} ref={themeMenuRef}>
							<button className="icon-btn" onClick={() => setThemeMenuOpen(!themeMenuOpen)} title={t("theme.title")}>
								{resolvedTheme === "dark" ? "🌙" : "☀️"}
							</button>
							<div className="theme-dropdown">
								<button
									className={`theme-dropdown-item${themePreference === "light" ? " active" : ""}`}
									onClick={() => {
										setThemePreference("light");
										setThemeMenuOpen(false);
									}}
								>
									{t("theme.light")}
								</button>
								<button
									className={`theme-dropdown-item${themePreference === "dark" ? " active" : ""}`}
									onClick={() => {
										setThemePreference("dark");
										setThemeMenuOpen(false);
									}}
								>
									{t("theme.dark")}
								</button>
								<button
									className={`theme-dropdown-item${themePreference === "system" ? " active" : ""}`}
									onClick={() => {
										setThemePreference("system");
										setThemeMenuOpen(false);
									}}
								>
									{t("theme.system")}
								</button>
							</div>
						</div>
					</div>
				</header>

				{data.medications.length === 0 ? (
					<p className="shared-schedule-empty">{t("sharedOverview.noMedications")}</p>
				) : (
					<>
						<div className="shared-overview-table-wrap">
							<table className="shared-overview-table">
								<thead>
									<tr>
										<th>{t("sharedOverview.columns.name")}</th>
										<th>{t("sharedOverview.columns.package")}</th>
										<th>{t("sharedOverview.columns.stock")}</th>
										<th>{t("sharedOverview.columns.daysLeft")}</th>
										<th>{t("sharedOverview.columns.nextIntake")}</th>
										<th>{t("sharedOverview.columns.depletion")}</th>
										<th>{t("sharedOverview.columns.priority")}</th>
									</tr>
								</thead>
								<tbody>
									{data.medications.map((medication) => {
										const priorityKey =
											medication.priority === "high"
												? "sharedOverview.priority.high"
												: "sharedOverview.priority.normal";
										return (
											<tr key={`${medication.name}-${medication.medicationStartDate ?? "no-start"}`}>
												<td>
													<div className="shared-overview-medication-cell">
														<MedicationAvatar name={medication.name} imageUrl={medication.imageUrl} size="sm" />
														<div className="shared-overview-medication-text">
															<strong>{medication.name}</strong>
															{medication.genericName ? <span>{medication.genericName}</span> : null}
														</div>
													</div>
												</td>
												<td>{formatPackageInfo(medication)}</td>
												<td>
													{medication.currentStock === null || medication.capacity === null
														? "-"
														: t("sharedOverview.stock.of", {
																current: medication.currentStock,
																capacity: medication.capacity,
															})}
												</td>
												<td>{medication.daysLeft === null ? "-" : medication.daysLeft}</td>
												<td>{formatDate(medication.nextIntakeDate, locale)}</td>
												<td>{formatDate(medication.depletionDate, locale)}</td>
												<td>
													{medication.priority === null ? (
														"-"
													) : (
														<span className={`shared-overview-priority ${medication.priority}`}>{t(priorityKey)}</span>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>

						<div className="shared-overview-cards">
							{data.medications.map((medication) => {
								const priorityKey =
									medication.priority === "high" ? "sharedOverview.priority.high" : "sharedOverview.priority.normal";
								return (
									<article
										className="shared-overview-card"
										key={`${medication.name}-${medication.medicationStartDate ?? "no-start"}`}
									>
										<div className="shared-overview-card-title">
											<MedicationAvatar name={medication.name} imageUrl={medication.imageUrl} size="sm" />
											<div>
												<strong>{medication.name}</strong>
												{medication.genericName ? <p>{medication.genericName}</p> : null}
											</div>
										</div>
										<div className="shared-overview-card-grid">
											<span>{t("sharedOverview.columns.package")}</span>
											<strong>{formatPackageInfo(medication)}</strong>
											<span>{t("sharedOverview.columns.stock")}</span>
											<strong>
												{medication.currentStock === null || medication.capacity === null
													? "-"
													: t("sharedOverview.stock.of", {
															current: medication.currentStock,
															capacity: medication.capacity,
														})}
											</strong>
											<span>{t("sharedOverview.columns.daysLeft")}</span>
											<strong>{medication.daysLeft === null ? "-" : medication.daysLeft}</strong>
											<span>{t("sharedOverview.columns.nextIntake")}</span>
											<strong>{formatDate(medication.nextIntakeDate, locale)}</strong>
											<span>{t("sharedOverview.columns.depletion")}</span>
											<strong>{formatDate(medication.depletionDate, locale)}</strong>
										</div>
										{medication.priority ? (
											<span className={`shared-overview-priority ${medication.priority}`}>{t(priorityKey)}</span>
										) : null}
									</article>
								);
							})}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
