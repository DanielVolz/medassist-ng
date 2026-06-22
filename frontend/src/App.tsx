import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { AuthPage, AuthProvider, useAuth } from "./components/Auth";
import { AppProvider, FeedbackProvider, UnsavedChangesProvider, useAppContext, useShareContext } from "./context";
import { useScrollLock } from "./hooks/useScrollLock";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage })));
const MedicationsPage = lazy(() =>
	import("./pages/MedicationsPage").then((module) => ({ default: module.MedicationsPage }))
);
const PlannerPage = lazy(() => import("./pages/PlannerPage").then((module) => ({ default: module.PlannerPage })));
const SchedulePage = lazy(() => import("./pages/SchedulePage").then((module) => ({ default: module.SchedulePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const SharedOverviewPage = lazy(() =>
	import("./pages/SharedOverviewPage").then((module) => ({ default: module.SharedOverviewPage }))
);
const SharedSchedule = lazy(() =>
	import("./components/SharedSchedule").then((module) => ({ default: module.SharedSchedule }))
);
const AboutModal = lazy(() => import("./components/AboutModal"));
const ProfileModal = lazy(() => import("./components/ProfileModal"));
const MedDetailModal = lazy(() =>
	import("./components/MedDetailModal").then((module) => ({ default: module.MedDetailModal }))
);
const ShareDialog = lazy(() => import("./components/ShareDialog").then((module) => ({ default: module.ShareDialog })));
const UserFilterModal = lazy(() =>
	import("./components/UserFilterModal").then((module) => ({ default: module.UserFilterModal }))
);
const Lightbox = lazy(() => import("./components/Lightbox").then((module) => ({ default: module.Lightbox })));

// Vite injects this at build time from package.json
declare const __APP_VERSION__: string;
export const FRONTEND_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";
const GITHUB_REPO = "DanielVolz/medassist-ng";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

function RouteLoadingFallback() {
	const { t } = useTranslation();

	return <div style={{ padding: "1rem", textAlign: "center" }}>{t("common.loading")}</div>;
}

function AuthStatusCard({ theme, children }: { theme: "light" | "dark"; children: React.ReactNode }) {
	return (
		<div className="auth-container" data-theme={theme}>
			<div className="auth-card" style={{ textAlign: "center" }}>
				<h1 className="auth-title">💊 MedAssist-ng</h1>
				{children}
			</div>
		</div>
	);
}

// =============================================================================
// Main App Wrapper with Auth
// =============================================================================
export default function App() {
	// Close tooltips on scroll/touch (for mobile). Keep this in the public
	// wrapper too so shared links get the same tooltip behavior as the app.
	useEffect(() => {
		const closeAllTooltips = () => {
			document.querySelectorAll(".info-tooltip.tooltip-active, .tooltip-trigger.tooltip-active").forEach((el) => {
				el.classList.remove("tooltip-active");
			});
		};

		const handleTooltipClick = (e: Event) => {
			const target = e.target as HTMLElement;
			const tooltipTrigger = target.closest(".info-tooltip, .tooltip-trigger") as HTMLElement | null;
			if (tooltipTrigger) {
				closeAllTooltips();
				tooltipTrigger.classList.add("tooltip-active");
				if (window.innerWidth <= 640) {
					const rect = tooltipTrigger.getBoundingClientRect();
					tooltipTrigger.style.setProperty("--tooltip-bottom", `${window.innerHeight - rect.top + 8}px`);
				}
			} else {
				closeAllTooltips();
			}
		};

		const handleTouchMove = () => {
			closeAllTooltips();
		};

		document.addEventListener("click", handleTooltipClick, { capture: true });
		document.addEventListener("touchmove", handleTouchMove, { passive: true });
		document.addEventListener("scroll", handleTouchMove, { passive: true });
		return () => {
			document.removeEventListener("click", handleTooltipClick, { capture: true });
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("scroll", handleTouchMove);
		};
	}, []);

	return (
		<AuthProvider>
			<FeedbackProvider>
				<Suspense fallback={<RouteLoadingFallback />}>
					<Routes>
						{/* Public share route - accessible without auth */}
						<Route path="/share/:token/overview" element={<SharedOverviewPage />} />
						<Route path="/share/:token" element={<SharedSchedule />} />
						{/* All other routes go through AppRouter */}
						<Route path="*" element={<AppRouter />} />
					</Routes>
				</Suspense>
			</FeedbackProvider>
		</AuthProvider>
	);
}

function getInitialAuthTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "dark";

	const stored = localStorage.getItem("theme");
	if (stored === "light" || stored === "dark") {
		return stored;
	}

	if (stored === "system") {
		return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
	}

	return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function AppRouter() {
	const { t } = useTranslation();
	const { user, authState, loading, authError } = useAuth();
	const authTheme = getInitialAuthTheme();

	// Show loading while checking auth state
	if (loading) {
		return (
			<AuthStatusCard theme={authTheme}>
				<p>{t("common.loading")}</p>
			</AuthStatusCard>
		);
	}

	// Show error if we couldn't connect to the server
	if (authError) {
		return (
			<AuthStatusCard theme={authTheme}>
				<div className="auth-error" style={{ marginBottom: "1rem" }}>
					<strong>{t("auth.connectionErrorTitle")}</strong>
					<br />
					{authError}
				</div>
				<p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>{t("auth.connectionErrorHelp")}</p>
				<button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: "1rem" }}>
					{t("common.retry")}
				</button>
			</AuthStatusCard>
		);
	}

	// If auth state is null (shouldn't happen after loading, but be safe)
	if (!authState) {
		return (
			<AuthStatusCard theme={authTheme}>
				<p>{t("common.initializing")}</p>
			</AuthStatusCard>
		);
	}

	// If auth is enabled
	if (authState.authEnabled) {
		// Need to register first user
		if (authState.needsSetup) {
			return <AuthPage />;
		}
		// Not logged in
		if (!user) {
			return <AuthPage />;
		}
	}

	// Auth disabled or user is logged in - show main app
	return (
		<UnsavedChangesProvider>
			<AppProvider>
				<AppContent />
			</AppProvider>
		</UnsavedChangesProvider>
	);
}

// =============================================================================
// Main App Content
// =============================================================================

function AppContent() {
	const navigate = useNavigate();
	const location = useLocation();
	// Get shared state from AppContext
	const ctx = useAppContext();
	const shareCtx = useShareContext();
	const {
		// Medications
		meds,
		loadMeds,
		// Refill
		showRefillModal,
		setShowRefillModal,
		refillPacks,
		setRefillPacks,
		refillLoose,
		setRefillLoose,
		usePrescriptionRefill,
		setUsePrescriptionRefill,
		refillSaving,
		refillHistory,
		refillHistoryExpanded,
		setRefillHistoryExpanded,
		showEditStockModal,
		setShowEditStockModal,
		editStockFullBlisters,
		setEditStockFullBlisters,
		editStockPartialBlisterPills,
		setEditStockPartialBlisterPills,
		editStockLoosePills,
		setEditStockLoosePills,
		editStockSaving,
		editStockMedication,
		openRefillModal,
		closeRefillModal,
		openEditStockModal,
		closeEditStockModal,
		// Computed
		coverage,
		// Modal state
		selectedMed,
		setSelectedMed,
		showImageLightbox,
		setShowImageLightbox,
		scheduleLightboxImage,
		setScheduleLightboxImage,
		selectedUser,
		setSelectedUser,
		// Modal helpers
		openMedDetail,
		closeMedDetail,
		openImageLightbox,
		closeImageLightbox,
		closeScheduleLightbox,
		closeUserFilter,
	} = ctx;

	const {
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
		shareAllowMarkTaken,
		setShareAllowMarkTaken,
		shareGenerating,
		shareLink,
		setShareLink,
		shareCopied,
		setShareCopied,
		activeShareLinks,
		activeSharesLoading,
		revokingShareToken,
		regeneratingShareToken,
		generateShareLink,
		revokeShareLink,
		regenerateShareLink,
		copyShareLink,
		closeShareDialog,
		resetShareDialogState,
	} = shareCtx;

	// Local-only state (not shared across components)
	const [showProfile, setShowProfile] = useState(false);
	const [showAbout, setShowAbout] = useState(false);
	const [routeTransitionMaskActive, setRouteTransitionMaskActive] = useState(false);
	const routeTransitionMinEndRef = useRef(0);
	const routeTransitionFallbackTimerRef = useRef<number | null>(null);
	const closeProfile = useCallback(() => {
		if (showProfile) {
			window.history.back();
		}
	}, [showProfile]);

	const closeAbout = useCallback(() => {
		if (showAbout) {
			window.history.back();
		}
	}, [showAbout]);

	// Get centralized stockThresholds from context
	const { stockThresholds } = ctx;

	// Handle browser back button to close modals (in priority order)
	useEffect(() => {
		const handlePopState = () => {
			// Close modals in order of priority (topmost first)
			// NOTE: This handler MUST NOT call history.back() or it will cause infinite loops
			// Only use direct state setters here
			if (showImageLightbox) {
				setShowImageLightbox(false);
			} else if (scheduleLightboxImage) {
				setScheduleLightboxImage(null);
			} else if (showEditStockModal) {
				setShowEditStockModal(false);
			} else if (showRefillModal) {
				setShowRefillModal(false);
			} else if (showShareDialog) {
				resetShareDialogState();
			} else if (showAbout) {
				setShowAbout(false);
			} else if (showProfile) {
				setShowProfile(false);
			} else if (selectedUser) {
				setSelectedUser(null);
			} else if (selectedMed) {
				setSelectedMed(null);
			}
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, [
		selectedMed,
		showImageLightbox,
		scheduleLightboxImage,
		selectedUser,
		showProfile,
		showAbout,
		showShareDialog,
		showRefillModal,
		showEditStockModal,
		resetShareDialogState,
		setScheduleLightboxImage,
		setSelectedMed,
		setSelectedUser,
		setShowEditStockModal,
		setShowImageLightbox,
		setShowRefillModal,
	]);

	// Global Escape handling in priority order.
	// This keeps behavior consistent even when child modals are mocked in tests.
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (e.defaultPrevented) return;

			if (scheduleLightboxImage) {
				closeScheduleLightbox();
				return;
			}
			if (showImageLightbox) {
				closeImageLightbox();
				return;
			}
			if (showEditStockModal) {
				closeEditStockModal();
				return;
			}
			if (showRefillModal) {
				closeRefillModal();
				return;
			}
			if (showShareDialog) {
				closeShareDialog();
				return;
			}
			if (showAbout) {
				closeAbout();
				return;
			}
			if (showProfile) {
				closeProfile();
				return;
			}
			if (selectedUser) {
				closeUserFilter();
				return;
			}
			if (selectedMed) {
				closeMedDetail();
			}
		};

		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [
		showImageLightbox,
		scheduleLightboxImage,
		showEditStockModal,
		showRefillModal,
		showShareDialog,
		showAbout,
		showProfile,
		selectedUser,
		selectedMed,
		closeImageLightbox,
		closeScheduleLightbox,
		closeEditStockModal,
		closeRefillModal,
		closeShareDialog,
		closeAbout,
		closeProfile,
		closeUserFilter,
		closeMedDetail,
	]);

	// Prevent background scroll when any modal is open
	useScrollLock(
		!!(
			selectedMed ||
			selectedUser ||
			showProfile ||
			showAbout ||
			showShareDialog ||
			showRefillModal ||
			showEditStockModal ||
			showImageLightbox ||
			scheduleLightboxImage
		)
	);

	// Update selectedMed when meds change (e.g., after refill)
	useEffect(() => {
		if (selectedMed) {
			const updated = meds.find((m) => m.id === selectedMed.id);
			if (
				updated &&
				(updated.packCount !== selectedMed.packCount ||
					updated.looseTablets !== selectedMed.looseTablets ||
					updated.updatedAt !== selectedMed.updatedAt)
			) {
				setSelectedMed(updated);
			}
		}
	}, [meds, selectedMed, setSelectedMed]);

	const stockCorrectionMed = selectedMed ?? (showEditStockModal ? editStockMedication : null);

	const handleSubmitStockCorrection = async (medId: number) => {
		if (!stockCorrectionMed) return;
		await ctx.submitStockCorrection(medId, stockCorrectionMed, loadMeds);
	};

	// For MedDetailModal: refill without form update (not editing)
	const handleSubmitRefill = async (medId: number, usePrescription: boolean = false) => {
		await ctx.submitRefill(medId, null, () => {}, loadMeds, usePrescription);
	};

	useEffect(() => {
		if (!routeTransitionMaskActive) return;
		if (location.pathname !== "/medications") return;

		const hasEditMedIdParam = new URLSearchParams(location.search).has("editMedId");
		if (hasEditMedIdParam) return;

		const remaining = Math.max(0, routeTransitionMinEndRef.current - performance.now());
		const timer = window.setTimeout(() => setRouteTransitionMaskActive(false), remaining);
		return () => window.clearTimeout(timer);
	}, [location.pathname, location.search, routeTransitionMaskActive]);

	useEffect(() => {
		const handleEditTransitionReady = () => {
			if (!routeTransitionMaskActive) return;
			const remaining = Math.max(0, routeTransitionMinEndRef.current - performance.now());
			window.setTimeout(() => {
				setRouteTransitionMaskActive(false);
				if (routeTransitionFallbackTimerRef.current !== null) {
					window.clearTimeout(routeTransitionFallbackTimerRef.current);
					routeTransitionFallbackTimerRef.current = null;
				}
			}, remaining);
		};

		window.addEventListener("medassist:edit-transition-ready", handleEditTransitionReady);
		return () => {
			window.removeEventListener("medassist:edit-transition-ready", handleEditTransitionReady);
		};
	}, [routeTransitionMaskActive]);

	useEffect(() => {
		return () => {
			if (routeTransitionFallbackTimerRef.current !== null) {
				window.clearTimeout(routeTransitionFallbackTimerRef.current);
			}
		};
	}, []);

	const handleOpenMedicationEdit = () => {
		if (!selectedMed) return;
		const medId = selectedMed.id;
		routeTransitionMinEndRef.current = performance.now() + 80;
		setRouteTransitionMaskActive(true);
		if (routeTransitionFallbackTimerRef.current !== null) {
			window.clearTimeout(routeTransitionFallbackTimerRef.current);
		}
		routeTransitionFallbackTimerRef.current = window.setTimeout(() => {
			setRouteTransitionMaskActive(false);
			routeTransitionFallbackTimerRef.current = null;
		}, 700);
		setShowImageLightbox(false);
		setShowRefillModal(false);
		setShowEditStockModal(false);
		setSelectedMed(null);
		navigate(`/medications?editMedId=${medId}`);
	};

	const handleOpenEditStockFromDetail = () => {
		if (!selectedMed) return;
		openEditStockModal(selectedMed, coverage);
	};

	const openProfile = useCallback(() => {
		setShowProfile(true);
		window.history.pushState({ modal: "profile" }, "");
	}, []);

	const openAbout = useCallback(() => {
		setShowAbout(true);
		window.history.pushState({ modal: "about" }, "");
	}, []);

	return (
		<main className="page">
			<AppHeader onOpenProfile={openProfile} onOpenAbout={openAbout} />

			{/* Profile Modal */}
			{showProfile && (
				<Suspense fallback={null}>
					<ProfileModal isOpen={showProfile} onClose={closeProfile} />
				</Suspense>
			)}

			{/* About Modal */}
			{showAbout && (
				<Suspense fallback={null}>
					<AboutModal isOpen={showAbout} onClose={closeAbout} />
				</Suspense>
			)}

			<Suspense fallback={<RouteLoadingFallback />}>
				<Routes>
					<Route path="/" element={<Navigate to={{ pathname: "/dashboard", search: location.search }} replace />} />
					<Route path="/dashboard" element={<DashboardPage />} />

					<Route path="/medications" element={<MedicationsPage />} />

					<Route path="/planner" element={<PlannerPage />} />

					<Route path="/settings" element={<SettingsPage />} />

					<Route path="/schedule" element={<SchedulePage />} />
					{/* Catch-all: redirect unknown routes to dashboard */}
					<Route path="*" element={<Navigate to="/dashboard" replace />} />
				</Routes>
			</Suspense>

			{/* Medication Detail Modal */}
			{stockCorrectionMed && (
				<Suspense fallback={null}>
					<MedDetailModal
						selectedMed={stockCorrectionMed}
						coverage={coverage}
						settings={stockThresholds}
						showImageLightbox={showImageLightbox}
						showRefillModal={showRefillModal}
						showEditStockModal={showEditStockModal}
						editStockOnly={showEditStockModal && !selectedMed}
						onClose={closeMedDetail}
						onOpenImageLightbox={openImageLightbox}
						onCloseImageLightbox={closeImageLightbox}
						onOpenRefillModal={openRefillModal}
						onCloseRefillModal={closeRefillModal}
						onOpenMedicationEdit={handleOpenMedicationEdit}
						onOpenEditStockModal={handleOpenEditStockFromDetail}
						onCloseEditStockModal={closeEditStockModal}
						refillPacks={refillPacks}
						onRefillPacksChange={setRefillPacks}
						refillLoose={refillLoose}
						onRefillLooseChange={setRefillLoose}
						usePrescriptionRefill={usePrescriptionRefill}
						onUsePrescriptionRefillChange={setUsePrescriptionRefill}
						refillSaving={refillSaving}
						refillHistory={refillHistory}
						refillHistoryExpanded={refillHistoryExpanded}
						onRefillHistoryExpandedChange={setRefillHistoryExpanded}
						onSubmitRefill={handleSubmitRefill}
						editStockFullBlisters={editStockFullBlisters}
						onEditStockFullBlistersChange={setEditStockFullBlisters}
						editStockPartialBlisterPills={editStockPartialBlisterPills}
						onEditStockPartialBlisterPillsChange={setEditStockPartialBlisterPills}
						editStockLoosePills={editStockLoosePills}
						onEditStockLoosePillsChange={setEditStockLoosePills}
						editStockSaving={editStockSaving}
						onSubmitStockCorrection={handleSubmitStockCorrection}
					/>
				</Suspense>
			)}

			{/* User Medications Modal */}
			{selectedUser && (
				<Suspense fallback={null}>
					<UserFilterModal
						selectedUser={selectedUser}
						meds={meds}
						coverage={coverage}
						settings={stockThresholds}
						onClose={closeUserFilter}
						onClearUser={() => {
							setSelectedUser(null);
							// Replace the userFilter history entry so it doesn't remain on the stack
							window.history.replaceState(null, "");
						}}
						onOpenMedDetail={openMedDetail}
					/>
				</Suspense>
			)}

			{/* Share Dialog Modal */}
			{showShareDialog && (
				<Suspense fallback={null}>
					<ShareDialog
						show={showShareDialog}
						sharePeople={sharePeople}
						shareSelectedPerson={shareSelectedPerson}
						onShareSelectedPersonChange={setShareSelectedPerson}
						shareSelectedDays={shareSelectedDays}
						onShareSelectedDaysChange={setShareSelectedDays}
						shareSelectedExpiryDays={shareSelectedExpiryDays}
						onShareSelectedExpiryDaysChange={setShareSelectedExpiryDays}
						shareAllowJournalNotes={shareAllowJournalNotes}
						onShareAllowJournalNotesChange={setShareAllowJournalNotes}
						shareAllowMarkTaken={shareAllowMarkTaken}
						onShareAllowMarkTakenChange={setShareAllowMarkTaken}
						shareGenerating={shareGenerating}
						shareLink={shareLink}
						onShareLinkChange={setShareLink}
						shareCopied={shareCopied}
						onShareCopiedChange={setShareCopied}
						activeShareLinks={activeShareLinks}
						activeSharesLoading={activeSharesLoading}
						revokingShareToken={revokingShareToken}
						regeneratingShareToken={regeneratingShareToken}
						onClose={closeShareDialog}
						onGenerateShareLink={generateShareLink}
						onRevokeShareLink={revokeShareLink}
						onRegenerateShareLink={regenerateShareLink}
						onCopyShareLink={copyShareLink}
					/>
				</Suspense>
			)}

			{/* Schedule Lightbox - for clicking medication images in schedule */}
			{scheduleLightboxImage && (
				<Suspense fallback={null}>
					<Lightbox src={scheduleLightboxImage} alt="Medication" onClose={closeScheduleLightbox} />
				</Suspense>
			)}

			<div className={`route-transition-mask${routeTransitionMaskActive ? " active" : ""}`} aria-hidden="true" />
		</main>
	);
}
