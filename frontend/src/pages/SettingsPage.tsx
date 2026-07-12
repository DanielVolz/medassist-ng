/* biome-ignore-all lint/a11y/noLabelWithoutControl: settings rows use label-styled text with adjacent custom toggle controls */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import ExportModal from "../components/ExportModal";
import { ImportReviewModal } from "../components/ImportReviewModal";
import { SettingsActionCard, SettingsOptionCard, SettingsSuccessNotice } from "../components/settings/SettingsCards";
import { useAppContext } from "../context";
import { useModalHistory } from "../hooks/useModalHistory";
import { SectionCard } from "../ui/components/SectionCard";
import { AppButton } from "../ui/primitives/AppButton";
import { AppSelect } from "../ui/primitives/AppSelect";
import { AppTooltipIcon } from "../ui/primitives/AppTooltip";
import { StatusBadge } from "../ui/primitives/StatusBadge";
import { getSystemLocale, withFormattingTimezone } from "../utils/formatters";
import classes from "./SettingsPage.module.css";
import surfaceClasses from "./SettingsPageSurfaces.module.css";

type SettingsLanguage = "en" | "de";

function sx(...classNames: Array<string | false | null | undefined>) {
	return classNames.filter(Boolean).join(" ");
}

function surfaceClass(...classNames: Array<string | false | null | undefined>) {
	return sx(...classNames.map((className) => (className ? (surfaceClasses[className] ?? className) : className)));
}

