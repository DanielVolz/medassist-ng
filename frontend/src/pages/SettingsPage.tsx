/* biome-ignore-all lint/a11y/noLabelWithoutControl: settings rows use label-styled text with adjacent custom toggle controls */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal, ExportModal } from "../components";
import { useAppContext } from "../context";
import { getSystemLocale, withFormattingTimezone } from "../utils/formatters";

export function SettingsPage() {
	const { t, i18n } = useTranslation();
	const [apiKeyToken, setApiKeyToken] = useState("");
	const [apiKeyGenerating, setApiKeyGenerating] = useState(false);
	const [apiKeyCopied, setApiKeyCopied] = useState(false);
	const [apiKeyError, setApiKeyError] = useState<string | null>(null);
	const {
		settings,
		savedSettings,
		setSettings,
		settingsLoading,
		settingsSaving,
		settingsSaved,
		settingsLoadError,
		// Email testing
		testEmail,
		testingEmail,
		testEmailResult,
		// Shoutrrr testing
		testShoutrrr,
		testingShoutrrr,
		testShoutrrrResult,
		// Export/Import
		exporting,
		importing,
		showExportModal,
		setShowExportModal,
		handleExport,
		handleImportFileSelect,
		showImportConfirm,
		setShowImportConfirm,
		setPendingImportData,
		handleImportConfirm,
		importResult,
		setImportResult,
		meds,
	} = useAppContext();
	const [timezoneTouched, setTimezoneTouched] = useState(false);
	const [timezoneDraft, setTimezoneDraft] = useState("");

	const hasExistingData = meds.length > 0;
	let emailUnavailableReason: string | null = null;
	if (settingsLoadError === "auth") {
		emailUnavailableReason = t("settings.email.loadErrorAuth");
	} else if (settingsLoadError === "forbidden") {
		emailUnavailableReason = t("settings.email.loadErrorForbidden");
	} else if (settingsLoadError === "request") {
		emailUnavailableReason = t("settings.email.loadErrorGeneric");
	} else if (!settings.smtpHost) {
		emailUnavailableReason = t("settings.email.serverNotConfigured");
	}

	const generateApiKey = async () => {
		setApiKeyGenerating(true);
		setApiKeyError(null);
		setApiKeyCopied(false);

		try {
			const response = await fetch("/api/auth/api-keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					name: "Default API Key",
					scope: "write",
				}),
			});

			const data = await response.json().catch(() => ({}));
			if (!response.ok || typeof data?.token !== "string" || !data.token) {
				setApiKeyError(t("settings.apiKey.generateError"));
				return;
			}

			setApiKeyToken(data.token);
		} catch {
			setApiKeyError(t("settings.apiKey.generateError"));
		} finally {
			setApiKeyGenerating(false);
		}
	};

	const copyApiKeyToken = async () => {
		if (!apiKeyToken) return;

		const markCopied = () => {
			setApiKeyCopied(true);
			setTimeout(() => setApiKeyCopied(false), 2000);
		};

		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(apiKeyToken);
				markCopied();
				return;
			} catch {
				// Fall back to textarea-based copy.
			}
		}

		const textarea = document.createElement("textarea");
		textarea.value = apiKeyToken;
		textarea.style.position = "fixed";
		textarea.style.opacity = "0";
		document.body.appendChild(textarea);
		textarea.select();
		try {
			document.execCommand("copy");
			markCopied();
		} finally {
			document.body.removeChild(textarea);
		}
	};

	const automaticStockCalculationId = "settings-stock-calculation-automatic";
	const manualStockCalculationId = "settings-stock-calculation-manual";

	useEffect(() => {
		setTimezoneDraft(settings.timezone);
	}, [settings.timezone]);

	const commitTimezoneDraft = () => {
		if (timezoneDraft === settings.timezone) {
			return;
		}

		setTimezoneTouched(true);
		setSettings((prev) => ({ ...prev, timezone: timezoneDraft }));
	};

	const savedTimezone = savedSettings?.timezone ?? settings.timezone;
	const timezoneChanged = settings.timezone !== savedTimezone;
	const showTimezoneSaving = timezoneTouched && timezoneChanged && settingsSaving;
	const showTimezoneSaved = timezoneTouched && !timezoneChanged && settingsSaved;
	let timezoneStatusText = "";
	if (showTimezoneSaving) {
		timezoneStatusText = t("settings.timezone.saving");
	} else if (showTimezoneSaved) {
		timezoneStatusText = t("settings.timezone.saved");
	}
	const timezoneStatusClassName = showTimezoneSaved ? "timezone-status timezone-status-saved" : "timezone-status";
	const availableTimezones = Array.isArray(settings.availableTimezones) ? settings.availableTimezones : [];
	const timezoneSuggestions =
		availableTimezones.length > 0
			? availableTimezones
			: (() => {
					try {
						type IntlWithSupportedValuesOf = typeof Intl & {
							supportedValuesOf?: (key: string) => string[];
						};
						const intlWithSupportedValues = Intl as IntlWithSupportedValuesOf;
						if (typeof intlWithSupportedValues.supportedValuesOf === "function") {
							return intlWithSupportedValues.supportedValuesOf("timeZone");
						}
					} catch {
						// fall through
					}
					return [settings.serverTimezone || "UTC", "UTC"];
				})();

	return (
		<section className="grid">
			{settingsLoading ? (
				<div className="page-loading-skeleton" aria-busy="true">
					<span className="screen-reader-only">{t("settings.loading")}</span>
					<article className="card skeleton-card">
						<span className="skeleton-line skeleton-line-short" />
						<span className="skeleton-line skeleton-line-medium" />
					</article>
					<article className="card skeleton-card">
						<span className="skeleton-line skeleton-line-short" />
						<span className="skeleton-line skeleton-line-long" />
						<span className="skeleton-line skeleton-line-medium" />
						<span className="skeleton-line skeleton-line-long" />
					</article>
				</div>
			) : (
				<div className="settings-form" data-testid="settings-page">
					{/* Language */}
					<article className="card">
						<div className="card-head">
							<h2>{t("settings.language.title")}</h2>
						</div>
						<label className="setting-row language-row" data-testid="settings-language-select">
							<span className="setting-label">{t("settings.language.select")}</span>
							<select
								value={i18n.language}
								onChange={(e) => {
									const lang = e.target.value;
									i18n.changeLanguage(lang);
									fetch("/api/settings/language", {
										method: "PUT",
										headers: { "Content-Type": "application/json" },
										credentials: "include",
										body: JSON.stringify({ language: lang }),
									});
								}}
								className="select-field language-select"
							>
								<option value="en">🇬🇧 English</option>
								<option value="de">🇩🇪 Deutsch</option>
							</select>
						</label>
						<div className="setting-row language-row" style={{ marginTop: "12px" }}>
							<div className="setting-label">
								<span>{t("settings.timezone.select")}</span>
								<span className="info-tooltip small tooltip-align-left" data-tooltip={t("settings.timezone.hint")}>
									ⓘ
								</span>
							</div>
							<div className="setting-actions" style={{ margin: 0, flexWrap: "nowrap", gap: "8px", width: "auto" }}>
								<input
									type="text"
									className="select-field language-select"
									value={timezoneDraft}
									onChange={(e) => {
										setTimezoneDraft(e.target.value);
									}}
									onBlur={commitTimezoneDraft}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											(e.currentTarget as HTMLInputElement).blur();
										}
									}}
									list="settings-timezone-suggestions"
									placeholder={settings.serverTimezone || "UTC"}
								/>
								<datalist id="settings-timezone-suggestions">
									{timezoneSuggestions.map((zone) => (
										<option key={zone} value={zone} />
									))}
								</datalist>
								<button
									type="button"
									className="ghost"
									onClick={() => {
										setTimezoneTouched(true);
										setTimezoneDraft("");
										setSettings((prev) => ({ ...prev, timezone: "" }));
									}}
								>
									{t("settings.timezone.useServerDefault")}
								</button>
							</div>
						</div>
						<p className={timezoneStatusClassName}>{timezoneStatusText || " "}</p>
						<p className="hint-text" style={{ marginTop: "8px" }}>
							{t("settings.timezone.currentServerTz", { timezone: settings.serverTimezone || "UTC" })}
						</p>
					</article>

					<article className="card" data-testid="settings-notification-card">
						<div className="card-head">
							<h2>{t("settings.apiKey.title")}</h2>
						</div>
						<div className="setting-section">
							<div className="setting-group" style={{ gridTemplateColumns: "1fr" }}>
								<div className="action-card">
									<div className="action-card-content">
										<span className="action-card-title">{t("settings.apiKey.generateTitle")}</span>
										<span className="action-card-desc">{t("settings.apiKey.generateDesc")}</span>
									</div>
									<button type="button" className="secondary" onClick={generateApiKey} disabled={apiKeyGenerating}>
										{apiKeyGenerating ? t("settings.apiKey.generating") : t("settings.apiKey.generateButton")}
									</button>
								</div>

								{apiKeyToken ? (
									<div>
										<span className="field-label">{t("settings.apiKey.currentToken")}</span>
										<div className="setting-actions api-key-actions">
											<input
												type="text"
												className="api-key-token-input"
												value={apiKeyToken}
												readOnly
												onClick={(e) => (e.target as HTMLInputElement).select()}
											/>
											<button type="button" className="ghost" onClick={copyApiKeyToken}>
												{apiKeyCopied ? t("settings.apiKey.copied") : t("settings.apiKey.copyButton")}
											</button>
										</div>
										<p className="hint-text">{t("settings.apiKey.copyHint")}</p>
									</div>
								) : null}

								{apiKeyError ? <p className="danger-text">{apiKeyError}</p> : null}
							</div>
						</div>
					</article>

					{/* Notifications */}
					<article className="card">
						<div className="card-head">
							<h2>{t("settings.notifications.title")}</h2>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.notifications.channels")}</h3>
							</div>
							<div className="notification-matrix" data-testid="settings-notification-matrix">
								<div className="matrix-header">
									<div className="matrix-label"></div>
									<div className="matrix-channel">{t("settings.notifications.email")}</div>
									<div className="matrix-channel">{t("settings.notifications.push")}</div>
								</div>
								<div className="matrix-row">
									<div className="matrix-label">{t("settings.notifications.stockReminders")}</div>
									<div className="matrix-cell">
										<label className={`toggle-switch small${!settings.emailEnabled ? " disabled" : ""}`}>
											<input
												type="checkbox"
												checked={settings.emailStockReminders}
												onChange={(e) => setSettings({ ...settings, emailStockReminders: e.target.checked })}
												disabled={!settings.emailEnabled}
											/>
											<span className="toggle-slider"></span>
										</label>
									</div>
									<div className="matrix-cell">
										<label className={`toggle-switch small${!settings.shoutrrrEnabled ? " disabled" : ""}`}>
											<input
												type="checkbox"
												checked={settings.shoutrrrStockReminders}
												onChange={(e) => setSettings({ ...settings, shoutrrrStockReminders: e.target.checked })}
												disabled={!settings.shoutrrrEnabled}
											/>
											<span className="toggle-slider"></span>
										</label>
									</div>
								</div>
								<div className="matrix-row">
									<div className="matrix-label">{t("settings.notifications.intakeReminders")}</div>
									<div className="matrix-cell">
										<label className={`toggle-switch small${!settings.emailEnabled ? " disabled" : ""}`}>
											<input
												type="checkbox"
												checked={settings.emailIntakeReminders}
												onChange={(e) => setSettings({ ...settings, emailIntakeReminders: e.target.checked })}
												disabled={!settings.emailEnabled}
											/>
											<span className="toggle-slider"></span>
										</label>
									</div>
									<div className="matrix-cell">
										<label className={`toggle-switch small${!settings.shoutrrrEnabled ? " disabled" : ""}`}>
											<input
												type="checkbox"
												checked={settings.shoutrrrIntakeReminders}
												onChange={(e) => setSettings({ ...settings, shoutrrrIntakeReminders: e.target.checked })}
												disabled={!settings.shoutrrrEnabled}
											/>
											<span className="toggle-slider"></span>
										</label>
									</div>
								</div>
								<div className="matrix-row">
									<div className="matrix-label">{t("settings.notifications.prescriptionReminders")}</div>
									<div className="matrix-cell">
										<label className={`toggle-switch small${!settings.emailEnabled ? " disabled" : ""}`}>
											<input
												type="checkbox"
												checked={settings.emailPrescriptionReminders}
												onChange={(e) => setSettings({ ...settings, emailPrescriptionReminders: e.target.checked })}
												disabled={!settings.emailEnabled}
											/>
											<span className="toggle-slider"></span>
										</label>
									</div>
									<div className="matrix-cell">
										<label className={`toggle-switch small${!settings.shoutrrrEnabled ? " disabled" : ""}`}>
											<input
												type="checkbox"
												checked={settings.shoutrrrPrescriptionReminders}
												onChange={(e) => setSettings({ ...settings, shoutrrrPrescriptionReminders: e.target.checked })}
												disabled={!settings.shoutrrrEnabled}
											/>
											<span className="toggle-slider"></span>
										</label>
									</div>
								</div>
							</div>
							{!settings.emailEnabled && !settings.shoutrrrEnabled && (
								<p className="hint-text">{t("settings.notifications.enableHint")}</p>
							)}

							{/* Skip reminders for taken doses */}
							<div className="setting-row compact" style={{ marginTop: "16px" }}>
								<label className="setting-label">
									{t("settings.notifications.skipTakenDoses")}
									<span className="info-tooltip small" data-tooltip={t("settings.notifications.skipTakenDosesTooltip")}>
										ⓘ
									</span>
								</label>
								<label
									className={`toggle-switch small${!settings.emailEnabled && !settings.shoutrrrEnabled ? " disabled" : ""}`}
								>
									<input
										type="checkbox"
										checked={settings.skipRemindersForTakenDoses}
										onChange={(e) => setSettings({ ...settings, skipRemindersForTakenDoses: e.target.checked })}
										disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>

							{/* Repeat reminders for missed doses */}
							<div className="setting-row compact" style={{ marginTop: "12px" }}>
								<label className="setting-label">
									{t("settings.notifications.repeatReminders")}
									<span
										className="info-tooltip small"
										data-tooltip={t("settings.notifications.repeatRemindersTooltip")}
									>
										ⓘ
									</span>
								</label>
								<label
									className={`toggle-switch small${!settings.emailEnabled && !settings.shoutrrrEnabled ? " disabled" : ""}`}
								>
									<input
										type="checkbox"
										checked={settings.repeatRemindersEnabled}
										onChange={(e) => setSettings({ ...settings, repeatRemindersEnabled: e.target.checked })}
										disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>

							{/* Reminder interval (only shown when repeat is enabled) */}
							{settings.repeatRemindersEnabled && (
								<>
									<div className="setting-row compact" style={{ marginTop: "12px", marginLeft: "24px" }}>
										<label className="setting-label">
											{t("settings.notifications.reminderInterval")}
											<span
												className="info-tooltip small"
												data-tooltip={t("settings.notifications.reminderIntervalTooltip")}
											>
												ⓘ
											</span>
										</label>
										<input
											type="text"
											inputMode="numeric"
											pattern="[0-9]*"
											value={settings.reminderRepeatIntervalMinutes}
											onChange={(e) =>
												setSettings({ ...settings, reminderRepeatIntervalMinutes: parseInt(e.target.value, 10) || 30 })
											}
											style={{ width: "80px", textAlign: "center" }}
										/>
									</div>
									<div className="setting-row compact" style={{ marginTop: "8px", marginLeft: "24px" }}>
										<label className="setting-label">
											{t("settings.notifications.maxNaggingReminders")}
											<span
												className="info-tooltip small"
												data-tooltip={t("settings.notifications.maxNaggingRemindersTooltip")}
											>
												ⓘ
											</span>
										</label>
										<input
											type="text"
											inputMode="numeric"
											pattern="[0-9]*"
											value={settings.maxNaggingReminders ?? 5}
											onChange={(e) => {
												const val = parseInt(e.target.value, 10);
												if (!Number.isNaN(val)) {
													setSettings({ ...settings, maxNaggingReminders: Math.max(1, Math.min(20, val)) });
												}
											}}
											style={{ width: "80px", textAlign: "center" }}
										/>
									</div>
								</>
							)}
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.stockReminder.title")}</h3>
							</div>
							<div className="setting-row compact">
								<label className="setting-label">
									{t("settings.stockReminder.description")}{" "}
									<span className="info-tooltip small" data-tooltip={t("settings.stockReminder.infoTooltip")}>
										ⓘ
									</span>{" "}
								</label>
								<label
									className={`toggle-switch small${!settings.emailEnabled && !settings.shoutrrrEnabled ? " disabled" : ""}`}
								>
									<input
										type="checkbox"
										checked={
											(settings.emailEnabled && settings.emailStockReminders) ||
											(settings.shoutrrrEnabled && settings.shoutrrrStockReminders)
										}
										onChange={(e) => {
											const newVal = e.target.checked;
											if (newVal) {
												setSettings({
													...settings,
													emailStockReminders: settings.emailEnabled ? true : settings.emailStockReminders,
													shoutrrrStockReminders: settings.shoutrrrEnabled ? true : settings.shoutrrrStockReminders,
												});
											} else {
												setSettings({
													...settings,
													emailStockReminders: false,
													shoutrrrStockReminders: false,
													repeatDailyReminders: false,
												});
											}
										}}
										disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>

							<div className="setting-row compact" style={{ marginTop: "4px" }}>
								<label className="setting-label">
									{t("settings.stockReminder.repeatDaily")}
									<span
										className="info-tooltip small tooltip-align-left"
										data-tooltip={t("settings.stockReminder.repeatTooltip")}
									>
										ⓘ
									</span>
								</label>
								<label
									className={`toggle-switch small${!((settings.emailEnabled && settings.emailStockReminders) || (settings.shoutrrrEnabled && settings.shoutrrrStockReminders)) ? " disabled" : ""}`}
								>
									<input
										type="checkbox"
										checked={settings.repeatDailyReminders}
										onChange={(e) => setSettings({ ...settings, repeatDailyReminders: e.target.checked })}
										disabled={
											!(
												(settings.emailEnabled && settings.emailStockReminders) ||
												(settings.shoutrrrEnabled && settings.shoutrrrStockReminders)
											)
										}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.notifications.email")}</h3>
								<label
									className={`toggle-switch small${!settings.smtpHost ? " disabled" : ""}`}
									data-testid="settings-email-enabled-toggle"
								>
									<input
										type="checkbox"
										checked={settings.smtpHost ? settings.emailEnabled : false}
										onChange={(e) => {
											const newVal = e.target.checked;
											if (!newVal && !settings.shoutrrrEnabled) {
												setSettings({
													...settings,
													emailEnabled: false,
													emailStockReminders: false,
													emailIntakeReminders: false,
													emailPrescriptionReminders: false,
													skipRemindersForTakenDoses: false,
													repeatRemindersEnabled: false,
												});
											} else {
												setSettings({ ...settings, emailEnabled: newVal });
											}
										}}
										disabled={!settings.smtpHost}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
							{emailUnavailableReason && (
								<div className="setting-actions">
									<span className={settingsLoadError ? "danger-text" : "info-text"}>{emailUnavailableReason}</span>
								</div>
							)}
							{settings.emailEnabled && (
								<>
									<div className="setting-group">
										<div className="full">
											<span className="field-label">
												{t("settings.email.recipient")}
												<span
													className="info-tooltip"
													data-tooltip={`SMTP: ${settings.smtpHost || t("settings.email.notConfigured")}:${settings.smtpPort}${settings.hasSmtpPassword ? "\nPassword: ✓" : ""}`}
												>
													ⓘ
												</span>
											</span>
											<input
												type="text"
												value={settings.notificationEmail}
												onChange={(e) => setSettings({ ...settings, notificationEmail: e.target.value })}
												placeholder="recipient address"
												pattern="[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$"
												inputMode="email"
												autoComplete="off"
												autoCapitalize="none"
												autoCorrect="off"
												spellCheck={false}
												data-bwignore="true"
												data-lpignore="true"
												data-1p-ignore="true"
											/>
										</div>
									</div>
									<div className="setting-actions">
										<button
											type="button"
											className="ghost"
											onClick={testEmail}
											disabled={testingEmail || !settings.notificationEmail}
										>
											{testingEmail ? t("common.sending") : t("common.test")}
										</button>
										{testEmailResult && (
											<span className={testEmailResult.success ? "success-text" : "danger-text"}>
												{testEmailResult.message}
											</span>
										)}
									</div>
								</>
							)}
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.notifications.push")}</h3>
								<label className="toggle-switch small">
									<input
										type="checkbox"
										checked={settings.shoutrrrEnabled}
										onChange={(e) => {
											const newVal = e.target.checked;
											if (!newVal && !settings.emailEnabled) {
												setSettings({
													...settings,
													shoutrrrEnabled: false,
													shoutrrrStockReminders: false,
													shoutrrrIntakeReminders: false,
													shoutrrrPrescriptionReminders: false,
													skipRemindersForTakenDoses: false,
													repeatRemindersEnabled: false,
												});
											} else {
												setSettings({ ...settings, shoutrrrEnabled: newVal });
											}
										}}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
							{settings.shoutrrrEnabled && (
								<>
									<div className="setting-group">
										<div className="full">
											<span className="field-label">
												{t("settings.push.url")}
												<span
													className="info-tooltip"
													data-tooltip={`${t("settings.push.supports")}\n\n${t("settings.push.docsLink")}`}
												>
													ⓘ
												</span>
											</span>
											<input
												type="text"
												value={settings.shoutrrrUrl}
												onChange={(e) => setSettings({ ...settings, shoutrrrUrl: e.target.value })}
												placeholder={t("settings.push.urlPlaceholder")}
											/>
										</div>
									</div>
									<div className="setting-actions">
										<button
											type="button"
											className="ghost"
											onClick={testShoutrrr}
											disabled={testingShoutrrr || !settings.shoutrrrUrl}
										>
											{testingShoutrrr ? t("common.sending") : t("common.test")}
										</button>
										{testShoutrrrResult && (
											<span className={testShoutrrrResult.success ? "success-text" : "danger-text"}>
												{testShoutrrrResult.message}
											</span>
										)}
									</div>
								</>
							)}
						</div>

						<div className="schedule-overview">
							<div className="schedule-header">
								<span className="schedule-title">{t("settings.schedule.title")}</span>
								<span className="info-tooltip" data-tooltip={t("settings.schedule.envHint")}>
									ⓘ
								</span>
							</div>
							<div className="schedule-row">
								<span className="schedule-label">{t("settings.schedule.stockCheck")}</span>
								<span className="schedule-value">
									{t("settings.schedule.dailyAtHour", { hour: settings.reminderHour })}
								</span>
							</div>
							<div className="schedule-row">
								<span className="schedule-label">{t("settings.schedule.intakeCheck")}</span>
								<span className="schedule-value">
									{t("settings.schedule.minutesBefore", { minutes: settings.reminderMinutesBefore })}
								</span>
							</div>
							{settings.nextScheduledCheck && (
								<div className="schedule-row">
									<span className="schedule-label">{t("settings.schedule.nextCheck")}</span>
									<span className="schedule-value">
										{new Date(settings.nextScheduledCheck).toLocaleString(
											getSystemLocale(i18n.language),
											withFormattingTimezone({
												day: "2-digit",
												month: "2-digit",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											})
										)}
									</span>
								</div>
							)}
							{settings.lastStockReminderSent && (
								<div className="schedule-row">
									<span className="schedule-label">{t("settings.schedule.lastStockSent")}</span>
									<span className="schedule-value">
										{new Date(settings.lastStockReminderSent).toLocaleString(
											getSystemLocale(i18n.language),
											withFormattingTimezone({
												day: "2-digit",
												month: "2-digit",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											})
										)}
									</span>
								</div>
							)}
							{settings.lastAutoEmailSent && (
								<div className="schedule-row">
									<span className="schedule-label">{t("settings.schedule.lastIntakeSent")}</span>
									<span className="schedule-value">
										{new Date(settings.lastAutoEmailSent).toLocaleString(
											getSystemLocale(i18n.language),
											withFormattingTimezone({
												day: "2-digit",
												month: "2-digit",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											})
										)}
									</span>
								</div>
							)}
							{settings.lastPrescriptionReminderSent && (
								<div className="schedule-row">
									<span className="schedule-label">{t("settings.schedule.lastPrescriptionSent")}</span>
									<span className="schedule-value">
										{new Date(settings.lastPrescriptionReminderSent).toLocaleString(
											getSystemLocale(i18n.language),
											withFormattingTimezone({
												day: "2-digit",
												month: "2-digit",
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit",
											})
										)}
									</span>
								</div>
							)}
						</div>
					</article>

					{/* Stock Settings */}
					<article className="card" data-testid="settings-security-card">
						<div className="card-head">
							<h2>{t("settings.stock.title")}</h2>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.stock.calculationMode")}</h3>
							</div>
							<div className="setting-group calculation-mode-group" data-testid="settings-calculation-mode">
								<label
									className={`radio-card ${settings.stockCalculationMode === "automatic" ? "selected" : ""}`}
									htmlFor={automaticStockCalculationId}
								>
									<input
										id={automaticStockCalculationId}
										type="radio"
										name="stockCalculationMode"
										value="automatic"
										checked={settings.stockCalculationMode === "automatic"}
										onChange={(e) =>
											setSettings({ ...settings, stockCalculationMode: e.target.value as "automatic" | "manual" })
										}
									/>
									<div className="radio-card-content">
										<div className="radio-card-text">
											<span className="radio-card-title">{t("settings.stock.automatic")}</span>
											<span className="radio-card-desc">{t("settings.stock.automaticDesc")}</span>
										</div>
									</div>
								</label>
								<label
									className={`radio-card ${settings.stockCalculationMode === "manual" ? "selected" : ""}`}
									htmlFor={manualStockCalculationId}
								>
									<input
										id={manualStockCalculationId}
										type="radio"
										name="stockCalculationMode"
										value="manual"
										checked={settings.stockCalculationMode === "manual"}
										onChange={(e) =>
											setSettings({ ...settings, stockCalculationMode: e.target.value as "automatic" | "manual" })
										}
									/>
									<div className="radio-card-content">
										<div className="radio-card-text">
											<span className="radio-card-title">{t("settings.stock.manual")}</span>
											<span className="radio-card-desc">{t("settings.stock.manualDesc")}</span>
										</div>
									</div>
								</label>
							</div>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.stock.thresholds")}</h3>
							</div>
							<div className="setting-group threshold-chips-group">
								<div
									className={settings.reminderDaysBefore >= settings.lowStockDays ? "threshold-invalid" : ""}
									data-testid="settings-threshold-critical"
								>
									<span className="field-label threshold-chip-label">
										<span className="status-chip small danger">{t("status.criticalStock")}</span>
										<span
											className="info-tooltip small tooltip-align-left"
											data-tooltip={t("settings.stock.criticalStockTooltip")}
										>
											ⓘ
										</span>
									</span>
									<input
										type="text"
										inputMode="numeric"
										pattern="[0-9]*"
										value={settings.reminderDaysBefore}
										onChange={(e) => setSettings({ ...settings, reminderDaysBefore: Number(e.target.value) || 7 })}
									/>
								</div>
								<div
									className={
										settings.lowStockDays <= settings.reminderDaysBefore ||
										settings.lowStockDays >= settings.highStockDays
											? "threshold-invalid"
											: ""
									}
									data-testid="settings-threshold-low"
								>
									<span className="field-label threshold-chip-label">
										<span className="status-chip small warning">{t("status.lowStock")}</span>
										<span
											className="info-tooltip small tooltip-align-left"
											data-tooltip={t("settings.stock.lowStockTooltip")}
										>
											ⓘ
										</span>
									</span>
									<input
										type="text"
										inputMode="numeric"
										pattern="[0-9]*"
										value={settings.lowStockDays}
										onChange={(e) => setSettings({ ...settings, lowStockDays: Number(e.target.value) || 30 })}
									/>
								</div>
								<div
									className={settings.highStockDays <= settings.lowStockDays ? "threshold-invalid" : ""}
									data-testid="settings-threshold-high"
								>
									<span className="field-label threshold-chip-label">
										<span className="status-chip small high">{t("status.highStock")}</span>
										<span
											className="info-tooltip small tooltip-align-left"
											data-tooltip={t("settings.stock.highStockTooltip")}
										>
											ⓘ
										</span>
									</span>
									<input
										type="text"
										inputMode="numeric"
										pattern="[0-9]*"
										value={settings.highStockDays}
										onChange={(e) => setSettings({ ...settings, highStockDays: Number(e.target.value) || 180 })}
									/>
								</div>
							</div>
							{(settings.reminderDaysBefore >= settings.lowStockDays ||
								settings.lowStockDays >= settings.highStockDays) && (
								<p className="threshold-validation-error" data-testid="settings-threshold-validation">
									{t("settings.stock.thresholdValidation")}
								</p>
							)}
							<p className="hint-text" style={{ marginTop: "12px" }}>
								ℹ️ {t("settings.stock.packageTypesNote")}
							</p>
						</div>
					</article>

					{/* General UI */}
					<article className="card">
						<div className="card-head">
							<h2>{t("settings.timeline.title")}</h2>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.timeline.dashboardSectionOrder")}</h3>
							</div>
							<div className="setting-row compact">
								<div className="setting-label">
									<span>{t("settings.timeline.swapDashboardSections")}</span>
									<span className="info-tooltip small" data-tooltip={t("settings.timeline.swapDashboardSectionsDesc")}>
										ⓘ
									</span>
								</div>
								<label className="toggle-switch small">
									<input
										type="checkbox"
										checked={settings.swapDashboardMainSections}
										onChange={(e) => setSettings({ ...settings, swapDashboardMainSections: e.target.checked })}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.timeline.upcomingSection")}</h3>
							</div>
							<div className="setting-row compact">
								<div className="setting-label">
									<span>{t("settings.timeline.upcomingTodayOnly")}</span>
									<span className="info-tooltip small" data-tooltip={t("settings.timeline.upcomingTodayOnlyDesc")}>
										ⓘ
									</span>
								</div>
								<label className="toggle-switch small">
									<input
										type="checkbox"
										checked={settings.upcomingTodayOnly}
										onChange={(e) => setSettings({ ...settings, upcomingTodayOnly: e.target.checked })}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
						</div>

						<div className="setting-section">
							<div className="section-header">
								<h3>{t("settings.timeline.sharedSection")}</h3>
							</div>
							<div className="setting-row compact" style={{ marginTop: "10px" }}>
								<div className="setting-label">
									<span>{t("settings.timeline.shareMedicationOverview")}</span>
									<span
										className="info-tooltip small"
										data-tooltip={t("settings.timeline.shareMedicationOverviewDesc")}
									>
										ⓘ
									</span>
								</div>
								<label className="toggle-switch small">
									<input
										type="checkbox"
										checked={settings.shareMedicationOverview}
										onChange={(e) => setSettings({ ...settings, shareMedicationOverview: e.target.checked })}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
							<div className="setting-row compact" style={{ marginTop: "10px" }}>
								<div className="setting-label">
									<span>{t("settings.timeline.shareScheduleTodayOnly")}</span>
									<span className="info-tooltip small" data-tooltip={t("settings.timeline.shareScheduleTodayOnlyDesc")}>
										ⓘ
									</span>
								</div>
								<label className="toggle-switch small">
									<input
										type="checkbox"
										checked={settings.shareScheduleTodayOnly}
										onChange={(e) => setSettings({ ...settings, shareScheduleTodayOnly: e.target.checked })}
									/>
									<span className="toggle-slider"></span>
								</label>
							</div>
						</div>
					</article>

					{/* Export/Import Section */}
					<article className="card" data-testid="settings-danger-zone-card">
						<div className="card-head">
							<h2>
								{t("exportImport.title")}
								<span className="info-tooltip" data-tooltip={t("exportImport.description")}>
									ⓘ
								</span>
							</h2>
						</div>
						<div className="setting-section">
							<div className="setting-group">
								{/* Import Success Message */}
								{importResult && (
									<div
										className="success-banner"
										style={{
											marginBottom: "16px",
											padding: "12px 16px",
											borderRadius: "8px",
											backgroundColor: "var(--success-bg)",
											border: "1px solid var(--success)",
											color: "var(--text-primary)",
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
											<div>
												<strong style={{ display: "block", marginBottom: "4px", color: "var(--success)" }}>
													✓ {t("exportImport.importSuccess")}
												</strong>
												<span style={{ fontSize: "0.9em" }}>
													{t("exportImport.importSuccessDetails", {
														medications: importResult.medications,
														doses: importResult.doses,
														refills: importResult.refills,
														shares: importResult.shares,
													})}
												</span>
											</div>
											<button
												type="button"
												onClick={() => setImportResult(null)}
												aria-label={t("common.close")}
												style={{
													background: "none",
													border: "none",
													cursor: "pointer",
													fontSize: "1.2em",
													padding: "0",
													lineHeight: "1",
													color: "inherit",
													opacity: 0.7,
												}}
											>
												×
											</button>
										</div>
									</div>
								)}
								{/* Export */}
								<div className="action-card">
									<div className="action-card-content">
										<span className="action-card-title">{t("exportImport.exportTitle")}</span>
										<span className="action-card-desc">{t("exportImport.exportDesc")}</span>
									</div>
									<button
										type="button"
										className="secondary"
										onClick={() => setShowExportModal(true)}
										disabled={exporting}
									>
										{exporting ? t("exportImport.exporting") : t("exportImport.export")}
									</button>
								</div>

								{/* Import */}
								<div className="action-card">
									<div className="action-card-content">
										<span className="action-card-title">{t("exportImport.importTitle")}</span>
										<span className="action-card-desc">{t("exportImport.importDesc")}</span>
									</div>
									<input
										type="file"
										id="import-file-input"
										accept=".json,application/json"
										onChange={handleImportFileSelect}
										disabled={importing}
										style={{ display: "none" }}
									/>
									<button
										type="button"
										className="secondary"
										onClick={() => document.getElementById("import-file-input")?.click()}
										disabled={importing}
									>
										{importing ? t("exportImport.importing") : t("exportImport.import")}
									</button>
								</div>
							</div>
						</div>
					</article>
				</div>
			)}

			{/* Import Confirmation Modal */}
			{showImportConfirm && (
				<ConfirmModal
					title={t(hasExistingData ? "exportImport.confirmImport" : "exportImport.confirmImportEmpty")}
					message={
						hasExistingData ? (
							<>
								<p style={{ marginBottom: "12px" }}>{t("exportImport.confirmImportMessage")}</p>
								<p className="warning-text">⚠️ {t("exportImport.confirmImportWarning")}</p>
							</>
						) : (
							<p>{t("exportImport.confirmImportEmptyMessage")}</p>
						)
					}
					confirmLabel={t(hasExistingData ? "exportImport.confirmButton" : "exportImport.confirmButtonEmpty")}
					cancelLabel={t("exportImport.cancelButton")}
					onConfirm={handleImportConfirm}
					onCancel={() => {
						setShowImportConfirm(false);
						setPendingImportData(null);
					}}
					confirmVariant={hasExistingData ? "danger" : "primary"}
				/>
			)}

			{/* Export Options Modal */}
			<ExportModal
				isOpen={showExportModal}
				onClose={() => setShowExportModal(false)}
				onExport={handleExport}
				exporting={exporting}
			/>
		</section>
	);
}
