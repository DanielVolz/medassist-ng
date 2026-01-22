// =============================================================================
// useShare Hook - Share dialog state and operations
// =============================================================================

import { useCallback, useState } from "react";
import type { Medication } from "../types";

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
		if (uniquePeople.length > 0) {
			setShareSelectedPerson(uniquePeople[0]);
		}
	}, []);

	const generateShareLink = useCallback(async () => {
		if (!shareSelectedPerson) return;
		setShareGenerating(true);
		setShareCopied(false);

		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					takenBy: shareSelectedPerson,
					scheduleDays: shareSelectedDays
				})
			});

			if (res.ok) {
				const data = await res.json();
				const fullUrl = `${window.location.origin}/share/${data.token}`;
				setShareLink(fullUrl);
			} else {
				const err = await res.json();
				alert(err.error || "Failed to generate share link");
			}
		} catch {
			alert("Failed to generate share link");
		} finally {
			setShareGenerating(false);
		}
	}, [shareSelectedPerson, shareSelectedDays]);

	const copyShareLink = useCallback(() => {
		if (shareLink) {
			navigator.clipboard.writeText(shareLink);
			setShareCopied(true);
			setTimeout(() => setShareCopied(false), 2000);
		}
	}, [shareLink]);

	const closeShareDialog = useCallback(() => {
		if (showShareDialog) {
			window.history.back();
		}
	}, [showShareDialog]);

	// Internal function to reset share dialog state (called by popstate handler)
	const resetShareDialogState = useCallback(() => {
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
		resetShareDialogState
	};
}
