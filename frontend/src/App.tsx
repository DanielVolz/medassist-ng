import { Alert, Box, Center, Paper, Stack, Text, Title } from "@mantine/core";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import classes from "./App.module.css";
import "./AppSurfaces.css";
import { AppHeader } from "./components/AppHeader";
import { AuthPage, AuthProvider, useAuth } from "./components/Auth";
import { AppProvider, FeedbackProvider, UnsavedChangesProvider, useAppContext, useShareContext } from "./context";
import { useModalHistory } from "./hooks/useModalHistory";
import { useScrollLock } from "./hooks/useScrollLock";
import { AppButton } from "./ui/primitives/AppButton";

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

	return (
		<Center className={classes.routeLoading}>
			<Text>{t("common.loading")}</Text>
		</Center>
	);
}

function AuthStatusCard({ theme, children }: { theme: "light" | "dark"; children: React.ReactNode }) {
	return (
		<Center className={classes.authStatusShell} data-testid="auth-status" data-theme={theme}>
			<Paper className={classes.authStatusCard}>
				<Title className={classes.authStatusTitle} order={1}>
					💊 MedAssist-ng
				</Title>
				{children}
			</Paper>
		</Center>
	);
}

// =============================================================================
// Main App Wrapper with Auth
// =============================================================================
export default function App() {
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
				<Text>{t("common.loading")}</Text>
			</AuthStatusCard>
		);
	}

	// Show error if we couldn't connect to the server
	if (authError) {
		return (
			<AuthStatusCard theme={authTheme}>
				<Stack align="center" gap="md">
					<Alert className={classes.authStatusError} color="red" title={t("auth.connectionErrorTitle")}>
						{authError}
					</Alert>
					<Text className={classes.authStatusHelp}>{t("auth.connectionErrorHelp")}</Text>
					<AppButton onClick={() => window.location.reload()} tone="primary">
						{t("common.retry")}
					</AppButton>
				</Stack>
			</AuthStatusCard>
		);
	}

	// If auth state is null (shouldn't happen after loading, but be safe)
	if (!authState) {
		return (
			<AuthStatusCard theme={authTheme}>
				<Text>{t("common.initializing")}</Text>
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
		selectedUser,
		setSelectedUser,
		// Modal helpers
		openMedDetail,
		closeMedDetail,
		openImageLightbox,
		closeImageLightbox,
		closeScheduleLightbox,
		openUserFilter,
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
	} = shareCtx;

	// Local-only state (not shared across components)
	const [showProfile, setShowProfile] = useState(false);
	const [showAbout, setShowAbout] = useState(false);
	const [routeTransitionMaskActive, setRouteTransitionMaskActive] = useState(false);
	const routeTransitionMinEndRef = useRef(0);
	const routeTransitionFallbackTimerRef = useRef<number | null>(null);
	const dismissProfile = useCallback(() => {
		setShowProfile(false);
	}, []);
	const dismissAbout = useCallback(() => {
		setShowAbout(false);
	}, []);
	// History integration via the shared modal stack: pushes one entry on open,
	// browser back (or closeModal) dismisses only the topmost modal.
	const { closeModal: closeProfile } = useModalHistory(showProfile, "profile", dismissProfile);
	const { closeModal: closeAbout } = useModalHistory(showAbout, "about", dismissAbout);

	// Get centralized stockThresholds from context
	const { stockThresholds } = ctx;

	// Browser-back handling for ALL modals goes through useModalHistory's shared
	// modal stack (capture-phase popstate listener per modal). There must be no
	// additional app-level popstate handler: a second handler closing modals by
	// its own priority order desynchronizes from the stack and dismisses the
	// wrong (parent) modal, e.g. closing the medication detail modal while the
	// nested refill modal stays stuck open.

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
	}, []);

	const openAbout = useCallback(() => {
		setShowAbout(true);
	}, []);

	return (
		<Box className={classes.page} component="main" data-testid="app-shell">
			<div aria-hidden="true" className={classes.topBlur} data-testid="app-shell-top-blur" />
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
						onOpenUserFilter={openUserFilter}
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

			<Box
				aria-hidden="true"
				className={`${classes.routeTransitionMask}${routeTransitionMaskActive ? ` ${classes.routeTransitionMaskActive}` : ""}`}
			/>
		</Box>
	);
}
