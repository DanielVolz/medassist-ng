/**
 * ShareDialog - Modal for generating share links for medication schedules
 * Allows sharing schedule view for a specific person
 */

import { Alert } from "@mantine/core";
import { Check, Copy, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalHistory } from "../hooks/useModalHistory";
import type { ActiveShareLink } from "../hooks/useShare";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { AppTooltip } from "../ui/primitives/AppTooltip";
import { formatDisplayDate, getSystemLocale } from "../utils/formatters";
import { ConfirmModal } from "./ConfirmModal";
import classes from "./ShareDialog.module.css";

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
	shareAllowMarkTaken: boolean;
	onShareAllowMarkTakenChange: (enabled: boolean) => void;
	shareGenerating: boolean;
	shareLink: string | null;
	onShareLinkChange: (link: string | null) => void;
	shareCopied: boolean;
	onShareCopiedChange: (copied: boolean) => void;
	activeShareLinks: ActiveShareLink[];
	activeSharesLoading: boolean;
	revokingShareToken: string | null;
	regeneratingShareToken: string | null;
	onClose: () => void;
	onGenerateShareLink: () => Promise<void>;
	onRevokeShareLink: (token: string) => Promise<boolean>;
	onRegenerateShareLink: (token: string) => Promise<boolean>;
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
	shareAllowMarkTaken,
	onShareAllowMarkTakenChange,
	shareGenerating,
	shareLink,
	onShareLinkChange,
	shareCopied,
	onShareCopiedChange,
	activeShareLinks,
	activeSharesLoading,
	revokingShareToken,
	regeneratingShareToken,
	onClose,
	onGenerateShareLink,
	onRevokeShareLink,
	onRegenerateShareLink,
	onCopyShareLink,
}: ShareDialogProps) {
	const { t, i18n } = useTranslation();
	const [manageLinksOpen, setManageLinksOpen] = useState(false);
	const [shareToRevoke, setShareToRevoke] = useState<ActiveShareLink | null>(null);
	const [shareToRegenerate, setShareToRegenerate] = useState<ActiveShareLink | null>(null);
	const displayLocale = getSystemLocale(i18n.language);
	const closeLabel = t("common.close");
	const copyLabel = shareCopied ? t("share.copied") : t("share.copyLink");
	const getPersonLabel = (person: string) => (person === "all" ? t("share.allPeople") : person);
	const closeRevokeConfirm = useCallback(() => {
		if (shareToRevoke && revokingShareToken !== shareToRevoke.token) {
			setShareToRevoke(null);
		}
	}, [revokingShareToken, shareToRevoke]);
	const closeRegenerateConfirm = useCallback(() => {
		if (shareToRegenerate && regeneratingShareToken !== shareToRegenerate.token) {
			setShareToRegenerate(null);
		}
	}, [regeneratingShareToken, shareToRegenerate]);

	useModalHistory(show && Boolean(shareToRevoke), "share-revoke", closeRevokeConfirm);
	useModalHistory(show && Boolean(shareToRegenerate), "share-regenerate", closeRegenerateConfirm);

	useEffect(() => {
		if (!show) {
			setShareToRevoke(null);
			setShareToRegenerate(null);
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
			<ul className={classes.activeList}>
				{activeShareLinks.map((share) => {
					const personLabel = getPersonLabel(share.takenBy);
					const createdAtLabel = formatDisplayDate(share.createdAt, displayLocale);
					const expiresAtLabel = share.expiresAt ? formatDisplayDate(share.expiresAt, displayLocale) : null;
					const lastUsedAtLabel = share.lastUsedAt ? formatDisplayDate(share.lastUsedAt, displayLocale) : null;
					let expiryLabel = t("share.expiryNever");
					if (share.legacyNeverExpires) {
						expiryLabel = t("share.activeLinkLegacyExpiry");
					}
					if (expiresAtLabel) {
						expiryLabel = expiresAtLabel;
					}
					const permissionLabels = [
						share.allowMarkTaken ? t("share.markTakenEnabled") : t("share.readOnly"),
						share.allowJournalNotes ? t("share.journalNotesEnabled") : null,
					].filter((permission): permission is string => permission !== null);

					return (
						<li key={share.token} className={classes.activeItem}>
							<div className={classes.activeCopy}>
								<div className={classes.activeHeading}>
									<a href={`${window.location.origin}${share.shareUrl}`} className={classes.linkInline}>
										{personLabel}
									</a>
									<span className={classes.periodPill}>{t("share.activeLinkDays", { count: share.scheduleDays })}</span>
								</div>
								<dl className={classes.activeMetaGrid}>
									<div className={classes.metaCell}>
										<dt>{t("share.activeLinkCreatedLabel")}</dt>
										<dd>{createdAtLabel}</dd>
									</div>
									<div className={classes.metaCell}>
										<dt>{t("share.activeLinkExpiresLabel")}</dt>
										<dd>{expiryLabel}</dd>
									</div>
									{lastUsedAtLabel ? (
										<div className={classes.metaCell}>
											<dt>{t("share.activeLinkLastUsedLabel")}</dt>
											<dd>{lastUsedAtLabel}</dd>
										</div>
									) : null}
								</dl>
								<div className={classes.permissionsBlock}>
									<span className={classes.permissionsLabel}>{t("share.activeLinkPermissionsLabel")}</span>
									<div className={classes.permissionChips}>
										{permissionLabels.map((permission) => (
											<span key={permission} className={classes.permissionChip}>
												{permission}
											</span>
										))}
									</div>
								</div>
							</div>
							<div className={classes.activeActions}>
								<AppButton
									type="button"
									leftSection={<RefreshCw size={14} aria-hidden="true" />}
									size="xs"
									tone="secondary"
									disabled={regeneratingShareToken === share.token || revokingShareToken === share.token}
									onClick={() => setShareToRegenerate(share)}
								>
									{regeneratingShareToken === share.token ? t("share.regenerating") : t("share.regenerate")}
								</AppButton>
								<AppButton
									type="button"
									leftSection={<Trash2 size={14} aria-hidden="true" />}
									size="xs"
									tone="secondary"
									disabled={revokingShareToken === share.token || regeneratingShareToken === share.token}
									onClick={() => setShareToRevoke(share)}
								>
									{revokingShareToken === share.token ? t("share.revoking") : t("share.revoke")}
								</AppButton>
							</div>
						</li>
					);
				})}
			</ul>
		);
	};

	const renderManageLinks = () => (
		<div className={classes.manage}>
			<button
				type="button"
				className={classes.manageSummary}
				onClick={() => setManageLinksOpen((current) => !current)}
				aria-expanded={manageLinksOpen}
			>
				<span>{t("share.manageLinksSummary", { count: activeShareLinks.length })}</span>
				<span className={classes.manageCount}>{manageLinksOpen ? t("common.hide") : activeShareLinks.length}</span>
			</button>
			{manageLinksOpen ? <div className={classes.manageContent}>{renderActiveShares()}</div> : null}
		</div>
	);

	return (
		<AppModal
			classNames={{
				body: classes.modalBody,
				header: classes.modalHeader,
				title: classes.modalTitle,
			}}
			contentClassName={classes.modal}
			onClose={onClose}
			opened={show}
			closeButtonProps={{ "aria-label": closeLabel }}
			closeOnEscape={false}
			lockScroll={false}
			manageEscape={false}
			manageScrollLock={false}
			size={640}
			title={
				<span className={classes.titleLine}>
					<Link2 size={18} aria-hidden="true" /> {t("share.title")}
				</span>
			}
			withCloseButton
		>
			<div className={classes.header}>
				<p className={classes.description}>{t("share.description")}</p>
			</div>

			{(() => {
				if (sharePeople.length === 0) {
					return (
						<div className={classes.empty}>
							<p>{t("share.noPeople")}</p>
							<div className={classes.activeLinks}>{renderManageLinks()}</div>
						</div>
					);
				}
				if (shareLink) {
					return (
						<>
							<div className={classes.result}>
								<Alert color="green" variant="light">
									{t("share.linkGenerated")}
								</Alert>
								<p className={classes.linkLabel}>{t("share.scheduleLink")}</p>
								<div className={classes.linkBox}>
									<input
										type="text"
										value={shareLink}
										readOnly
										className={`${classes.linkInput} share-link-input`}
										onClick={(e) => (e.target as HTMLInputElement).select()}
									/>
									<AppTooltip label={copyLabel}>
										<button
											type="button"
											className={`${classes.copyButton} btn-copy`}
											onClick={onCopyShareLink}
											aria-label={copyLabel}
										>
											{shareCopied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
										</button>
									</AppTooltip>
								</div>
								{shareCopied && <span className={classes.copiedHint}>{t("share.copied")}</span>}
								<div className={classes.activeLinks}>{renderManageLinks()}</div>
							</div>
							<AppModalFooter>
								<AppButton
									type="button"
									tone="ghost"
									onClick={() => {
										onShareLinkChange(null);
										onShareCopiedChange(false);
									}}
								>
									{t("share.generateAnother")}
								</AppButton>
								<AppButton type="button" onClick={onClose} tone="secondary">
									{t("common.close")}
								</AppButton>
							</AppModalFooter>
						</>
					);
				}
				return (
					<>
						<div className={classes.form}>
							<div className={classes.formGroup}>
								<label htmlFor="share-person-select">{t("share.selectPerson")}</label>
								<select
									id="share-person-select"
									className={classes.selectField}
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

							<div className={classes.formGroup}>
								<label htmlFor="share-period-select">{t("share.selectPeriod")}</label>
								<select
									id="share-period-select"
									className={classes.selectField}
									value={shareSelectedDays}
									onChange={(e) => onShareSelectedDaysChange(Number(e.target.value))}
								>
									<option value={30}>{t("dashboard.schedules.1month")}</option>
									<option value={90}>{t("dashboard.schedules.3months")}</option>
									<option value={180}>{t("dashboard.schedules.6months")}</option>
								</select>
							</div>

							<div className={classes.formGroup}>
								<label htmlFor="share-expiry-select">{t("share.selectExpiry")}</label>
								<select
									id="share-expiry-select"
									className={classes.selectField}
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
								{shareSelectedExpiryDays == null ? (
									<p className={classes.warningText}>{t("share.neverExpiresWarning")}</p>
								) : null}
							</div>

							<label className={classes.inlineCheckbox} htmlFor="share-mark-taken-toggle">
								<input
									id="share-mark-taken-toggle"
									type="checkbox"
									checked={shareAllowMarkTaken}
									onChange={(event) => onShareAllowMarkTakenChange(event.target.checked)}
								/>
								<span>{t("share.allowMarkTaken")}</span>
							</label>

							<label className={classes.inlineCheckbox} htmlFor="share-journal-notes-toggle">
								<input
									id="share-journal-notes-toggle"
									type="checkbox"
									checked={shareAllowJournalNotes}
									onChange={(event) => onShareAllowJournalNotesChange(event.target.checked)}
								/>
								<span>{t("share.allowJournalNotes")}</span>
							</label>

							<div className={classes.activeLinks}>{renderManageLinks()}</div>
						</div>
						<AppModalFooter>
							<AppButton type="button" tone="secondary" onClick={onClose}>
								{t("common.close")}
							</AppButton>
							<AppButton type="button" onClick={onGenerateShareLink} disabled={shareGenerating || !shareSelectedPerson}>
								{shareGenerating ? t("share.generating") : t("share.generateLink")}
							</AppButton>
						</AppModalFooter>
					</>
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
			{shareToRegenerate && (
				<ConfirmModal
					title={t("share.regenerate")}
					message={t("share.regenerateConfirm", { person: getPersonLabel(shareToRegenerate.takenBy) })}
					confirmLabel={
						regeneratingShareToken === shareToRegenerate.token ? t("share.regenerating") : t("share.regenerate")
					}
					cancelLabel={t("common.cancel")}
					onConfirm={async () => {
						const regenerated = await onRegenerateShareLink(shareToRegenerate.token);
						if (regenerated) {
							setShareToRegenerate(null);
						}
					}}
					onCancel={closeRegenerateConfirm}
					isLoading={regeneratingShareToken === shareToRegenerate.token}
					overlayClassName="nested-confirm"
				/>
			)}
		</AppModal>
	);
}
