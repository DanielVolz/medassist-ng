/**
 * ShareDialog - Modal for generating share links for medication schedules
 * Allows sharing schedule view for a specific person
 */

import { Check, Copy, Link2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalHistory } from "../hooks";
import type { ActiveShareLink } from "../hooks/useShare";
import { ConfirmModal } from "./ConfirmModal";

export interface ShareDialogProps {
	show: boolean;
	sharePeople: string[];
	shareSelectedPerson: string;
	onShareSelectedPersonChange: (person: string) => void;
	shareSelectedDays: number;
	onShareSelectedDaysChange: (days: number) => void;
	shareSelectedExpiryDays: number | null;
	onShareSelectedExpiryDaysChange: (days: number | null) => void;
	shareAllowJournalNotes: boolean;
	onShareAllowJournalNotesChange: (enabled: boolean) => void;
	shareGenerating: boolean;
	shareLink: string | null;
	onShareLinkChange: (link: string | null) => void;
	shareCopied: boolean;
	onShareCopiedChange: (copied: boolean) => void;
	activeShareLinks: ActiveShareLink[];
	activeSharesLoading: boolean;
	revokingShareToken: string | null;
	onClose: () => void;
	onGenerateShareLink: () => Promise<void>;
	onRevokeShareLink: (token: string) => Promise<boolean>;
	onCopyShareLink: () => void;
}

