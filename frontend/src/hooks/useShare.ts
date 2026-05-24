// =============================================================================
// useShare Hook - Share dialog state and operations
// =============================================================================

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { useFeedback } from "../context/FeedbackContext";
import type { Medication } from "../types";
import { withCorrelation } from "../utils/correlation";
import { log } from "../utils/logger";

const SHARE_ALL_VALUE = "all";

export interface ActiveShareLink {
	token: string;
	takenBy: string;
	scheduleDays: number;
	createdAt: string;
	expiresAt: string | null;
	allowJournalNotes: boolean;
	shareUrl: string;
}

export interface UseShareReturn {
	showShareDialog: boolean;
	sharePeople: string[];
	shareSelectedPerson: string;
	setShareSelectedPerson: React.Dispatch<React.SetStateAction<string>>;
	shareSelectedDays: number;
	setShareSelectedDays: React.Dispatch<React.SetStateAction<number>>;
	shareSelectedExpiryDays: number | null;
	setShareSelectedExpiryDays: React.Dispatch<React.SetStateAction<number | null>>;
	shareAllowJournalNotes: boolean;
	setShareAllowJournalNotes: React.Dispatch<React.SetStateAction<boolean>>;
	shareGenerating: boolean;
	shareLink: string | null;
	setShareLink: React.Dispatch<React.SetStateAction<string | null>>;
	shareCopied: boolean;
	setShareCopied: React.Dispatch<React.SetStateAction<boolean>>;
	activeShareLinks: ActiveShareLink[];
	activeSharesLoading: boolean;
	revokingShareToken: string | null;
	openShareDialog: (meds: Medication[]) => void;
	generateShareLink: () => Promise<void>;
	revokeShareLink: (token: string) => Promise<boolean>;
	copyShareLink: () => void;
	closeShareDialog: () => void;
	resetShareDialogState: () => void;
}

