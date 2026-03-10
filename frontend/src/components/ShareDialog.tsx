/**
 * ShareDialog - Modal for generating share links for medication schedules
 * Allows sharing schedule view for a specific person
 */

import { Check, Copy, Link2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ShareDialogProps {
	show: boolean;
	sharePeople: string[];
	shareSelectedPerson: string;
	onShareSelectedPersonChange: (person: string) => void;
	shareSelectedDays: number;
	onShareSelectedDaysChange: (days: number) => void;
	shareGenerating: boolean;
	shareLink: string | null;
	onShareLinkChange: (link: string | null) => void;
	shareCopied: boolean;
	onShareCopiedChange: (copied: boolean) => void;
	onClose: () => void;
	onGenerateShareLink: () => Promise<void>;
	onCopyShareLink: () => void;
}

export function ShareDialog({
	show,
	sharePeople,
	shareSelectedPerson,
	onShareSelectedPersonChange,
	shareSelectedDays,
	onShareSelectedDaysChange,
	shareGenerating,
	shareLink,
	onShareLinkChange,
	shareCopied,
	onShareCopiedChange,
	onClose,
	onGenerateShareLink,
	onCopyShareLink,
}: ShareDialogProps) {
	const { t } = useTranslation();
	const [overviewCopied, setOverviewCopied] = useState(false);
	const closeLabel = t("common.close");
	const copyLabel = shareCopied ? t("share.copied") : t("share.copyLink");
	const overviewCopyLabel = overviewCopied ? t("share.copied") : t("share.copyOverviewLink");
	const overviewLink = shareLink ? `${shareLink}/overview` : null;

	useEffect(() => {
		if (!shareLink) {
			setOverviewCopied(false);
		}
	}, [shareLink]);

	const copyOverviewLink = async () => {
		if (!overviewLink) return;

		const markCopied = () => {
			setOverviewCopied(true);
			setTimeout(() => setOverviewCopied(false), 2000);
		};

		if (navigator.clipboard?.writeText) {
			try {
				await navigator.clipboard.writeText(overviewLink);
				markCopied();
				return;
			} catch {
				// Fall back to textarea-based copy.
			}
		}

		const textarea = document.createElement("textarea");
		textarea.value = overviewLink;
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

	// ESC is handled by the global handler in App.tsx to avoid double history.back()

	if (!show) return null;

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key !== "Escape") e.stopPropagation();
			}}
		>
			<div
				className="modal-content share-dialog-modal"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<button
					type="button"
					className="modal-close tooltip-trigger"
					onClick={onClose}
					aria-label={closeLabel}
					data-tooltip={closeLabel}
				>
					<X size={18} aria-hidden="true" />
				</button>

				<div className="share-dialog-header">
					<h2>
						<Link2 size={18} aria-hidden="true" /> {t("share.title")}
					</h2>
					<p className="share-dialog-description">{t("share.description")}</p>
				</div>

				{(() => {
					if (sharePeople.length === 0) {
						return (
							<div className="share-dialog-empty">
								<p>{t("share.noPeople")}</p>
							</div>
						);
					}
					if (shareLink) {
						return (
							<div className="share-dialog-result">
								<p className="share-success">{t("share.linkGenerated")}</p>
								<p className="share-link-label">{t("share.scheduleLink")}</p>
								<div className="share-link-box">
									<input
										type="text"
										value={shareLink}
										readOnly
										className="share-link-input"
										onClick={(e) => (e.target as HTMLInputElement).select()}
									/>
									<button
										type="button"
										className="btn-copy icon-only tooltip-trigger"
										onClick={onCopyShareLink}
										aria-label={copyLabel}
										data-tooltip={copyLabel}
									>
										{shareCopied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
									</button>
								</div>
								<p className="share-link-label">{t("share.overviewLink")}</p>
								<div className="share-link-box">
									<input
										type="text"
										value={overviewLink ?? ""}
										readOnly
										className="share-link-input"
										onClick={(e) => (e.target as HTMLInputElement).select()}
									/>
									<button
										type="button"
										className="btn-copy icon-only tooltip-trigger"
										onClick={copyOverviewLink}
										aria-label={overviewCopyLabel}
										data-tooltip={overviewCopyLabel}
									>
										{overviewCopied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
									</button>
								</div>
								{shareCopied && <span className="share-copied-hint">{t("share.copied")}</span>}
								{overviewCopied && <span className="share-copied-hint">{t("share.copied")}</span>}
								<div className="share-dialog-footer">
									<button
										className="ghost"
										onClick={() => {
											onShareLinkChange(null);
											onShareCopiedChange(false);
											setOverviewCopied(false);
										}}
									>
										{t("share.generateAnother")}
									</button>
									<button onClick={onClose}>{t("common.close")}</button>
								</div>
							</div>
						);
					}
					return (
						<div className="share-dialog-form">
							<div className="form-group">
								<label htmlFor="share-person-select">{t("share.selectPerson")}</label>
								<select
									id="share-person-select"
									className="select-field"
									value={shareSelectedPerson}
									onChange={(e) => onShareSelectedPersonChange(e.target.value)}
								>
									{sharePeople.map((person) => (
										<option key={person} value={person}>
											{person}
										</option>
									))}
								</select>
							</div>

							<div className="form-group">
								<label htmlFor="share-period-select">{t("share.selectPeriod")}</label>
								<select
									id="share-period-select"
									className="select-field"
									value={shareSelectedDays}
									onChange={(e) => onShareSelectedDaysChange(Number(e.target.value))}
								>
									<option value={30}>{t("dashboard.schedules.1month")}</option>
									<option value={90}>{t("dashboard.schedules.3months")}</option>
									<option value={180}>{t("dashboard.schedules.6months")}</option>
								</select>
							</div>

							<div className="share-dialog-footer">
								<button className="ghost" onClick={onClose}>
									{t("common.close")}
								</button>
								<button onClick={onGenerateShareLink} disabled={shareGenerating || !shareSelectedPerson}>
									{shareGenerating ? t("share.generating") : t("share.generateLink")}
								</button>
							</div>
						</div>
					);
				})()}
			</div>
		</div>
	);
}