export function ShareDialog({
	show,
	sharePeople,
	shareSelectedPerson,
	onShareSelectedPersonChange,
	shareSelectedDays,
	onShareSelectedDaysChange,
	shareSelectedExpiryDays,
	onShareSelectedExpiryDaysChange,
	shareAllowJournalNotes,
	onShareAllowJournalNotesChange,
	shareGenerating,
	shareLink,
	onShareLinkChange,
	shareCopied,
	onShareCopiedChange,
	activeShareLinks,
	activeSharesLoading,
	revokingShareToken,
	onClose,
	onGenerateShareLink,
	onRevokeShareLink,
	onCopyShareLink,
}: ShareDialogProps) {
	const { t } = useTranslation();
	const [manageLinksOpen, setManageLinksOpen] = useState(false);
	const [shareToRevoke, setShareToRevoke] = useState<ActiveShareLink | null>(null);
	const closeLabel = t("common.close");
	const copyLabel = shareCopied ? t("share.copied") : t("share.copyLink");
	const getPersonLabel = (person: string) => (person === "all" ? t("share.allPeople") : person);
	const closeRevokeConfirm = useCallback(() => {
		if (shareToRevoke && revokingShareToken !== shareToRevoke.token) {
			setShareToRevoke(null);
		}
	}, [revokingShareToken, shareToRevoke]);

	useModalHistory(show && Boolean(shareToRevoke), "share-revoke", closeRevokeConfirm);

	useEffect(() => {
		if (!show) {
			setShareToRevoke(null);
		}
	}, [show]);

	// ESC is handled by the global handler in App.tsx to avoid double history.back()

	if (!show) return null;

	const renderActiveShares = () => {
		if (activeSharesLoading) {
			return <p>{t("share.loadingActiveLinks")}</p>;
		}

		if (activeShareLinks.length === 0) {
			return <p>{t("share.noActiveLinks")}</p>;
		}

		return (
			<ul className="share-active-list">
				{activeShareLinks.map((share) => {
					const personLabel = getPersonLabel(share.takenBy);
					const createdAtLabel = new Date(share.createdAt).toLocaleDateString();
					const expiresAtLabel = share.expiresAt ? new Date(share.expiresAt).toLocaleDateString() : null;
					return (
						<li key={share.token} className="share-active-item">
							<div className="share-active-copy">
								<a href={`${window.location.origin}${share.shareUrl}`} className="share-link-inline">
									{personLabel}
								</a>
								<span className="hint-text">
									{expiresAtLabel
										? t("share.activeLinkMetaWithExpiry", {
												person: personLabel,
												days: share.scheduleDays,
												createdAt: createdAtLabel,
												expiresAt: expiresAtLabel,
											})
										: t("share.activeLinkMeta", {
												person: personLabel,
												days: share.scheduleDays,
												createdAt: createdAtLabel,
											})}
									{share.allowJournalNotes ? ` · ${t("share.journalNotesEnabled")}` : ""}
								</span>
							</div>
							<button
								type="button"
								className="ghost"
								disabled={revokingShareToken === share.token}
								onClick={() => setShareToRevoke(share)}
							>
								{revokingShareToken === share.token ? t("share.revoking") : t("share.revoke")}
							</button>
						</li>
					);
				})}
			</ul>
		);
	};

	const renderManageLinks = () => (
		<div className="share-dialog-manage">
			<button
				type="button"
				className="share-dialog-manage-summary"
				onClick={() => setManageLinksOpen((current) => !current)}
				aria-expanded={manageLinksOpen}
			>
				<span>{t("share.manageLinksSummary", { count: activeShareLinks.length })}</span>
				<span className="share-dialog-manage-count">
					{manageLinksOpen ? t("common.hide") : activeShareLinks.length}
				</span>
			</button>
			{manageLinksOpen ? <div className="share-dialog-manage-content">{renderActiveShares()}</div> : null}
		</div>
	);

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
								<div className="share-dialog-active-links">{renderManageLinks()}</div>
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
								{shareCopied && <span className="share-copied-hint">{t("share.copied")}</span>}
								<div className="share-dialog-footer">
									<button
										className="ghost"
										onClick={() => {
											onShareLinkChange(null);
											onShareCopiedChange(false);
										}}
									>
										{t("share.generateAnother")}
									</button>
									<button onClick={onClose}>{t("common.close")}</button>
								</div>
								<div className="share-dialog-active-links">{renderManageLinks()}</div>
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
											{getPersonLabel(person)}
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

							<div className="form-group">
								<label htmlFor="share-expiry-select">{t("share.selectExpiry")}</label>
								<select
									id="share-expiry-select"
									className="select-field"
									value={shareSelectedExpiryDays == null ? "never" : String(shareSelectedExpiryDays)}
									onChange={(e) =>
										onShareSelectedExpiryDaysChange(e.target.value === "never" ? null : Number(e.target.value))
									}
								>
									<option value="never">{t("share.expiryNever")}</option>
									<option value="7">{t("share.expiry7Days")}</option>
									<option value="30">{t("share.expiry30Days")}</option>
									<option value="90">{t("share.expiry90Days")}</option>
								</select>
							</div>

							<label className="inline-checkbox" htmlFor="share-journal-notes-toggle">
								<input
									id="share-journal-notes-toggle"
									type="checkbox"
									checked={shareAllowJournalNotes}
									onChange={(event) => onShareAllowJournalNotesChange(event.target.checked)}
								/>
								<span>{t("share.allowJournalNotes")}</span>
							</label>

							<div className="share-dialog-footer">
								<button className="ghost" onClick={onClose}>
									{t("common.close")}
								</button>
								<button onClick={onGenerateShareLink} disabled={shareGenerating || !shareSelectedPerson}>
									{shareGenerating ? t("share.generating") : t("share.generateLink")}
								</button>
							</div>
							<div className="share-dialog-active-links">{renderManageLinks()}</div>
						</div>
					);
				})()}
				{shareToRevoke && (
					<ConfirmModal
						title={t("share.revoke")}
						message={t("share.revokeConfirm", { person: getPersonLabel(shareToRevoke.takenBy) })}
						confirmLabel={revokingShareToken === shareToRevoke.token ? t("share.revoking") : t("share.revoke")}
						cancelLabel={t("common.cancel")}
						onConfirm={async () => {
							const revoked = await onRevokeShareLink(shareToRevoke.token);
							if (revoked) {
								setShareToRevoke(null);
							}
						}}
						onCancel={closeRevokeConfirm}
						isLoading={revokingShareToken === shareToRevoke.token}
						confirmVariant="danger"
						overlayClassName="nested-confirm"
					/>
				)}
			</div>
		</div>
	);
}
