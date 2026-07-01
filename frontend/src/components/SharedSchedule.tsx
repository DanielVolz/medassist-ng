// =============================================================================
// SharedSchedule Component - Public view for shared schedules
// =============================================================================
/* biome-ignore-all lint/style/noNestedTernary: rendering branches are intentionally explicit in schedule UI */
/* biome-ignore-all lint/correctness/useExhaustiveDependencies: modal and helper callbacks are stable at runtime */

import { Check, NotebookPen, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useFeedback } from "../context/FeedbackContext";
import { ScheduleUsageTag } from "../features/schedule/components";
import { formatScheduleDoseUsageLabel, formatScheduleTotalUsageLabel } from "../features/schedule/formatters";
import { toggleDateInSet } from "../features/schedule/interactions";
import { loadScheduleCollapseState, saveCollapsedDaySet } from "../features/schedule/storage";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { IntakeJournalEntry } from "../hooks/useIntakeJournal";
import { useModalHistory } from "../hooks/useModalHistory";
import type { ExpiredLinkData, SharedScheduleData } from "../types";
import {
	allowsPillFormSelection,
	getMedDisplayName,
	getMedTotal,
	type IntakeUnit,
	isLiquidContainerPackageType,
	isTubePackageType,
	type StockThresholds,
} from "../types";
import { AppButton } from "../ui/primitives/AppButton";
import { AppTooltip, AppTooltipTrigger } from "../ui/primitives/AppTooltip";
import { getSystemLocale } from "../utils/formatters";
import { getIntakeDailyRate, getMedicationIntakes, iterateIntakeOccurrences } from "../utils/intake-schedule";
import { convertLiquidUsageToMl } from "../utils/intake-units";
import { getStockStatus, isDoseDismissed, parseLocalDateTime } from "../utils/schedule";
import authClasses from "./Auth.module.css";
import doseButtonClasses from "./DoseActionButton.module.css";
import { IntakeJournalModal } from "./intake-journal/IntakeJournalModal";
import { Lightbox } from "./Lightbox";
import { MedicationAvatar } from "./MedicationAvatar";
import { SharedMedicationOverviewSection } from "./SharedMedicationOverviewSection";
import sharedClasses from "./SharedSchedule.module.css";
import { ThemeMenu } from "./ThemeMenu";

async function readSharedJournalError(response: Response, fallbackMessage: string): Promise<string> {
	try {
		const data = (await response.json()) as { error?: string; code?: string };
		if (typeof data.error === "string" && data.error.trim().length > 0) {
			return data.error;
		}
		if (typeof data.code === "string" && data.code.trim().length > 0) {
			return data.code;
		}
	} catch {
		// Fall back to the supplied message when the response body is not JSON.
	}

	return fallbackMessage;
}

function cx(...classNames: Array<string | false | null | undefined>) {
	return classNames.filter(Boolean).join(" ");
}