export function useShare(): UseShareReturn {
	const { authFetch } = useAuth();
	const { t } = useTranslation();
	const { showFeedback } = useFeedback();
	const [showShareDialog, setShowShareDialog] = useState(false);
	const [sharePeople, setSharePeople] = useState<string[]>([]);
	const [shareSelectedPerson, setShareSelectedPerson] = useState<string>("");
	const [shareSelectedDays, setShareSelectedDays] = useState<number>(30);
	const [shareSelectedExpiryDays, setShareSelectedExpiryDays] = useState<number | null>(null);
	const [shareAllowJournalNotes, setShareAllowJournalNotes] = useState(false);
	const [shareGenerating, setShareGenerating] = useState(false);
	const [shareLink, setShareLink] = useState<string | null>(null);
	const [shareCopied, setShareCopied] = useState(false);
	const [activeShareLinks, setActiveShareLinks] = useState<ActiveShareLink[]>([]);
	const [activeSharesLoading, setActiveSharesLoading] = useState(false);
	const [revokingShareToken, setRevokingShareToken] = useState<string | null>(null);

	const loadActiveShareLinks = useCallback(async () => {
		setActiveSharesLoading(true);
		try {
			const response = await authFetch("/api/share");
			const data = await response.json().catch(() => ({}));
			if (!response.ok || !Array.isArray(data?.shareLinks)) {
				setActiveShareLinks([]);
				log.warn("[ShareDialog] Failed to load active share links", { status: response.status });
				return;
			}

			setActiveShareLinks(data.shareLinks);
		} catch (error) {
			setActiveShareLinks([]);
			log.error("[ShareDialog] Active share list request threw error", { error });
		} finally {
			setActiveSharesLoading(false);
		}
	}, [authFetch]);

	const openShareDialog = useCallback(
		(meds: Medication[]) => {
			setShowShareDialog(true);
			window.history.pushState({ modal: "share" }, "");
			setShareLink(null);
			setShareCopied(false);
			setShareSelectedPerson("");
			setShareSelectedDays(30);
			setShareSelectedExpiryDays(null);
			setShareAllowJournalNotes(false);
			void loadActiveShareLinks();

			// Include both per-intake assignments and legacy medication-level assignments.
			const uniquePeople = [
				...new Set(
					meds.flatMap((medication) => [
						...(medication.intakes
							?.map((intake) => intake.takenBy)
							.filter((person): person is string => Boolean(person)) ?? []),
						...(medication.takenBy || []),
					])
				),
			]
				.filter(Boolean)
				.sort();
			setSharePeople(uniquePeople.length > 0 ? [SHARE_ALL_VALUE, ...uniquePeople] : []);
			log.info("[ShareDialog] Opened", { medicationCount: meds.length, personCount: uniquePeople.length });
			if (uniquePeople.length > 0) {
				setShareSelectedPerson(uniquePeople[0]);
			}
		},
		[loadActiveShareLinks]
	);

	const generateShareLink = useCallback(async () => {
		if (!shareSelectedPerson) {
			log.warn("[ShareDialog] Attempted to generate link without selected person");
			return;
		}
		setShareGenerating(true);
		setShareCopied(false);

		try {
			const { correlationId, init } = withCorrelation(
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({
						takenBy: shareSelectedPerson,
						scheduleDays: shareSelectedDays,
						expiryDays: shareSelectedExpiryDays,
						allowJournalNotes: shareAllowJournalNotes,
					}),
				},
				"fe-share"
			);
			const res = await authFetch("/api/share", init);

			if (res.ok) {
				const data = await res.json();
				const fullUrl = `${window.location.origin}/share/${data.token}`;
				setShareLink(fullUrl);
				void loadActiveShareLinks();
				log.info("[ShareDialog] Share link ready", {
					person: shareSelectedPerson,
					days: shareSelectedDays,
					expiryDays: shareSelectedExpiryDays,
					allowJournalNotes: shareAllowJournalNotes,
					reused: Boolean(data.reused),
					correlationId,
				});
			} else {
				const err = await res.json();
				log.error("[ShareDialog] Failed to generate share link", {
					status: res.status,
					person: shareSelectedPerson,
					error: err.error,
					correlationId,
				});
				showFeedback({
					message: err.error || t("share.generateFailed"),
					tone: "error",
				});
			}
		} catch (error) {
			log.error("[ShareDialog] Share link request threw error", { person: shareSelectedPerson, error });
			showFeedback({ message: t("share.generateFailed"), tone: "error" });
		} finally {
			setShareGenerating(false);
		}
	}, [
		authFetch,
		loadActiveShareLinks,
		shareAllowJournalNotes,
		shareSelectedExpiryDays,
		shareSelectedPerson,
		shareSelectedDays,
		showFeedback,
		t,
	]);

	const revokeShareLink = useCallback(
		async (token: string) => {
			setRevokingShareToken(token);
			try {
				const response = await authFetch(`/api/share/${token}`, { method: "DELETE" });
				if (!response.ok) {
					const data = await response.json().catch(() => ({}));
					showFeedback({
						message: data.error || t("share.revokeFailed"),
						tone: "error",
					});
					return false;
				}

				setActiveShareLinks((current) => current.filter((share) => share.token !== token));
				if (shareLink?.endsWith(`/share/${token}`)) {
					setShareLink(null);
					setShareCopied(false);
				}
				return true;
			} catch {
				showFeedback({ message: t("share.revokeFailed"), tone: "error" });
				return false;
			} finally {
				setRevokingShareToken(null);
			}
		},
		[authFetch, shareLink, showFeedback, t]
	);

	const copyShareLink = useCallback(() => {
		if (shareLink) {
			if (navigator.clipboard?.writeText) {
				navigator.clipboard.writeText(shareLink).then(
					() => {
						setShareCopied(true);
						log.debug("[ShareDialog] Share link copied to clipboard");
						setTimeout(() => setShareCopied(false), 2000);
					},
					() => {
						// Clipboard API blocked (non-secure context / permissions)
						fallbackCopyToClipboard(shareLink);
					}
				);
			} else {
				fallbackCopyToClipboard(shareLink);
			}
		}

		function fallbackCopyToClipboard(text: string) {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.select();
			try {
				document.execCommand("copy");
				setShareCopied(true);
				log.debug("[ShareDialog] Share link copied via fallback");
				setTimeout(() => setShareCopied(false), 2000);
			} catch {
				log.warn("[ShareDialog] Clipboard copy failed — not in secure context");
			} finally {
				document.body.removeChild(textarea);
			}
		}
	}, [shareLink]);

	const closeShareDialog = useCallback(() => {
		if (showShareDialog) {
			log.debug("[ShareDialog] Closing dialog");
			window.history.back();
		}
	}, [showShareDialog]);

	// Internal function to reset share dialog state (called by popstate handler)
	const resetShareDialogState = useCallback(() => {
		log.debug("[ShareDialog] Reset dialog state");
		setShowShareDialog(false);
		setShareLink(null);
		setShareCopied(false);
		setShareSelectedExpiryDays(null);
		setShareAllowJournalNotes(false);
		setActiveShareLinks([]);
		setActiveSharesLoading(false);
		setRevokingShareToken(null);
	}, []);

	return {
		showShareDialog,
		sharePeople,
		shareSelectedPerson,
		setShareSelectedPerson,
		shareSelectedDays,
		setShareSelectedDays,
		shareSelectedExpiryDays,
		setShareSelectedExpiryDays,
		shareAllowJournalNotes,
		setShareAllowJournalNotes,
		shareGenerating,
		shareLink,
		setShareLink,
		shareCopied,
		setShareCopied,
		activeShareLinks,
		activeSharesLoading,
		revokingShareToken,
		openShareDialog,
		generateShareLink,
		revokeShareLink,
		copyShareLink,
		closeShareDialog,
		resetShareDialogState,
	};
}
