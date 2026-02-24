// =============================================================================
// useShare Hook - Share dialog state and operations
// =============================================================================

import { useCallback, useState } from "react";
import type { Medication } from "../types";
import { withCorrelation } from "../utils/correlation";
import { log } from "../utils/logger";

export interface UseShareReturn {
	showShareDialog: boolean;
	sharePeople: string[];
	shareSelectedPerson: string;
	setShareSelectedPerson: React.Dispatch<React.SetStateAction<string>>;
	shareSelectedDays: number;
	setShareSelectedDays: React.Dispatch<React.SetStateAction<number>>;
	shareGenerating: boolean;
	shareLink: string | null;
	setShareLink: React.Dispatch<React.SetStateAction<string | null>>;
	shareCopied: boolean;
	setShareCopied: React.Dispatch<React.SetStateAction<boolean>>;
	openShareDialog: (meds: Medication[]) => void;
	generateShareLink: () => Promise<void>;
	copyShareLink: () => void;
	closeShareDialog: () => void;
	resetShareDialogState: () => void;
}

export function useShare(): UseShareReturn {
	const [showShareDialog, setShowShareDialog] = useState(false);
	const [sharePeople, setSharePeople] = useState<string[]>([]);
	const [shareSelectedPerson, setShareSelectedPerson] = useState<string>("");
	const [shareSelectedDays, setShareSelectedDays] = useState<number>(30);
	const [shareGenerating, setShareGenerating] = useState(false);
	const [shareLink, setShareLink] = useState<string | null>(null);
	const [shareCopied, setShareCopied] = useState(false);

	const openShareDialog = useCallback((meds: Medication[]) => {
		setShowShareDialog(true);
		window.history.pushState({ modal: "share" }, "");
		setShareLink(null);
		setShareCopied(false);
		setShareSelectedPerson("");
		setShareSelectedDays(30);

		// Get unique takenBy people from all medications (flatten arrays)
		const allPeople = meds.flatMap((m) => m.takenBy || []);
		const uniquePeople = [...new Set(allPeople)].filter(Boolean).sort();
		setSharePeople(uniquePeople);
		log.info("[ShareDialog] Opened", { medicationCount: meds.length, personCount: uniquePeople.length });
		if (uniquePeople.length > 0) {
			setShareSelectedPerson(uniquePeople[0]);
		}
	}, []);

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
					}),
				},
				"fe-share"
			);
			const res = await fetch("/api/share", init);

			if (res.ok) {
				const data = await res.json();
				const fullUrl = `${window.location.origin}/share/${data.token}`;
				setShareLink(fullUrl);
				log.info("[ShareDialog] Share link ready", {
					person: shareSelectedPerson,
					days: shareSelectedDays,
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
				alert(err.error || "Failed to generate share link");
			}
		} catch (error) {
			log.error("[ShareDialog] Share link request threw error", { person: shareSelectedPerson, error });
			alert("Failed to generate share link");
		} finally {
			setShareGenerating(false);
		}
	}, [shareSelectedPerson, shareSelectedDays]);

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
	}, []);

	return {
		showShareDialog,
		sharePeople,
		shareSelectedPerson,
		setShareSelectedPerson,
		shareSelectedDays,
		setShareSelectedDays,
		shareGenerating,
		shareLink,
		setShareLink,
		shareCopied,
		setShareCopied,
		openShareDialog,
		generateShareLink,
		copyShareLink,
		closeShareDialog,
		resetShareDialogState,
	};
}