export function SharedSchedule() {
	const { token } = useParams<{ token: string }>();
	const { t, i18n } = useTranslation();
	const { showFeedback } = useFeedback();
	const [data, setData] = useState<SharedScheduleData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expiredData, setExpiredData] = useState<ExpiredLinkData | null>(null);
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	const [automaticTakenDoses, setAutomaticTakenDoses] = useState<Set<string>>(new Set());
	const [dismissedDoses, setDismissedDoses] = useState<Set<string>>(new Set());
	const [sharedJournalDoseIdsWithNotes, setSharedJournalDoseIdsWithNotes] = useState<Set<string>>(new Set());
	const mutationInFlightRef = useRef(0);
	const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
	const [sharedJournalOpen, setSharedJournalOpen] = useState(false);
	const [sharedJournalDoseId, setSharedJournalDoseId] = useState<string | null>(null);
	const [sharedJournalEntry, setSharedJournalEntry] = useState<IntakeJournalEntry | null>(null);
	const [sharedJournalLoading, setSharedJournalLoading] = useState(false);
	const [sharedJournalSaving, setSharedJournalSaving] = useState(false);
	const [sharedJournalError, setSharedJournalError] = useState<string | null>(null);
	const [showPastDays, setShowPastDays] = useState(false);
	const [showFutureDays, setShowFutureDays] = useState(false);
	const [shareHelpOpen, setShareHelpOpen] = useState(false);
	const sharedImageSrc = useCallback(
		(filename: string) => {
			const imagePath = `/api/images/${encodeURIComponent(filename)}`;
			return token ? `${imagePath}?shareToken=${encodeURIComponent(token)}` : imagePath;
		},
		[token]
	);

	const isLiquidContainerMed = (med: SharedScheduleData["medications"][number] | undefined) =>
		isLiquidContainerPackageType(med?.packageType);

	const convertUsageForStock = (
		usage: number,
		med: SharedScheduleData["medications"][number] | undefined,
		unit: IntakeUnit | null | undefined
	): number => {
		if (isTubePackageType(med?.packageType)) return 0;
		if (!isLiquidContainerMed(med)) return usage;
		return convertLiquidUsageToMl(usage, unit);
	};

	const formatDoseUsageLabel = (
		med: SharedScheduleData["medications"][number] | undefined,
		usage: number,
		intakeUnit?: IntakeUnit | null
	) => formatScheduleDoseUsageLabel(med, usage, t, intakeUnit);

	const formatTotalUsageLabel = (
		med: SharedScheduleData["medications"][number] | undefined,
		total: number,
		doses?: Array<{ usage: number; intakeUnit?: IntakeUnit | null }>
	) => formatScheduleTotalUsageLabel(med, total, t, doses);

	// Theme preference: light, dark, or system
	type ThemePreference = "light" | "dark" | "system";
	const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
		if (typeof window !== "undefined") {
			const stored = localStorage.getItem("theme") as ThemePreference | null;
			if (stored === "light" || stored === "dark" || stored === "system") return stored;
		}
		return "dark";
	});

	function getSystemTheme(): "light" | "dark" {
		if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
			return "light";
		}
		return "dark";
	}

	const resolvedTheme = themePreference === "system" ? getSystemTheme() : themePreference;

	// Apply resolved theme to document
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", resolvedTheme);
		localStorage.setItem("theme", themePreference);
	}, [themePreference, resolvedTheme]);

	// Listen for system theme changes when preference is "system"
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

	// Collapsed days state for SharedSchedule (token-specific localStorage)
	const [manuallyCollapsedDays, setManuallyCollapsedDays] = useState<Set<string>>(new Set());
	const [manuallyExpandedDays, setManuallyExpandedDays] = useState<Set<string>>(new Set());

	// Load collapsed/expanded state from localStorage
	useEffect(() => {
		if (token && typeof window !== "undefined") {
			const { collapsed, expanded } = loadScheduleCollapseState(
				`share_${token}_collapsedDays`,
				`share_${token}_expandedDays`
			);
			setManuallyCollapsedDays(collapsed);
			setManuallyExpandedDays(expanded);
		}
	}, [token]);

	// Toggle day collapse/expand for SharedSchedule
	function toggleDayCollapse(dateStr: string, isAutoCollapsed: boolean) {
		if (isAutoCollapsed) {
			setManuallyExpandedDays((prev) => {
				const next = toggleDateInSet(prev, dateStr);
				if (token) saveCollapsedDaySet(`share_${token}_expandedDays`, next);
				return next;
			});
		} else {
			setManuallyCollapsedDays((prev) => {
				const next = toggleDateInSet(prev, dateStr);
				if (token) saveCollapsedDaySet(`share_${token}_collapsedDays`, next);
				return next;
			});
		}
	}

	// Helper functions for lightbox with history support (mobile back swipe)
	function openLightbox(url: string, name: string) {
		setLightboxImage({ url, name });
		window.history.pushState({ modal: "lightbox" }, "");
	}
	function closeLightbox() {
		if (lightboxImage) {
			window.history.back();
		}
	}

	// Close lightbox on Escape key
	useEscapeKey(!!lightboxImage, closeLightbox);

	const closeSharedJournalEditor = useCallback(() => {
		setSharedJournalOpen(false);
		setSharedJournalDoseId(null);
		setSharedJournalEntry(null);
		setSharedJournalLoading(false);
		setSharedJournalSaving(false);
		setSharedJournalError(null);
	}, []);

	useModalHistory(sharedJournalOpen, "shared-intake-journal", closeSharedJournalEditor);

	const openSharedJournalEditor = useCallback(
		async (doseId: string) => {
			if (!token || !data?.allowJournalNotes) {
				return;
			}

			setSharedJournalOpen(true);
			setSharedJournalDoseId(doseId);
			setSharedJournalEntry(null);
			setSharedJournalLoading(true);
			setSharedJournalError(null);

			try {
				const response = await fetch(`/api/share/${token}/journal/event/${encodeURIComponent(doseId)}`);
				if (!response.ok) {
					setSharedJournalEntry(null);
					setSharedJournalError(await readSharedJournalError(response, t("journal.errors.loadFailed")));
					return;
				}

				const payload = (await response.json()) as { entry: IntakeJournalEntry };
				setSharedJournalEntry(payload.entry);
				setSharedJournalDoseIdsWithNotes((current) => {
					const next = new Set(current);
					if (payload.entry.note?.trim()) {
						next.add(payload.entry.doseId);
					} else {
						next.delete(payload.entry.doseId);
					}
					return next;
				});
			} catch {
				setSharedJournalEntry(null);
				setSharedJournalError(t("journal.errors.loadFailed"));
			} finally {
				setSharedJournalLoading(false);
			}
		},
		[data?.allowJournalNotes, t, token]
	);

	const saveSharedJournalNote = useCallback(
		async (note: string) => {
			if (!token || !sharedJournalDoseId) {
				setSharedJournalError(t("journal.errors.noEventSelected"));
				return false;
			}

			if (note.trim().length === 0) {
				setSharedJournalError(t("journal.errors.emptySharedNote"));
				return false;
			}

			setSharedJournalSaving(true);
			setSharedJournalError(null);

			try {
				const response = await fetch(`/api/share/${token}/journal/event/${encodeURIComponent(sharedJournalDoseId)}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ note }),
				});

				if (!response.ok) {
					setSharedJournalError(await readSharedJournalError(response, t("journal.errors.saveFailed")));
					return false;
				}

				const payload = (await response.json()) as { entry: IntakeJournalEntry };
				setSharedJournalEntry(payload.entry);
				setSharedJournalDoseIdsWithNotes((current) => {
					const next = new Set(current);
					if (payload.entry.note?.trim()) {
						next.add(payload.entry.doseId);
					} else {
						next.delete(payload.entry.doseId);
					}
					return next;
				});
				return true;
			} catch {
				setSharedJournalError(t("journal.errors.saveFailed"));
				return false;
			} finally {
				setSharedJournalSaving(false);
			}
		},
		[sharedJournalDoseId, t, token]
	);

	// Handle browser back button to close lightbox
	useEffect(() => {
		function handlePopState() {
			if (lightboxImage) {
				setLightboxImage(null);
			}
		}
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [lightboxImage]);

	// Load taken doses from server with polling for real-time sync
	// Separates taken and dismissed doses (like main app's useDoses hook)
	const loadTakenDoses = useCallback(async () => {
		if (!token) return;
		if (mutationInFlightRef.current > 0) return;
		try {
			const res = await fetch(`/api/share/${token}/doses`);
			if (res.ok) {
				if (mutationInFlightRef.current > 0) return;

				const data = await res.json();
				const taken = new Set<string>();
				const automatic = new Set<string>();
				const dismissed = new Set<string>();
				const journalDoseIds = new Set<string>();
				for (const d of data.doses as Array<{
					doseId: string;
					dismissed?: boolean;
					skipped?: boolean;
					takenSource?: string;
					hasJournalNote?: boolean;
				}>) {
					if (d.skipped === true || d.dismissed === true) {
						dismissed.add(d.doseId);
					} else {
						taken.add(d.doseId);
						if (d.takenSource === "automatic") {
							automatic.add(d.doseId);
						}
					}
					if (d.hasJournalNote === true) {
						journalDoseIds.add(d.doseId);
					}
				}
				setTakenDoses(taken);
				setAutomaticTakenDoses(automatic);
				setDismissedDoses(dismissed);
				setSharedJournalDoseIdsWithNotes(journalDoseIds);
			}
		} catch {
			// Keep the current optimistic/shared state on transient read errors.
		}
	}, [token]);

	useEffect(() => {
		if (!token) return;
		loadTakenDoses();

		// Poll for updates every 5 seconds (real-time sync with dashboard)
		const interval = setInterval(loadTakenDoses, 5000);
		return () => clearInterval(interval);
	}, [loadTakenDoses, token]);

	// Get dose ID - for per-intake takenBy, the ID already has the person suffix
	// This helper is kept for compatibility but since dose.id already includes the suffix, it just returns the id
	function _getDoseId(doseId: string, _person: string | null): string {
		// The dose.id already includes the person suffix if there's a per-intake takenBy
		return doseId;
	}

	async function markDoseTaken(doseId: string) {
		if (data?.allowMarkTaken === false) {
			return;
		}

		const wasTaken = takenDoses.has(doseId);
		const wasSkipped = dismissedDoses.has(doseId);
		const wasAutomatic = automaticTakenDoses.has(doseId);

		// Optimistic update
		mutationInFlightRef.current++;
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			return next;
		});
		setDismissedDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});
		setAutomaticTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});

		// Send to server
		try {
			const response = await fetch(`/api/share/${token}/doses`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ doseId }),
			});
			if (!response.ok) {
				try {
					const data = (await response.json()) as { code?: string };
					if (data.code === "OUT_OF_STOCK") {
						showFeedback({ message: t("common.outOfStockTakeBlocked"), tone: "error" });
					}
				} catch {
					// Ignore JSON parsing errors and fall back to the optimistic rollback only.
				}
				throw new Error("Failed to mark shared dose as taken");
			}
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				if (wasTaken) {
					next.add(doseId);
				} else {
					next.delete(doseId);
				}
				return next;
			});
			setDismissedDoses((prev) => {
				const next = new Set(prev);
				if (wasSkipped) {
					next.add(doseId);
				} else {
					next.delete(doseId);
				}
				return next;
			});
			setAutomaticTakenDoses((prev) => {
				const next = new Set(prev);
				if (wasAutomatic) {
					next.add(doseId);
				}
				return next;
			});
		} finally {
			mutationInFlightRef.current--;
			loadTakenDoses();
		}
	}

	async function markDoseSkipped(doseId: string) {
		if (data?.allowMarkTaken === false) {
			return;
		}

		if (takenDoses.has(doseId)) {
			return;
		}

		const wasTaken = takenDoses.has(doseId);
		const wasSkipped = dismissedDoses.has(doseId);
		const wasAutomatic = automaticTakenDoses.has(doseId);

		mutationInFlightRef.current++;
		setDismissedDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			return next;
		});
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});
		setAutomaticTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});

		try {
			const response = await fetch(`/api/share/${token}/doses/skip`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ doseId }),
			});
			if (!response.ok) {
				throw new Error("Failed to mark shared dose as skipped");
			}
		} catch {
			setDismissedDoses((prev) => {
				const next = new Set(prev);
				if (wasSkipped) {
					next.add(doseId);
				} else {
					next.delete(doseId);
				}
				return next;
			});
			setTakenDoses((prev) => {
				const next = new Set(prev);
				if (wasTaken) {
					next.add(doseId);
				}
				return next;
			});
			setAutomaticTakenDoses((prev) => {
				const next = new Set(prev);
				if (wasAutomatic) {
					next.add(doseId);
				}
				return next;
			});
		} finally {
			mutationInFlightRef.current--;
			loadTakenDoses();
		}
	}

	async function undoDoseTaken(doseId: string) {
		if (data?.allowMarkTaken === false) {
			return;
		}

		const wasAutomatic = automaticTakenDoses.has(doseId);
		// Optimistic update
		mutationInFlightRef.current++;
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});
		setAutomaticTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});

		// Send to server
		try {
			await fetch(`/api/share/${token}/doses/${encodeURIComponent(doseId)}`, {
				method: "DELETE",
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
			setAutomaticTakenDoses((prev) => {
				const next = new Set(prev);
				if (wasAutomatic) {
					next.add(doseId);
				}
				return next;
			});
		} finally {
			mutationInFlightRef.current--;
			loadTakenDoses();
		}
	}

	async function undoDoseSkipped(doseId: string) {
		if (data?.allowMarkTaken === false) {
			return;
		}

		const wasSkipped = dismissedDoses.has(doseId);

		mutationInFlightRef.current++;
		setDismissedDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});

		try {
			await fetch(`/api/share/${token}/doses/skip/${encodeURIComponent(doseId)}`, {
				method: "DELETE",
			});
		} catch {
			setDismissedDoses((prev) => {
				const next = new Set(prev);
				if (wasSkipped) {
					next.add(doseId);
				}
				return next;
			});
		} finally {
			mutationInFlightRef.current--;
			loadTakenDoses();
		}
	}

	const renderDoseActionButtons = (options: {
		doseId: string;
		isTaken: boolean;
		isSkipped: boolean;
		isAutomaticallyTaken: boolean;
		isEmpty: boolean;
	}) => {
		const showSharedJournalAction = Boolean(data?.allowJournalNotes);
		const canMarkTaken = data?.allowMarkTaken !== false;
		const canOpenSharedJournal = showSharedJournalAction && (options.isTaken || options.isSkipped);
		const hasSharedJournalNote = sharedJournalDoseIdsWithNotes.has(options.doseId);
		const takeButtonControl = options.isTaken ? (
			<AppButton
				type="button"
				size="sm"
				className={cx(
					"shared-dose-action-button",
					"shared-dose-action-take",
					doseButtonClasses.button,
					doseButtonClasses.takeAction,
					doseButtonClasses.undo,
					doseButtonClasses.undoTake
				)}
				onClick={() => undoDoseTaken(options.doseId)}
			>
				{options.isAutomaticallyTaken && (
					<AppTooltip label={t("tooltips.automaticTaken")}>
						<span className={doseButtonClasses.actionIcon} aria-hidden="true">
							🤖
						</span>
					</AppTooltip>
				)}
				<span className={doseButtonClasses.label}>{t("common.undo")}</span>
				<Undo2 className={doseButtonClasses.actionIcon} aria-hidden="true" />
			</AppButton>
		) : (
			<AppButton
				type="button"
				size="sm"
				className={cx(
					"take-action-button",
					"shared-dose-action-button",
					"shared-dose-action-take",
					doseButtonClasses.button,
					doseButtonClasses.takeAction,
					doseButtonClasses.take,
					doseButtonClasses.dashboardTake,
					options.isEmpty && doseButtonClasses.outOfStock
				)}
				onClick={() => markDoseTaken(options.doseId)}
				disabled={options.isEmpty || !canMarkTaken}
			>
				<span className={doseButtonClasses.label}>{t("dose.take")}</span>
				{options.isEmpty ? (
					<span aria-hidden="true">⊘</span>
				) : (
					<Check className={doseButtonClasses.actionIcon} aria-hidden="true" />
				)}
			</AppButton>
		);
		const takeButton =
			!options.isTaken && options.isEmpty ? (
				<AppTooltip label={t("common.outOfStockTakeBlocked")}>
					<span
						className={cx("shared-dose-action-take", doseButtonClasses.tooltipTarget, doseButtonClasses.takeAction)}
					>
						{takeButtonControl}
					</span>
				</AppTooltip>
			) : !canMarkTaken ? (
				<AppTooltip label={t("share.readOnly")}>
					<span
						className={cx("shared-dose-action-take", doseButtonClasses.tooltipTarget, doseButtonClasses.takeAction)}
					>
						{takeButtonControl}
					</span>
				</AppTooltip>
			) : (
				takeButtonControl
			);

		const skipButton = options.isSkipped ? (
			<AppButton
				type="button"
				size="sm"
				className={cx(
					"shared-dose-action-button",
					"shared-dose-action-skip",
					doseButtonClasses.button,
					doseButtonClasses.skipAction,
					doseButtonClasses.undo,
					doseButtonClasses.undoSkip
				)}
				onClick={() => undoDoseSkipped(options.doseId)}
			>
				<span className={doseButtonClasses.label}>{t("dose.undoSkip")}</span>
				<Undo2 className={doseButtonClasses.actionIcon} aria-hidden="true" />
			</AppButton>
		) : (
			<AppButton
				type="button"
				size="sm"
				className={cx(
					"shared-dose-action-button",
					"shared-dose-action-skip",
					doseButtonClasses.button,
					doseButtonClasses.skipAction,
					doseButtonClasses.skip
				)}
				onClick={() => markDoseSkipped(options.doseId)}
				disabled={options.isTaken || !canMarkTaken}
			>
				<span className={doseButtonClasses.label}>{t("dose.skip")}</span>
			</AppButton>
		);
		const skipButtonWithReadOnlyTooltip = !canMarkTaken ? (
			<AppTooltip label={t("share.readOnly")}>
				<span className={cx("shared-dose-action-skip", doseButtonClasses.tooltipTarget, doseButtonClasses.skipAction)}>
					{skipButton}
				</span>
			</AppTooltip>
		) : (
			skipButton
		);

		const journalButtonControl = showSharedJournalAction ? (
			<AppButton
				type="button"
				size="sm"
				className={cx(
					"shared-dose-action-button",
					"shared-dose-action-journal",
					doseButtonClasses.button,
					doseButtonClasses.journalAction,
					doseButtonClasses.journal,
					hasSharedJournalNote && doseButtonClasses.hasNote
				)}
				onClick={() => {
					if (canOpenSharedJournal) {
						void openSharedJournalEditor(options.doseId);
					}
				}}
				disabled={!canOpenSharedJournal}
			>
				<NotebookPen size={14} aria-hidden="true" />
				<span className={doseButtonClasses.label}>{t("journal.actions.note")}</span>
			</AppButton>
		) : null;
		const journalButton =
			showSharedJournalAction && journalButtonControl && !canOpenSharedJournal ? (
				<AppTooltip label={t("journal.actions.noteTakenOnly")}>
					<span
						className={cx(
							"shared-dose-action-journal",
							doseButtonClasses.tooltipTarget,
							doseButtonClasses.journalAction
						)}
					>
						{journalButtonControl}
					</span>
				</AppTooltip>
			) : (
				journalButtonControl
			);

		return (
			<>
				{takeButton}
				{skipButtonWithReadOnlyTooltip}
				{journalButton}
			</>
		);
	};

	const isDoseTakenAutomatically = (doseId: string) => automaticTakenDoses.has(doseId);

	useEffect(() => {
		async function fetchData() {
			if (!token) {
				setError("Invalid link");
				setLoading(false);
				return;
			}

			try {
				const res = await fetch(`/api/share/${token}`);
				if (res.ok) {
					const json = await res.json();
					setData(json);
				} else if (res.status === 410) {
					// Link expired - get owner info
					const json = await res.json();
					setExpiredData({
						ownerUsername: json.ownerUsername,
						takenBy: json.takenBy,
						expiredAt: json.expiredAt,
					});
				} else if (res.status === 404) {
					setError(t("share.notFound"));
				} else {
					setError(t("share.error"));
				}
			} catch {
				setError(t("share.error"));
			} finally {
				setLoading(false);
			}
		}
		fetchData();
	}, [token, t]);

	function buildGroupedSchedule() {
		if (!data) return [];

		// Use same logic as buildSchedulePreview in main app
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Midnight today

		// Use 180 days horizon like main app (scheduleDays only limits futureDays display)
		const end = new Date();
		end.setDate(end.getDate() + 180);

		const doses: {
			id: string;
			when: number;
			medName: string;
			usage: number;
			intakeUnit?: IntakeUnit | null;
			timeStr: string;
			isPast: boolean;
			takenBy: string | null; // Per-intake takenBy (single person or null)
			dateStr: string;
		}[] = [];

		for (const med of data.medications) {
			const intakes = getMedicationIntakes(med);

			intakes.forEach((intake, intakeIdx) => {
				// Filter: for person-specific shares, include matching intakes plus shared-for-everyone intakes.
				if (data.takenBy !== "all" && intake.takenBy !== null && intake.takenBy !== data.takenBy) return;

				const startDate = parseLocalDateTime(intake.start);
				if (Number.isNaN(startDate.getTime())) return;

				iterateIntakeOccurrences(intake, startDate, end, (d) => {
					const t = d.getTime();
					const isPast = d < todayStart;
					// Use date-only timestamp for stable ID (immune to time changes)
					// This ensures changing intake times doesn't invalidate past dose tracking
					// Must match buildSchedulePreview in schedule.ts exactly
					const dateOnlyMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
					// Dose ID includes person suffix if there's a per-intake takenBy
					const baseDoseId = `${med.id}-${intakeIdx}-${dateOnlyMs}`;
					const doseId = intake.takenBy ? `${baseDoseId}-${intake.takenBy}` : baseDoseId;
					doses.push({
						id: doseId,
						when: t,
						medName: getMedDisplayName(med),
						usage: intake.usage,
						intakeUnit: intake.intakeUnit ?? null,
						isPast,
						takenBy: intake.takenBy, // Per-intake takenBy (string | null)
						timeStr: d.toLocaleTimeString(getSystemLocale(i18n.language), { hour: "2-digit", minute: "2-digit" }),
						dateStr: d.toLocaleDateString(getSystemLocale(i18n.language), {
							weekday: "short",
							day: "2-digit",
							month: "short",
						}),
					});
				});
			});
		}

		doses.sort((a, b) => a.when - b.when);

		// Group by date - matches groupedSchedule logic in main app
		type DoseInfo = (typeof doses)[number];
		const days = new Map<
			string,
			{
				dateStr: string;
				date: Date;
				isPast: boolean;
				meds: Map<string, { medName: string; total: number; doses: DoseInfo[]; lastWhen: number }>;
			}
		>();

		for (const dose of doses.slice(0, 2000)) {
			const day = days.get(dose.dateStr) ?? {
				dateStr: dose.dateStr,
				date: new Date(dose.when),
				isPast: dose.isPast,
				meds: new Map(),
			};
			const medEntry = day.meds.get(dose.medName) ?? {
				medName: dose.medName,
				total: 0,
				doses: [],
				lastWhen: dose.when,
			};
			medEntry.total += dose.usage;
			medEntry.doses.push(dose);
			medEntry.lastWhen = Math.max(medEntry.lastWhen, dose.when);
			day.meds.set(dose.medName, medEntry);
			days.set(dose.dateStr, day);
		}

		return Array.from(days.values()).map((d) => ({
			dateStr: d.dateStr,
			date: d.date,
			isPast: d.isPast,
			meds: Array.from(d.meds.values()),
		}));
	}

	// Visible schedule respects share-person filtering.
	const schedule = useMemo(() => {
		return buildGroupedSchedule();
	}, [data, i18n.language]);

	// Split into past, today, and future - matches main app logic
	const pastDays = useMemo(() => {
		const visiblePastDays = Math.max(1, data?.scheduleDays ?? 30);
		return schedule.filter((d) => d.isPast).slice(-visiblePastDays);
	}, [schedule, data?.scheduleDays]);

	// Separate today from future days
	const { todayDay, futureDays } = useMemo(() => {
		const today = new Date();
		const todayStr = today.toLocaleDateString(getSystemLocale(i18n.language), {
			weekday: "short",
			day: "2-digit",
			month: "short",
		});
		const nonPastDays = schedule.filter((d) => !d.isPast).slice(0, data?.scheduleDays ?? 30);

		const todayEntry = nonPastDays.find((d) => d.dateStr === todayStr);
		const future = nonPastDays.filter((d) => d.dateStr !== todayStr);

		return { todayDay: todayEntry || null, futureDays: future };
	}, [schedule, data?.scheduleDays, i18n.language]);

	// Calculate coverage for stock status colors — matches main app's calculateCoverage logic
	// Uses time-based automatic consumption (same as DashboardPage) for accurate stock levels
	const coverageByMed = useMemo(() => {
		if (!data) return {};
		const now = Date.now();
		const calcMode = data.stockCalculationMode ?? "automatic";
		const coverage: Record<string, { daysLeft: number | null; medsLeft: number; dailyUsage: number }> = {};

		for (const med of data.medications) {
			const intakes = getMedicationIntakes(med);

			// Count unique people from all intakes (for per-intake takenBy)
			const uniquePeople = new Set<string>();
			intakes.forEach((intake) => {
				if (intake.takenBy) uniquePeople.add(intake.takenBy);
			});
			med.takenBy?.forEach((person) => uniquePeople.add(person));
			const personCount = Math.max(1, uniquePeople.size || med.takenBy?.length || 1);

			// Calculate daily consumption rate accounting for per-intake takenBy
			let dailyRate = 0;
			intakes.forEach((intake) => {
				const usageForStock = convertUsageForStock(intake.usage, med, intake.intakeUnit ?? "ml");
				const baseRate = usageForStock * getIntakeDailyRate(intake);
				if (intake?.takenBy) {
					dailyRate += baseRate; // Per-intake takenBy: 1 person
				} else {
					dailyRate += baseRate * personCount; // Legacy: all people
				}
			});

			let consumed = 0;
			const stockCorrectionCutoff = med.lastStockCorrectionAt ? med.lastStockCorrectionAt : 0;

			if (calcMode === "automatic") {
				// Time-based: every scheduled dose counts as consumed once its time has passed
				intakes.forEach((intake, blisterIdx) => {
					const usageForStock = convertUsageForStock(intake.usage, med, intake.intakeUnit ?? "ml");
					const intakeStart = parseLocalDateTime(intake.start);
					if (Number.isNaN(intakeStart.getTime())) return;

					const intakePerson = intake?.takenBy;
					const fallbackPeople = med.takenBy?.length > 0 ? med.takenBy : [null];
					const peopleForThisIntake = intakePerson ? [intakePerson] : fallbackPeople;

					let timeBasedConsumed = 0;
					let lastAutoConsumedDateMs = 0;

					iterateIntakeOccurrences(intake, intakeStart, new Date(now), (occurrence) => {
						if (occurrence.getTime() <= stockCorrectionCutoff) return;
						timeBasedConsumed += usageForStock * peopleForThisIntake.length;
						lastAutoConsumedDateMs = new Date(
							occurrence.getFullYear(),
							occurrence.getMonth(),
							occurrence.getDate()
						).getTime();
					});

					// Early intakes: future doses already marked as taken
					const stockCorrectionDateOnly =
						stockCorrectionCutoff > 0
							? new Date(
									new Date(stockCorrectionCutoff).getFullYear(),
									new Date(stockCorrectionCutoff).getMonth(),
									new Date(stockCorrectionCutoff).getDate()
								).getTime()
							: 0;
					const earlyCutoff = Math.max(lastAutoConsumedDateMs, stockCorrectionDateOnly);

					let earlyTakenConsumed = 0;
					for (const doseId of takenDoses) {
						const parts = doseId.split("-");
						if (parts.length >= 3) {
							const medId = parseInt(parts[0], 10);
							const bIdx = parseInt(parts[1], 10);
							const timestamp = parseInt(parts[2], 10);
							if (medId === med.id && bIdx === blisterIdx && timestamp > earlyCutoff) {
								earlyTakenConsumed += usageForStock;
							}
						}
					}

					consumed += timeBasedConsumed + earlyTakenConsumed;
				});
			} else {
				// Manual mode: only count explicitly taken doses
				takenDoses.forEach((doseId) => {
					const parts = doseId.split("-");
					if (parts.length >= 3) {
						const medId = parseInt(parts[0], 10);
						const blisterIdx = parseInt(parts[1], 10);
						const doseTimestamp = parseInt(parts[2], 10);
						if (medId === med.id && intakes[blisterIdx]) {
							const blisterStartDate = new Date(intakes[blisterIdx].start);
							const blisterStartDateOnly = new Date(
								blisterStartDate.getFullYear(),
								blisterStartDate.getMonth(),
								blisterStartDate.getDate()
							).getTime();
							const afterCorrection = stockCorrectionCutoff === 0 || doseTimestamp > stockCorrectionCutoff;
							if (!Number.isNaN(blisterStartDateOnly) && doseTimestamp >= blisterStartDateOnly && afterCorrection) {
								consumed += convertUsageForStock(
									intakes[blisterIdx].usage,
									med,
									intakes[blisterIdx].intakeUnit ?? "ml"
								);
							}
						}
					}
				});
			}

			const totalPills = getMedTotal(med);
			const medsLeft = Math.max(0, totalPills - consumed);
			const rawDaysLeft = dailyRate > 0 ? medsLeft / dailyRate : null;
			const daysLeft = rawDaysLeft !== null ? Math.max(0, Math.floor(rawDaysLeft)) : null;

			coverage[getMedDisplayName(med)] = { daysLeft, medsLeft: Number(medsLeft.toFixed(1)), dailyUsage: dailyRate };
		}
		return coverage;
	}, [data, takenDoses]);

	const sharedStockThresholds = useMemo<StockThresholds | null>(() => {
		if (!data?.stockThresholds) return null;
		return {
			lowStockDays: data.stockThresholds.lowStockDays,
			normalStockDays: data.stockThresholds.normalStockDays ?? data.stockThresholds.lowStockDays,
			highStockDays:
				data.stockThresholds.highStockDays ??
				Math.max(
					(data.stockThresholds.normalStockDays ?? data.stockThresholds.lowStockDays) + 1,
					data.stockThresholds.lowStockDays + 1
				),
			criticalStockDays:
				data.stockThresholds.reminderDaysBefore ?? Math.max(1, Math.ceil(data.stockThresholds.lowStockDays / 2)),
			expiryWarningDays: data.stockThresholds.expiryWarningDays ?? 30,
		};
	}, [data?.stockThresholds]);

	const medicationOverviewByName = useMemo(() => {
		const overview = new Map<string, NonNullable<SharedScheduleData["medicationOverview"]>[number]>();
		for (const item of data?.medicationOverview ?? []) {
			overview.set(item.name, item);
		}
		return overview;
	}, [data?.medicationOverview]);

	const emptyByOverviewName = useMemo(() => {
		const emptyNames = new Set<string>();
		for (const item of data?.medicationOverview ?? []) {
			if ((item.currentStock ?? 0) <= 0) {
				emptyNames.add(item.name);
			}
		}
		return emptyNames;
	}, [data?.medicationOverview]);

	const isDoseTakenForDisplay = useCallback((doseId: string) => takenDoses.has(doseId), [takenDoses]);

	const showMedicationOverview = data?.shareMedicationOverview === true && data?.medicationOverview !== null;
	const showOnlyToday = data?.shareScheduleTodayOnly === true;
	const sharedPersonLabel = data?.takenBy === "all" ? t("share.allPeople") : (data?.takenBy ?? "");
	const pageTitle = showMedicationOverview
		? `💊 ${t("sharedOverview.title", { person: sharedPersonLabel })}`
		: `💊 ${t("share.scheduleFor")} ${sharedPersonLabel}`;

	const renderDoseUsage = (
		med: SharedScheduleData["medications"][number] | undefined,
		dose: { usage: number; intakeUnit?: IntakeUnit | null }
	) => formatDoseUsageLabel(med, dose.usage, dose.intakeUnit);

	// Helper: check if a dose is "done" (taken, per-dose dismissed, or med-level dismissed)
	function isDoseIdDone(doseId: string): boolean {
		if (isDoseTakenForDisplay(doseId)) return true;
		if (dismissedDoses.has(doseId)) return true;
		const parts = doseId.split("-");
		if (parts.length >= 3) {
			const medId = parts[0];
			const med = data?.medications.find((m) => String(m.id) === medId);
			if (med) {
				if (isDoseDismissed(doseId, med.dismissedUntil ?? undefined)) {
					return true;
				}
			}
		}
		return false;
	}

	// Missed past dose IDs — matches DashboardPage's missedPastDoseIds logic
	const missedPastDoseIds = useMemo(() => {
		const allPastDoseIds = pastDays.flatMap((d) => d.meds.flatMap((m) => m.doses.map((dose) => dose.id)));
		return allPastDoseIds.filter((id) => !isDoseIdDone(id));
	}, [pastDays, isDoseIdDone]);

	if (loading) {
		return (
			<div className={authClasses["auth-container"]} data-theme={resolvedTheme}>
				<div className={sharedClasses["shared-auth-panel"]} aria-busy="true">
					<h1 className={authClasses["auth-title"]}>💊 MedAssist-ng</h1>
					<p>{t("common.loading")}</p>
				</div>
			</div>
		);
	}

	if (expiredData) {
		const expiredPersonLabel = expiredData.takenBy === "all" ? t("share.allPeople") : expiredData.takenBy;
		return (
			<div className={sharedClasses["shared-schedule-page"]}>
				<div className={[sharedClasses["shared-schedule-error"], sharedClasses.expired].join(" ")}>
					<h1>💊 MedAssist-ng</h1>
					<div className={sharedClasses["expired-icon"]}>⏰</div>
					<h2>{t("share.expired.title")}</h2>
					<p className={sharedClasses["expired-message"]}>
						{t("share.expired.message", { takenBy: expiredPersonLabel })}
					</p>
					<p className={sharedClasses["expired-contact"]}>
						{t("share.expired.contact", { username: expiredData.ownerUsername })}
					</p>
					<p className={sharedClasses["expired-date"]}>
						{t("share.expired.expiredOn", {
							date: new Date(expiredData.expiredAt).toLocaleDateString(getSystemLocale(i18n.language)),
						})}
					</p>
				</div>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className={sharedClasses["shared-schedule-page"]}>
				<div className={sharedClasses["shared-schedule-error"]}>
					<h1>💊 MedAssist-ng</h1>
					<p className={sharedClasses["error-message"]}>{error || "Unknown error"}</p>
				</div>
			</div>
		);
	}

	const getDoseRecipientNames = (
		takenBy: string | null,
		med: SharedScheduleData["medications"][number] | undefined
	): string[] => {
		const directRecipient = takenBy?.trim();
		if (directRecipient) {
			return [directRecipient];
		}

		return Array.from(
			new Set((med?.takenBy ?? []).map((person) => person.trim()).filter((person) => person.length > 0))
		);
	};

	const renderDoseRecipients = (people: string[]) => {
		if (people.length === 0) {
			return null;
		}

		return (
			<div className={cx("dose-recipients", sharedClasses["shared-dose-recipients"])}>
				{people.map((person) => (
					<span key={person} className={cx("dose-recipient-name", sharedClasses["shared-dose-recipient-name"])}>
						{person}
					</span>
				))}
			</div>
		);
	};

	const renderDosePersonName = (people: string[]) =>
		people.length > 0 ? (
			<span className={cx("person-name", sharedClasses["shared-action-recipient-name"])}>{people.join(", ")}</span>
		) : null;

	const renderDoseSummary = (
		med: SharedScheduleData["medications"][number] | undefined,
		dose: { timeStr: string; usage: number; intakeUnit?: IntakeUnit | null; takenBy: string | null },
		people: string[]
	) => (
		<>
			<span className="dose-time">{dose.timeStr}</span>
			<div className="dose-summary">
				<span className="dose-usage">
					<span className="dose-usage-main dose-usage-main-full">{renderDoseUsage(med, dose)}</span>
					<span className="dose-usage-main dose-usage-main-compact">{renderDoseUsage(med, dose)}</span>
					{allowsPillFormSelection(med?.packageType) && med?.pillWeightMg && (
						<span className="dose-usage-weight">{`${dose.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"}`}</span>
					)}
				</span>
				{renderDoseRecipients(people)}
			</div>
		</>
	);

	return (
		<div className={sharedClasses["shared-schedule-page"]}>
			<div className={cx(sharedClasses["shared-schedule-container"], "shared-schedule-container")}>
				<header className={sharedClasses["shared-schedule-header"]}>
					<h1>{pageTitle}</h1>
					<div className={sharedClasses["shared-schedule-help"]}>
						<button
							type="button"
							className={sharedClasses["shared-schedule-help-toggle"]}
							onClick={() => setShareHelpOpen((current) => !current)}
							aria-expanded={shareHelpOpen}
						>
							<span>{t("share.publicAccessSummary")}</span>
							<span
								className={[sharedClasses["shared-schedule-help-icon"], shareHelpOpen ? sharedClasses.open : ""]
									.filter(Boolean)
									.join(" ")}
								aria-hidden="true"
							>
								▼
							</span>
						</button>
						{shareHelpOpen ? (
							<p className={sharedClasses["shared-schedule-boundary"]}>{t("share.publicAccessHelp")}</p>
						) : null}
					</div>
					<div className={sharedClasses["shared-schedule-header-actions"]}>
						<ThemeMenu resolvedTheme={resolvedTheme} themePreference={themePreference} onChange={setThemePreference} />
					</div>
					{!showOnlyToday &&
						(() => {
							const periodLabel =
								data.scheduleDays === 30
									? t("dashboard.schedules.1month")
									: data.scheduleDays === 90
										? t("dashboard.schedules.3months")
										: t("dashboard.schedules.6months");
							return (
								<p className={sharedClasses["shared-schedule-period"]}>
									{t("share.period")}: {periodLabel}
								</p>
							);
						})()}
				</header>

				{showMedicationOverview ? (
					<SharedMedicationOverviewSection
						takenBy={sharedPersonLabel}
						sharedBy={data.sharedBy}
						medications={data.medicationOverview ?? []}
						showTitle={false}
						onMedicationImageClick={openLightbox}
						imageSrcResolver={sharedImageSrc}
					/>
				) : null}

				<section className={sharedClasses["shared-schedule-section"]} aria-label={t("dashboard.schedules.title")}>
					<div className={sharedClasses["shared-overview-section-header"]}>
						<h2>{t("dashboard.schedules.title")}</h2>
					</div>
					<div className="timeline">
						{schedule.length === 0 ? (
							<p className={sharedClasses["shared-schedule-empty"]}>{t("share.noSchedule")}</p>
						) : (
							<>
								{/* Past days (when expanded) — rendered above toggle */}
								{!showOnlyToday &&
									showPastDays &&
									pastDays.map((day) => {
										// Get ALL dose IDs for this day (for total count and yellow styling)
										const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));

										// Really taken = all doses marked as taken by human (for green "All taken")
										const allReallyTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
										const takenCount = allDoseIds.filter((id) => isDoseTakenForDisplay(id)).length;

										// Count missed doses that are NOT dismissed (for warning icon)
										const missedNotDismissedCount = day.meds.reduce((count, item) => {
											const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
											const dismissedUntilDate = med?.dismissedUntil ?? undefined;
											return (
												count +
												item.doses.reduce((doseCount, d) => {
													if (isDoseDismissed(d.id, dismissedUntilDate)) return doseCount;
													if (isDoseTakenForDisplay(d.id) || dismissedDoses.has(d.id)) return doseCount;
													return doseCount + 1;
												}, 0)
											);
										}, 0);
										const hasRealMissed = missedNotDismissedCount > 0;

										const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
										const isCollapsed = !isManuallyExpanded;

										const pastMissedClass = allDoseIds.length > 0 ? "past-missed" : "";
										return (
											<div
												key={day.dateStr}
												className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allReallyTaken ? "all-taken" : pastMissedClass}`}
											>
												<div
													className="day-divider clickable"
													onClick={() => toggleDayCollapse(day.dateStr, true)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") toggleDayCollapse(day.dateStr, true);
													}}
												>
													<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
													<span className="day-date">{day.dateStr}</span>
													<span className="day-summary">
														{allReallyTaken ? (
															<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
														) : (
															<>
																{hasRealMissed && (
																	<AppTooltipTrigger
																		label={t("dashboard.schedules.missedDoses", { count: missedNotDismissedCount })}
																		className="day-warning"
																	>
																		⚠️
																	</AppTooltipTrigger>
																)}
																<span className="day-progress">
																	{takenCount}/{allDoseIds.length}
																</span>
															</>
														)}
													</span>
												</div>
												{!isCollapsed &&
													day.meds.map((item) => {
														const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
														const medCoverage = coverageByMed[item.medName];
														const isEmpty =
															emptyByOverviewName.has(item.medName) ||
															(medCoverage ? medCoverage.medsLeft <= 0 : false);
														const medOverview = medicationOverviewByName.get(item.medName);
														let stockStatus = null;
														if (!isEmpty && sharedStockThresholds) {
															if (medOverview && medOverview.currentStock !== null) {
																stockStatus = getStockStatus(
																	medOverview.daysLeft,
																	medOverview.currentStock,
																	sharedStockThresholds,
																	med?.packageType
																);
															} else if (medCoverage) {
																stockStatus = getStockStatus(
																	medCoverage.daysLeft,
																	medCoverage.medsLeft,
																	sharedStockThresholds,
																	med?.packageType
																);
															}
														}
														const isLowStock = stockStatus?.className === "warning";
														const rowClasses = ["time-row"];
														if (isEmpty) rowClasses.push("med-empty");
														else if (isLowStock) rowClasses.push("med-low");

														return (
															<div key={`${day.dateStr}-${item.medName}`} className={rowClasses.join(" ")}>
																<div className="time-main">
																	<div className="med-name">
																		<div
																			className={med?.imageUrl ? "med-avatar clickable" : ""}
																			onClick={() =>
																				med?.imageUrl && openLightbox(med.imageUrl, getMedDisplayName(med))
																			}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					e.preventDefault();
																					if (med?.imageUrl) openLightbox(med.imageUrl, getMedDisplayName(med));
																				}
																			}}
																			role={med?.imageUrl ? "button" : undefined}
																			tabIndex={med?.imageUrl ? 0 : undefined}
																		>
																			<MedicationAvatar
																				name={item.medName}
																				imageUrl={med?.imageUrl}
																				size="sm"
																				imageSrcResolver={sharedImageSrc}
																			/>
																		</div>
																		<div className="med-name-stack">
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</div>
																	</div>
																	<div className="tag-row">
																		<ScheduleUsageTag>
																			{formatTotalUsageLabel(med, item.total, item.doses)}
																		</ScheduleUsageTag>
																		{isEmpty ? (
																			<span className="tag danger">{t("status.outOfStock")}</span>
																		) : (
																			isLowStock && <span className="tag warning">{t("status.lowStock")}</span>
																		)}
																	</div>
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		const isTaken = isDoseTakenForDisplay(dose.id);
																		const isAutomaticallyTaken =
																			isTaken && isDoseTakenAutomatically(dose.id) && dose.when <= Date.now();
																		const isSkipped = dismissedDoses.has(dose.id);
																		const namedPeople = getDoseRecipientNames(dose.takenBy, med);
																		const doseClasses = ["dose-item", "past"];
																		if (isTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		if (namedPeople.length > 0) doseClasses.push("has-recipients");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				{renderDoseSummary(med, dose, namedPeople)}
																				<div
																					className={cx(
																						"dose-checks",
																						namedPeople.length > 0 && "has-recipient-summary"
																					)}
																				>
																					<div
																						className={`dose-person ${isTaken ? "taken" : ""} ${isSkipped ? "skipped" : ""}`}
																					>
																						{renderDosePersonName(namedPeople)}
																						{renderDoseActionButtons({
																							doseId: dose.id,
																							isTaken,
																							isSkipped,
																							isAutomaticallyTaken,
																							isEmpty,
																						})}
																					</div>
																				</div>
																			</div>
																		);
																	})}
																</div>
															</div>
														);
													})}
											</div>
										);
									})}
								{/* Past days toggle */}
								{!showOnlyToday &&
									pastDays.length > 0 &&
									(() => {
										const missedCount = missedPastDoseIds.length;
										const totalPastDoses = pastDays.flatMap((d) =>
											d.meds.flatMap((m) => m.doses.map((dose) => dose.id))
										);
										return (
											<div className="past-days-header">
												<div
													className={`past-days-toggle ${showPastDays ? "expanded" : ""} ${missedCount > 0 ? "has-missed" : ""}`}
													onClick={() => {
														const wasCollapsed = !showPastDays;
														setShowPastDays(!showPastDays);
														if (wasCollapsed) {
															setTimeout(() => {
																document
																	.querySelector(".day-block.today")
																	?.scrollIntoView({ behavior: "smooth", block: "center" });
															}, 50);
														}
													}}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") setShowPastDays(!showPastDays);
													}}
												>
													<span className="past-days-icon">{showPastDays ? "▼" : "▶"}</span>
													<span className="past-days-label">
														{showPastDays
															? t("dashboard.schedules.hidePastDays")
															: t("dashboard.schedules.showPastDays")}
													</span>
													<span className="past-days-count">
														({t("dashboard.schedules.pastDaysCount", { count: pastDays.length })})
													</span>
													{missedCount > 0 ? (
														<AppTooltipTrigger
															label={t("dashboard.schedules.missedDoses", { count: missedCount })}
															className="past-days-warning"
														>
															⚠️ {missedCount}
														</AppTooltipTrigger>
													) : totalPastDoses.length > 0 ? (
														<AppTooltipTrigger label={t("dashboard.schedules.allTaken")} className="past-days-complete">
															✓
														</AppTooltipTrigger>
													) : null}
												</div>
											</div>
										);
									})()}
								{/* Today (always visible) */}
								{todayDay &&
									(() => {
										const day = todayDay;
										const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));
										const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
										const takenCount = allDoseIds.filter((id) => isDoseTakenForDisplay(id)).length;
										const hasAutomaticTakenDose = allDoseIds.some((id) => isDoseTakenAutomatically(id));

										// Today: only collapse if manually collapsed or all taken
										const isAutoCollapsed = allDayTaken && !hasAutomaticTakenDose && !data.allowJournalNotes;
										const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
										const isManuallyCollapsed = manuallyCollapsedDays.has(day.dateStr);
										const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;

										return (
											<div
												key={day.dateStr}
												className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} today`}
											>
												<div
													className="day-divider clickable"
													onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") toggleDayCollapse(day.dateStr, isAutoCollapsed);
													}}
												>
													<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
													<span className="day-date">{day.dateStr}</span>
													<span className="day-summary">
														{allDayTaken ? (
															<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
														) : (
															<span className="day-progress">
																{takenCount}/{allDoseIds.length}
															</span>
														)}
													</span>
												</div>
												{!isCollapsed &&
													day.meds.map((item) => {
														const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
														const medCoverage = coverageByMed[item.medName];
														const isEmpty =
															emptyByOverviewName.has(item.medName) ||
															(medCoverage ? medCoverage.medsLeft <= 0 : false);
														const medOverview = medicationOverviewByName.get(item.medName);
														let stockStatus = null;
														if (!isEmpty && sharedStockThresholds) {
															if (medOverview && medOverview.currentStock !== null) {
																stockStatus = getStockStatus(
																	medOverview.daysLeft,
																	medOverview.currentStock,
																	sharedStockThresholds,
																	med?.packageType
																);
															} else if (medCoverage) {
																stockStatus = getStockStatus(
																	medCoverage.daysLeft,
																	medCoverage.medsLeft,
																	sharedStockThresholds,
																	med?.packageType
																);
															}
														}
														const isLowStock = stockStatus?.className === "warning";
														const rowClasses = ["time-row"];
														if (isEmpty) rowClasses.push("med-empty");
														else if (isLowStock) rowClasses.push("med-low");
														return (
															<div key={`${day.dateStr}-${item.medName}`} className={rowClasses.join(" ")}>
																<div className="time-main">
																	<div className="med-name">
																		<div
																			className={med?.imageUrl ? "med-avatar clickable" : ""}
																			onClick={() =>
																				med?.imageUrl && openLightbox(med.imageUrl, getMedDisplayName(med))
																			}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					e.preventDefault();
																					if (med?.imageUrl) openLightbox(med.imageUrl, getMedDisplayName(med));
																				}
																			}}
																			role={med?.imageUrl ? "button" : undefined}
																			tabIndex={med?.imageUrl ? 0 : undefined}
																		>
																			<MedicationAvatar
																				name={item.medName}
																				imageUrl={med?.imageUrl}
																				size="sm"
																				imageSrcResolver={sharedImageSrc}
																			/>
																		</div>
																		<div className="med-name-stack">
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</div>
																	</div>
																	<div className="tag-row">
																		<ScheduleUsageTag>
																			{formatTotalUsageLabel(med, item.total, item.doses)}
																		</ScheduleUsageTag>
																		{isEmpty ? (
																			<span className="tag danger">{t("status.outOfStock")}</span>
																		) : (
																			isLowStock && <span className="tag warning">{t("status.lowStock")}</span>
																		)}
																	</div>
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		const isTaken = isDoseTakenForDisplay(dose.id);
																		const isAutomaticallyTaken =
																			isTaken && isDoseTakenAutomatically(dose.id) && dose.when <= Date.now();
																		const isSkipped = dismissedDoses.has(dose.id);
																		const isOverdue = dose.when < Date.now() && !isTaken && !isSkipped && !isEmpty;
																		const namedPeople = getDoseRecipientNames(dose.takenBy, med);
																		const doseClasses = ["dose-item"];
																		if (isOverdue) doseClasses.push("overdue");
																		if (isTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		if (namedPeople.length > 0) doseClasses.push("has-recipients");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				{renderDoseSummary(med, dose, namedPeople)}
																				<div
																					className={cx(
																						"dose-checks",
																						namedPeople.length > 0 && "has-recipient-summary"
																					)}
																				>
																					<div
																						className={`dose-person ${isTaken ? "taken" : ""} ${isSkipped ? "skipped" : ""} ${isOverdue ? "overdue" : ""}`}
																					>
																						{renderDosePersonName(namedPeople)}
																						{renderDoseActionButtons({
																							doseId: dose.id,
																							isTaken,
																							isSkipped,
																							isAutomaticallyTaken,
																							isEmpty,
																						})}
																					</div>
																				</div>
																			</div>
																		);
																	})}
																</div>
															</div>
														);
													})}
											</div>
										);
									})()}

								{/* Future days toggle — identical to DashboardPage */}
								{!showOnlyToday &&
									futureDays.length > 0 &&
									(() => {
										const totalFutureDoses = futureDays.flatMap((d) =>
											d.meds.flatMap((m) => m.doses.map((dose) => dose.id))
										);
										const takenFutureDoses = totalFutureDoses.filter((id) => isDoseTakenForDisplay(id)).length;
										return (
											<div className="future-days-header">
												<div
													className={`future-days-toggle ${showFutureDays ? "expanded" : ""}`}
													onClick={() => setShowFutureDays(!showFutureDays)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") setShowFutureDays(!showFutureDays);
													}}
												>
													<span className="future-days-icon">{showFutureDays ? "▼" : "▶"}</span>
													<span className="future-days-label">
														{showFutureDays
															? t("dashboard.schedules.hideFutureDays")
															: t("dashboard.schedules.showFutureDays")}
													</span>
													<span className="future-days-count">
														({t("dashboard.schedules.futureDaysCount", { count: futureDays.length })})
													</span>
													{takenFutureDoses > 0 && totalFutureDoses.length > 0 && (
														<span className="future-days-progress">
															{takenFutureDoses}/{totalFutureDoses.length}
														</span>
													)}
												</div>
											</div>
										);
									})()}

								{/* Future days (when expanded) — identical to DashboardPage */}
								{!showOnlyToday &&
									showFutureDays &&
									futureDays.map((day) => {
										const allDoseIds = day.meds.flatMap((item) => item.doses.map((d) => d.id));
										const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => isDoseTakenForDisplay(id));
										const takenCount = allDoseIds.filter((id) => isDoseTakenForDisplay(id)).length;

										// Future days: collapsed by default, manual override to expand
										const isAutoCollapsed = true;
										const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
										const isCollapsed = !isManuallyExpanded;

										return (
											<div
												key={day.dateStr}
												className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""}`}
											>
												<div
													className="day-divider clickable"
													onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
													onKeyDown={(e) => {
														if (e.key === "Enter" || e.key === " ") toggleDayCollapse(day.dateStr, isAutoCollapsed);
													}}
												>
													<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
													<span className="day-date">{day.dateStr}</span>
													<span className="day-summary">
														{allDayTaken ? (
															<span className="day-complete">✓ {t("dashboard.schedules.allTaken")}</span>
														) : (
															<span className="day-progress">
																{takenCount}/{allDoseIds.length}
															</span>
														)}
													</span>
												</div>
												{!isCollapsed &&
													day.meds.map((item) => {
														const med = data.medications.find((m) => getMedDisplayName(m) === item.medName);
														const medCoverage = coverageByMed[item.medName];
														const isEmpty =
															emptyByOverviewName.has(item.medName) ||
															(medCoverage ? medCoverage.medsLeft <= 0 : false);
														const medOverview = medicationOverviewByName.get(item.medName);
														let stockStatus = null;
														if (!isEmpty && sharedStockThresholds) {
															if (medOverview && medOverview.currentStock !== null) {
																stockStatus = getStockStatus(
																	medOverview.daysLeft,
																	medOverview.currentStock,
																	sharedStockThresholds,
																	med?.packageType
																);
															} else if (medCoverage) {
																stockStatus = getStockStatus(
																	medCoverage.daysLeft,
																	medCoverage.medsLeft,
																	sharedStockThresholds,
																	med?.packageType
																);
															}
														}
														const isLowStock = stockStatus?.className === "warning";
														const rowClasses = ["time-row"];
														if (isEmpty) rowClasses.push("med-empty");
														else if (isLowStock) rowClasses.push("med-low");
														return (
															<div key={`${day.dateStr}-${item.medName}`} className={rowClasses.join(" ")}>
																<div className="time-main">
																	<div className="med-name">
																		<div
																			className={med?.imageUrl ? "med-avatar clickable" : ""}
																			onClick={() =>
																				med?.imageUrl && openLightbox(med.imageUrl, getMedDisplayName(med))
																			}
																			onKeyDown={(e) => {
																				if (e.key === "Enter" || e.key === " ") {
																					e.preventDefault();
																					if (med?.imageUrl) openLightbox(med.imageUrl, getMedDisplayName(med));
																				}
																			}}
																			role={med?.imageUrl ? "button" : undefined}
																			tabIndex={med?.imageUrl ? 0 : undefined}
																		>
																			<MedicationAvatar
																				name={item.medName}
																				imageUrl={med?.imageUrl}
																				size="sm"
																				imageSrcResolver={sharedImageSrc}
																			/>
																		</div>
																		<div className="med-name-stack">
																			<span className="med-name-text">{item.medName}</span>
																			{med?.genericName && (
																				<span className="med-generic-inline">{med.genericName}</span>
																			)}
																		</div>
																	</div>
																	<div className="tag-row">
																		<ScheduleUsageTag>
																			{formatTotalUsageLabel(med, item.total, item.doses)}
																		</ScheduleUsageTag>
																		{isEmpty ? (
																			<span className="tag danger">{t("status.outOfStock")}</span>
																		) : (
																			isLowStock && <span className="tag warning">{t("status.lowStock")}</span>
																		)}
																	</div>
																</div>
																<div className="doses-col">
																	{item.doses.map((dose) => {
																		const isTaken = isDoseTakenForDisplay(dose.id);
																		const isAutomaticallyTaken =
																			isTaken && isDoseTakenAutomatically(dose.id) && dose.when <= Date.now();
																		const isSkipped = dismissedDoses.has(dose.id);
																		const namedPeople = getDoseRecipientNames(dose.takenBy, med);
																		const doseClasses = ["dose-item", "future"];
																		if (isTaken) doseClasses.push("all-taken");
																		if (isEmpty) doseClasses.push("med-empty");
																		else if (isLowStock) doseClasses.push("med-low");
																		if (namedPeople.length > 0) doseClasses.push("has-recipients");
																		return (
																			<div key={dose.id} className={doseClasses.join(" ")}>
																				{renderDoseSummary(med, dose, namedPeople)}
																				<div
																					className={cx(
																						"dose-checks",
																						namedPeople.length > 0 && "has-recipient-summary"
																					)}
																				>
																					<div
																						className={`dose-person ${isTaken ? "taken" : ""} ${isSkipped ? "skipped" : ""}`}
																					>
																						{renderDosePersonName(namedPeople)}
																						{renderDoseActionButtons({
																							doseId: dose.id,
																							isTaken,
																							isSkipped,
																							isAutomaticallyTaken,
																							isEmpty: true,
																						})}
																					</div>
																				</div>
																			</div>
																		);
																	})}
																</div>
															</div>
														);
													})}
											</div>
										);
									})}
							</>
						)}
					</div>
				</section>

				<footer className={sharedClasses["shared-schedule-footer"]}>
					<p>
						{t("share.generatedBy")}{" "}
						{data?.sharedBy && (
							<>
								<strong>{data.sharedBy}</strong>
								{" - "}
							</>
						)}
						<a href="/">MedAssist</a>
					</p>
				</footer>
			</div>

			{/* Image Lightbox */}
			{lightboxImage && (
				<Lightbox src={sharedImageSrc(lightboxImage.url)} alt={lightboxImage.name} onClose={closeLightbox} />
			)}

			<IntakeJournalModal
				isOpen={sharedJournalOpen}
				entry={sharedJournalEntry}
				isLoading={sharedJournalLoading}
				isSaving={sharedJournalSaving}
				isDeleting={false}
				error={sharedJournalError}
				onClose={closeSharedJournalEditor}
				onSave={saveSharedJournalNote}
				onDelete={() => undefined}
				allowDelete={false}
			/>
		</div>
	);
}