export function SettingsPage() {
	const { t, i18n } = useTranslation();
	const { authFetch } = useAuth();
	const [apiKeyToken, setApiKeyToken] = useState("");
	const [apiKeyGenerating, setApiKeyGenerating] = useState(false);
	const [apiKeyCopied, setApiKeyCopied] = useState(false);
	const [apiKeyError, setApiKeyError] = useState<string | null>(null);
	const {
		settings,
		savedSettings,
		setSettings,
		loadSettings,
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
		importPreview,
		setImportPreview,
		handleImportConfirm,
		importResult,
		setImportResult,
	} = useAppContext();
	const [timezoneTouched, setTimezoneTouched] = useState(false);
	const [timezoneDraft, setTimezoneDraft] = useState("");
	const languageSaveInFlightRef = useRef(false);
	const pendingLanguageRef = useRef<SettingsLanguage | null>(null);

	const formattedImportPreviewDate = importPreview
		? new Date(importPreview.exportedAt).toLocaleString(getSystemLocale(i18n.language))
		: "";

	const flushLanguageSaveQueue = useCallback(
		function flushLanguageSaveQueue() {
			if (languageSaveInFlightRef.current) {
				return;
			}

			const nextLanguage = pendingLanguageRef.current;
			if (!nextLanguage) {
				return;
			}

			pendingLanguageRef.current = null;
			languageSaveInFlightRef.current = true;

			void authFetch("/api/settings/language", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ language: nextLanguage }),
			})
				.then((response) => {
					if (!response.ok) {
						throw new Error(`LANGUAGE_SAVE_FAILED_${response.status}`);
					}
				})
				.catch(() => {
					if (!pendingLanguageRef.current) {
						loadSettings();
					}
				})
				.finally(() => {
					languageSaveInFlightRef.current = false;
					if (pendingLanguageRef.current) {
						flushLanguageSaveQueue();
					}
				});
		},
		[authFetch, loadSettings]
	);

	const handleLanguageChange = useCallback(
		(language: string) => {
			if (language !== "en" && language !== "de") {
				return;
			}

			pendingLanguageRef.current = language;
			setSettings((current) => ({ ...current, language }));
			void i18n.changeLanguage(language);
			flushLanguageSaveQueue();
		},
		[flushLanguageSaveQueue, i18n, setSettings]
	);

	const closeExportModal = useCallback(() => {
		setShowExportModal(false);
	}, [setShowExportModal]);

	const closeImportReview = useCallback(() => {
		setShowImportConfirm(false);
		setPendingImportData(null);
		setImportPreview(null);
	}, [setImportPreview, setPendingImportData, setShowImportConfirm]);

	useModalHistory(showExportModal, "export-options", closeExportModal);
	useModalHistory(showImportConfirm, "import-review", closeImportReview);

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
			const response = await authFetch("/api/auth/api-keys", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
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
	const timezoneStatusClassName = surfaceClass("timezone-status", showTimezoneSaved && "timezone-status-saved");
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
					<SectionCard padding="md">
						<span className="skeleton-line skeleton-line-short" />
						<span className="skeleton-line skeleton-line-medium" />
					</SectionCard>
					<SectionCard padding="md">
						<span className="skeleton-line skeleton-line-short" />
						<span className="skeleton-line skeleton-line-long" />
						<span className="skeleton-line skeleton-line-medium" />
						<span className="skeleton-line skeleton-line-long" />
					</SectionCard>
				</div>
			) : (
				<div className={surfaceClass("settings-form")} data-testid="settings-page">
					{/* Language */}
					<SectionCard title={t("settings.language.title")} contentClassName={classes.languageSettingsContent}>
						<label
							className={surfaceClass("settings-control-row", "language-row")}
							data-testid="settings-language-select"
						>
							<span className={surfaceClass("setting-label")}>{t("settings.language.select")}</span>
							<AppSelect
								value={settings.language}
								size="md"
								onChange={(e) => handleLanguageChange(e.currentTarget.value)}
								classNames={{ root: classes.languageSelectRoot, input: classes.languageSelect }}
								data={[
									{ value: "en", label: "🇬🇧 English" },
									{ value: "de", label: "🇩🇪 Deutsch" },
								]}
							/>
						</label>
						<div className={surfaceClass("settings-control-row", "language-row", "timezone-row")}>
							<div className={surfaceClass("setting-label")}>
								<span>{t("settings.timezone.select")}</span>
								<AppTooltipIcon label={t("settings.timezone.hint")} />
							</div>
							<div className={sx(surfaceClass("setting-actions"), classes.timezoneActions)}>
								<input
									type="text"
									className={sx(classes.languageSelect, classes.timezoneInput)}
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
								<AppButton
									type="button"
									tone="secondary"
									className={classes.timezoneDefaultButton}
									onClick={() => {
										setTimezoneTouched(true);
										setTimezoneDraft("");
										setSettings((prev) => ({ ...prev, timezone: "" }));
									}}
								>
									{t("settings.timezone.useServerDefault")}
								</AppButton>
							</div>
						</div>
						<p className={timezoneStatusClassName}>{timezoneStatusText || " "}</p>
						<p className={surfaceClass("hint-text")} style={{ marginTop: "8px" }}>
							{t("settings.timezone.currentServerTz", { timezone: settings.serverTimezone || "UTC" })}
						</p>
					</SectionCard>

					<SectionCard title={t("settings.apiKey.title")} data-testid="settings-notification-card">
						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("setting-group")} style={{ gridTemplateColumns: "1fr" }}>
								<SettingsActionCard
									title={t("settings.apiKey.generateTitle")}
									description={t("settings.apiKey.generateDesc")}
									action={
										<AppButton type="button" tone="secondary" onClick={generateApiKey} disabled={apiKeyGenerating}>
											{apiKeyGenerating ? t("settings.apiKey.generating") : t("settings.apiKey.generateButton")}
										</AppButton>
									}
								/>

								{apiKeyToken ? (
									<div>
										<span className={surfaceClass("field-label")}>{t("settings.apiKey.currentToken")}</span>
										<div className={surfaceClass("setting-actions", "api-key-actions")}>
											<input
												type="text"
												className={surfaceClass("api-key-token-input")}
												data-testid="settings-api-key-token"
												value={apiKeyToken}
												readOnly
												onClick={(e) => (e.target as HTMLInputElement).select()}
											/>
											<AppButton type="button" tone="secondary" onClick={copyApiKeyToken}>
												{apiKeyCopied ? t("settings.apiKey.copied") : t("settings.apiKey.copyButton")}
											</AppButton>
										</div>
										<p className={surfaceClass("hint-text")}>{t("settings.apiKey.copyHint")}</p>
									</div>
								) : null}

								{apiKeyError ? <p className="danger-text">{apiKeyError}</p> : null}
							</div>
						</div>
					</SectionCard>

					{/* Notifications */}
					<SectionCard title={t("settings.notifications.title")}>
						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.notifications.channels")}</h3>
							</div>
							<div className={surfaceClass("notification-matrix")} data-testid="settings-notification-matrix">
								<div className={surfaceClass("matrix-header")}>
									<div className={surfaceClass("matrix-label")}></div>
									<div className={surfaceClass("matrix-channel")}>{t("settings.notifications.email")}</div>
									<div className={surfaceClass("matrix-channel")}>{t("settings.notifications.push")}</div>
								</div>
								<div className={surfaceClass("matrix-row")}>
									<div className={surfaceClass("matrix-label")}>{t("settings.notifications.stockReminders")}</div>
									<div className={surfaceClass("matrix-cell")}>
										<label className={surfaceClass("toggle-switch", "small", !settings.emailEnabled && "disabled")}>
											<input
												type="checkbox"
												data-testid="settings-email-stock-reminders-toggle"
												checked={settings.emailStockReminders}
												onChange={(e) => setSettings({ ...settings, emailStockReminders: e.target.checked })}
												disabled={!settings.emailEnabled}
											/>
											<span className={surfaceClass("toggle-slider")}></span>
										</label>
									</div>
									<div className={surfaceClass("matrix-cell")}>
										<label className={surfaceClass("toggle-switch", "small", !settings.shoutrrrEnabled && "disabled")}>
											<input
												type="checkbox"
												checked={settings.shoutrrrStockReminders}
												onChange={(e) => setSettings({ ...settings, shoutrrrStockReminders: e.target.checked })}
												disabled={!settings.shoutrrrEnabled}
											/>
											<span className={surfaceClass("toggle-slider")}></span>
										</label>
									</div>
								</div>
								<div className={surfaceClass("matrix-row")}>
									<div className={surfaceClass("matrix-label")}>{t("settings.notifications.intakeReminders")}</div>
									<div className={surfaceClass("matrix-cell")}>
										<label className={surfaceClass("toggle-switch", "small", !settings.emailEnabled && "disabled")}>
											<input
												type="checkbox"
												checked={settings.emailIntakeReminders}
												onChange={(e) => setSettings({ ...settings, emailIntakeReminders: e.target.checked })}
												disabled={!settings.emailEnabled}
											/>
											<span className={surfaceClass("toggle-slider")}></span>
										</label>
									</div>
									<div className={surfaceClass("matrix-cell")}>
										<label className={surfaceClass("toggle-switch", "small", !settings.shoutrrrEnabled && "disabled")}>
											<input
												type="checkbox"
												checked={settings.shoutrrrIntakeReminders}
												onChange={(e) => setSettings({ ...settings, shoutrrrIntakeReminders: e.target.checked })}
												disabled={!settings.shoutrrrEnabled}
											/>
											<span className={surfaceClass("toggle-slider")}></span>
										</label>
									</div>
								</div>
								<div className={surfaceClass("matrix-row")}>
									<div className={surfaceClass("matrix-label")}>
										{t("settings.notifications.prescriptionReminders")}
									</div>
									<div className={surfaceClass("matrix-cell")}>
										<label className={surfaceClass("toggle-switch", "small", !settings.emailEnabled && "disabled")}>
											<input
												type="checkbox"
												checked={settings.emailPrescriptionReminders}
												onChange={(e) => setSettings({ ...settings, emailPrescriptionReminders: e.target.checked })}
												disabled={!settings.emailEnabled}
											/>
											<span className={surfaceClass("toggle-slider")}></span>
										</label>
									</div>
									<div className={surfaceClass("matrix-cell")}>
										<label className={surfaceClass("toggle-switch", "small", !settings.shoutrrrEnabled && "disabled")}>
											<input
												type="checkbox"
												checked={settings.shoutrrrPrescriptionReminders}
												onChange={(e) => setSettings({ ...settings, shoutrrrPrescriptionReminders: e.target.checked })}
												disabled={!settings.shoutrrrEnabled}
											/>
											<span className={surfaceClass("toggle-slider")}></span>
										</label>
									</div>
								</div>
							</div>
							{!settings.emailEnabled && !settings.shoutrrrEnabled && (
								<p className={surfaceClass("hint-text")}>{t("settings.notifications.enableHint")}</p>
							)}

							{/* Skip reminders for taken doses */}
							<div className={surfaceClass("settings-control-row", "compact")} style={{ marginTop: "16px" }}>
								<label className={surfaceClass("setting-label")}>
									{t("settings.notifications.skipTakenDoses")}
									<AppTooltipIcon label={t("settings.notifications.skipTakenDosesTooltip")} />
								</label>
								<label
									className={surfaceClass(
										"toggle-switch",
										"small",
										!settings.emailEnabled && !settings.shoutrrrEnabled && "disabled"
									)}
								>
									<input
										type="checkbox"
										checked={settings.skipRemindersForTakenDoses}
										onChange={(e) => setSettings({ ...settings, skipRemindersForTakenDoses: e.target.checked })}
										disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
									/>
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>

							{/* Repeat reminders for missed doses */}
							<div className={surfaceClass("settings-control-row", "compact")} style={{ marginTop: "12px" }}>
								<label className={surfaceClass("setting-label")}>
									{t("settings.notifications.repeatReminders")}
									<AppTooltipIcon label={t("settings.notifications.repeatRemindersTooltip")} />
								</label>
								<label
									className={surfaceClass(
										"toggle-switch",
										"small",
										!settings.emailEnabled && !settings.shoutrrrEnabled && "disabled"
									)}
								>
									<input
										type="checkbox"
										checked={settings.repeatRemindersEnabled}
										onChange={(e) => setSettings({ ...settings, repeatRemindersEnabled: e.target.checked })}
										disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
									/>
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>

							{/* Reminder interval (only shown when repeat is enabled) */}
							{settings.repeatRemindersEnabled && (
								<>
									<div
										className={surfaceClass("settings-control-row", "compact")}
										style={{ marginTop: "12px", marginLeft: "24px" }}
									>
										<label className={surfaceClass("setting-label")}>
											{t("settings.notifications.reminderInterval")}
											<AppTooltipIcon label={t("settings.notifications.reminderIntervalTooltip")} />
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
									<div
										className={surfaceClass("settings-control-row", "compact")}
										style={{ marginTop: "8px", marginLeft: "24px" }}
									>
										<label className={surfaceClass("setting-label")}>
											{t("settings.notifications.maxNaggingReminders")}
											<AppTooltipIcon label={t("settings.notifications.maxNaggingRemindersTooltip")} />
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

						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.stockReminder.title")}</h3>
							</div>
							<div className={surfaceClass("settings-control-row", "compact")}>
								<label className={surfaceClass("setting-label")}>
									{t("settings.stockReminder.description")}{" "}
									<AppTooltipIcon label={t("settings.stockReminder.infoTooltip")} />{" "}
								</label>
								<label
									className={surfaceClass(
										"toggle-switch",
										"small",
										!settings.emailEnabled && !settings.shoutrrrEnabled && "disabled"
									)}
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
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>

							<div className={surfaceClass("settings-control-row", "compact")} style={{ marginTop: "4px" }}>
								<label className={surfaceClass("setting-label")}>
									{t("settings.stockReminder.repeatDaily")}
									<AppTooltipIcon label={t("settings.stockReminder.repeatTooltip")} />
								</label>
								<label
									className={surfaceClass(
										"toggle-switch",
										"small",
										!(
											(settings.emailEnabled && settings.emailStockReminders) ||
											(settings.shoutrrrEnabled && settings.shoutrrrStockReminders)
										) && "disabled"
									)}
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
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
						</div>

						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.notifications.email")}</h3>
								<label
									className={surfaceClass("toggle-switch", "small", !settings.smtpHost && "disabled")}
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
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
							{emailUnavailableReason && (
								<div className={surfaceClass("setting-actions")}>
									<span className={settingsLoadError ? "danger-text" : "info-text"}>{emailUnavailableReason}</span>
								</div>
							)}
							{settings.emailEnabled && (
								<div className={surfaceClass("setting-group")}>
									<div className={sx(surfaceClass("full"), classes.notificationTestField)}>
										<span className={surfaceClass("field-label")}>
											{t("settings.email.recipient")}
											<AppTooltipIcon
												label={`SMTP: ${settings.smtpHost || t("settings.email.notConfigured")}:${settings.smtpPort}${settings.hasSmtpPassword ? "\nPassword: ✓" : ""}`}
											/>
										</span>
										<div className={classes.notificationTestRow}>
											<input
												type="text"
												className={classes.notificationTestInput}
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
											<AppButton
												type="button"
												tone="secondary"
												className={classes.notificationTestButton}
												onClick={testEmail}
												disabled={testingEmail || !settings.notificationEmail}
											>
												{testingEmail ? t("common.sending") : t("common.test")}
											</AppButton>
											{testEmailResult && (
												<span
													className={sx(
														classes.notificationTestResult,
														testEmailResult.success ? "success-text" : "danger-text"
													)}
												>
													{testEmailResult.message}
												</span>
											)}
										</div>
									</div>
								</div>
							)}
						</div>

						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.notifications.push")}</h3>
								<label className={surfaceClass("toggle-switch", "small")}>
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
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
							{settings.shoutrrrEnabled && (
								<div className={surfaceClass("setting-group")}>
									<div className={sx(surfaceClass("full"), classes.notificationTestField)}>
										<span className={surfaceClass("field-label")}>
											{t("settings.push.url")}
											<AppTooltipIcon label={`${t("settings.push.supports")}\n\n${t("settings.push.docsLink")}`} />
										</span>
										<div className={classes.notificationTestRow}>
											<input
												type="text"
												className={classes.notificationTestInput}
												value={settings.shoutrrrUrl}
												onChange={(e) => setSettings({ ...settings, shoutrrrUrl: e.target.value })}
												placeholder={t("settings.push.urlPlaceholder")}
											/>
											<AppButton
												type="button"
												tone="secondary"
												className={classes.notificationTestButton}
												onClick={testShoutrrr}
												disabled={testingShoutrrr || !settings.shoutrrrUrl}
											>
												{testingShoutrrr ? t("common.sending") : t("common.test")}
											</AppButton>
											{testShoutrrrResult && (
												<span
													className={sx(
														classes.notificationTestResult,
														testShoutrrrResult.success ? "success-text" : "danger-text"
													)}
												>
													{testShoutrrrResult.message}
												</span>
											)}
										</div>
									</div>
								</div>
							)}
						</div>

						<div className={surfaceClass("schedule-overview")}>
							<div className={surfaceClass("schedule-header")}>
								<span className={surfaceClass("schedule-title")}>{t("settings.schedule.title")}</span>
								<AppTooltipIcon label={t("settings.schedule.envHint")} />
							</div>
							<div className={surfaceClass("schedule-row")}>
								<span className={surfaceClass("schedule-label")}>{t("settings.schedule.stockCheck")}</span>
								<span className={surfaceClass("schedule-value")}>
									{t("settings.schedule.dailyAtHour", { hour: settings.reminderHour })}
								</span>
							</div>
							<div className={surfaceClass("schedule-row")}>
								<span className={surfaceClass("schedule-label")}>{t("settings.schedule.intakeCheck")}</span>
								<span className={surfaceClass("schedule-value")}>
									{t("settings.schedule.minutesBefore", { minutes: settings.reminderMinutesBefore })}
								</span>
							</div>
							{settings.nextScheduledCheck && (
								<div className={surfaceClass("schedule-row")}>
									<span className={surfaceClass("schedule-label")}>{t("settings.schedule.nextCheck")}</span>
									<span className={surfaceClass("schedule-value")}>
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
								<div className={surfaceClass("schedule-row")}>
									<span className={surfaceClass("schedule-label")}>{t("settings.schedule.lastStockSent")}</span>
									<span className={surfaceClass("schedule-value")}>
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
								<div className={surfaceClass("schedule-row")}>
									<span className={surfaceClass("schedule-label")}>{t("settings.schedule.lastIntakeSent")}</span>
									<span className={surfaceClass("schedule-value")}>
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
								<div className={surfaceClass("schedule-row")}>
									<span className={surfaceClass("schedule-label")}>{t("settings.schedule.lastPrescriptionSent")}</span>
									<span className={surfaceClass("schedule-value")}>
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
					</SectionCard>

					{/* Stock Settings */}
					<SectionCard title={t("settings.stock.title")} data-testid="settings-security-card">
						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.stock.calculationMode")}</h3>
							</div>
							<div
								className={surfaceClass("setting-group", "calculation-mode-group")}
								data-testid="settings-calculation-mode"
							>
								<SettingsOptionCard
									id={automaticStockCalculationId}
									name="stockCalculationMode"
									value="automatic"
									checked={settings.stockCalculationMode === "automatic"}
									title={t("settings.stock.automatic")}
									description={t("settings.stock.automaticDesc")}
									onChange={(value) =>
										setSettings({ ...settings, stockCalculationMode: value as "automatic" | "manual" })
									}
								/>
								<SettingsOptionCard
									id={manualStockCalculationId}
									name="stockCalculationMode"
									value="manual"
									checked={settings.stockCalculationMode === "manual"}
									title={t("settings.stock.manual")}
									description={t("settings.stock.manualDesc")}
									onChange={(value) =>
										setSettings({ ...settings, stockCalculationMode: value as "automatic" | "manual" })
									}
								/>
							</div>
						</div>

						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.stock.thresholds")}</h3>
							</div>
							<div className={surfaceClass("setting-group", "threshold-chips-group")}>
								<div
									className={surfaceClass(settings.reminderDaysBefore >= settings.lowStockDays && "threshold-invalid")}
									data-testid="settings-threshold-critical"
								>
									<span className={surfaceClass("field-label", "threshold-chip-label")}>
										<StatusBadge size="xs" tone="danger">
											{t("status.criticalStock")}
										</StatusBadge>
										<AppTooltipIcon label={t("settings.stock.criticalStockTooltip")} />
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
									className={surfaceClass(
										settings.lowStockDays <= settings.reminderDaysBefore ||
											settings.lowStockDays >= settings.highStockDays
											? "threshold-invalid"
											: ""
									)}
									data-testid="settings-threshold-low"
								>
									<span className={surfaceClass("field-label", "threshold-chip-label")}>
										<StatusBadge size="xs" tone="warning">
											{t("status.lowStock")}
										</StatusBadge>
										<AppTooltipIcon label={t("settings.stock.lowStockTooltip")} />
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
									className={surfaceClass(settings.highStockDays <= settings.lowStockDays && "threshold-invalid")}
									data-testid="settings-threshold-high"
								>
									<span className={surfaceClass("field-label", "threshold-chip-label")}>
										<StatusBadge size="xs" tone="high">
											{t("status.highStock")}
										</StatusBadge>
										<AppTooltipIcon label={t("settings.stock.highStockTooltip")} />
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
								<p className={surfaceClass("threshold-validation-error")} data-testid="settings-threshold-validation">
									{t("settings.stock.thresholdValidation")}
								</p>
							)}
							<p className={surfaceClass("hint-text")} style={{ marginTop: "12px" }}>
								ℹ️ {t("settings.stock.packageTypesNote")}
							</p>
						</div>
					</SectionCard>

					{/* General UI */}
					<SectionCard title={t("settings.timeline.title")}>
						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.timeline.dashboardSectionOrder")}</h3>
							</div>
							<div className={surfaceClass("settings-control-row", "compact")}>
								<div className={surfaceClass("setting-label")}>
									<span>{t("settings.timeline.swapDashboardSections")}</span>
									<AppTooltipIcon label={t("settings.timeline.swapDashboardSectionsDesc")} />
								</div>
								<label className={surfaceClass("toggle-switch", "small")}>
									<input
										type="checkbox"
										checked={settings.swapDashboardMainSections}
										onChange={(e) => setSettings({ ...settings, swapDashboardMainSections: e.target.checked })}
									/>
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
						</div>

						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.timeline.upcomingSection")}</h3>
							</div>
							<div className={surfaceClass("settings-control-row", "compact")}>
								<div className={surfaceClass("setting-label")}>
									<span>{t("settings.timeline.upcomingTodayOnly")}</span>
									<AppTooltipIcon label={t("settings.timeline.upcomingTodayOnlyDesc")} />
								</div>
								<label className={surfaceClass("toggle-switch", "small")}>
									<input
										type="checkbox"
										checked={settings.upcomingTodayOnly}
										onChange={(e) => setSettings({ ...settings, upcomingTodayOnly: e.target.checked })}
									/>
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
						</div>

						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("section-header")}>
								<h3>{t("settings.timeline.sharedSection")}</h3>
							</div>
							<div className={surfaceClass("settings-control-row", "compact")} style={{ marginTop: "10px" }}>
								<div className={surfaceClass("setting-label")}>
									<span>{t("settings.timeline.shareMedicationOverview")}</span>
									<AppTooltipIcon label={t("settings.timeline.shareMedicationOverviewDesc")} />
								</div>
								<label className={surfaceClass("toggle-switch", "small")}>
									<input
										type="checkbox"
										checked={settings.shareMedicationOverview}
										onChange={(e) => setSettings({ ...settings, shareMedicationOverview: e.target.checked })}
									/>
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
							<div className={surfaceClass("settings-control-row", "compact")} style={{ marginTop: "10px" }}>
								<div className={surfaceClass("setting-label")}>
									<span>{t("settings.timeline.shareScheduleTodayOnly")}</span>
									<AppTooltipIcon label={t("settings.timeline.shareScheduleTodayOnlyDesc")} />
								</div>
								<label className={surfaceClass("toggle-switch", "small")}>
									<input
										type="checkbox"
										checked={settings.shareScheduleTodayOnly}
										onChange={(e) => setSettings({ ...settings, shareScheduleTodayOnly: e.target.checked })}
									/>
									<span className={surfaceClass("toggle-slider")}></span>
								</label>
							</div>
						</div>
					</SectionCard>

					{/* Export/Import Section */}
					<SectionCard
						title={
							<>
								{t("exportImport.title")}
								<AppTooltipIcon label={t("exportImport.description")} />
							</>
						}
						data-testid="settings-danger-zone-card"
					>
						<div className={surfaceClass("setting-section")}>
							<div className={surfaceClass("setting-group")}>
								<input
									type="file"
									id="import-file-input"
									accept=".json,application/json"
									onChange={handleImportFileSelect}
									disabled={importing}
									style={{ display: "none" }}
								/>
								{/* Import Success Message */}
								{importResult && (
									<SettingsSuccessNotice
										title={`✓ ${t("exportImport.importSuccess")}`}
										closeLabel={t("common.close")}
										onClose={() => setImportResult(null)}
									>
										{t("exportImport.importSuccessDetails", {
											medications: importResult.medications,
											doses: importResult.doses,
											refills: importResult.refills,
											shares: importResult.shares,
										})}
									</SettingsSuccessNotice>
								)}
								{/* Export */}
								<SettingsActionCard
									title={t("exportImport.exportTitle")}
									description={t("exportImport.exportDesc")}
									action={
										<AppButton
											className="secondary"
											type="button"
											tone="secondary"
											onClick={() => setShowExportModal(true)}
											disabled={exporting}
										>
											{exporting ? t("exportImport.exporting") : t("exportImport.export")}
										</AppButton>
									}
								/>

								{/* Import */}
								<SettingsActionCard
									title={t("exportImport.importTitle")}
									description={t("exportImport.importDesc")}
									action={
										<AppButton
											className="secondary"
											type="button"
											tone="secondary"
											onClick={() => document.getElementById("import-file-input")?.click()}
											disabled={importing}
										>
											{importing ? t("exportImport.importing") : t("exportImport.import")}
										</AppButton>
									}
								/>
							</div>
						</div>
					</SectionCard>
				</div>
			)}

			<ImportReviewModal
				isOpen={showImportConfirm}
				importPreview={importPreview}
				formattedExportedAt={formattedImportPreviewDate}
				importing={importing}
				exporting={exporting}
				onClose={closeImportReview}
				onBackup={() => handleExport(true, false)}
				onConfirm={handleImportConfirm}
			/>

			{/* Export Options Modal */}
			<ExportModal isOpen={showExportModal} onClose={closeExportModal} onExport={handleExport} exporting={exporting} />
		</section>
	);
}
