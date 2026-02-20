import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import {
	AboutModal,
	Lightbox,
	MedDetailModal,
	ProfileModal,
	ShareDialog,
	SharedSchedule,
	UserFilterModal,
} from "./components";
import { AppHeader } from "./components/AppHeader";
import { AuthPage, AuthProvider, useAuth } from "./components/Auth";
import { AppProvider, UnsavedChangesProvider, useAppContext } from "./context";
import { DashboardPage, MedicationsPage, PlannerPage, SchedulePage, SettingsPage } from "./pages";

// Vite injects this at build time from package.json
declare const __APP_VERSION__: string;
export const FRONTEND_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "unknown";
const GITHUB_REPO = "DanielVolz/medassist-ng";
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

// =============================================================================
// Main App Wrapper with Auth
// =============================================================================
export default function App() {
	return (
		<AuthProvider>
			<Routes>
				{/* Public share route - accessible without auth */}
				<Route path="/share/:token" element={<SharedSchedule />} />
				{/* All other routes go through AppRouter */}
				<Route path="*" element={<AppRouter />} />
			</Routes>
		</AuthProvider>
	);
}

function AppRouter() {
	const { user, authState, loading, authError } = useAuth();

	// Show loading while checking auth state
	if (loading) {
		return (
			<div className="auth-container">
				<div className="auth-card" style={{ textAlign: "center" }}>
					<h1 className="auth-title">💊 MedAssist-ng</h1>
					<p>Loading...</p>
				</div>
			</div>
		);
	}

	// Show error if we couldn't connect to the server
	if (authError) {
		return (
			<div className="auth-container">
				<div className="auth-card" style={{ textAlign: "center" }}>
					<h1 className="auth-title">💊 MedAssist-ng</h1>
					<div className="auth-error" style={{ marginBottom: "1rem" }}>
						<strong>Connection Error</strong>
						<br />
						{authError}
					</div>
					<p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
						Please check if the server is running and try again.
					</p>
					<button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: "1rem" }}>
						Retry
					</button>
				</div>
			</div>
		);
	}

	// If auth state is null (shouldn't happen after loading, but be safe)
	if (!authState) {
		return (
			<div className="auth-container">
				<div className="auth-card" style={{ textAlign: "center" }}>
					<h1 className="auth-title">💊 MedAssist-ng</h1>
					<p>Initializing...</p>
				</div>
			</div>
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
	// Get shared state from AppContext
	const ctx = useAppContext();
	const {
		// Medications
		meds,
		loadMeds,
		// Settings
		settings,
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
		// Share
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
		generateShareLink,
		copyShareLink,
		closeShareDialog,
		resetShareDialogState,
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

	// Wrapper to pass meds to openShareDialog
	const _openShareDialog = () => ctx.openShareDialog();

	// Local-only state (not shared across components)
	const [showProfile, setShowProfile] = useState(false);
	const [showAbout, setShowAbout] = useState(false);

	// Get centralized stockThresholds from context
	const { stockThresholds } = ctx;

	// Close modal on Escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Close modals in order of priority (topmost first)
				if (scheduleLightboxImage) {
					closeScheduleLightbox();
				} else if (showImageLightbox) {
					closeImageLightbox();
				} else if (showEditStockModal) {
					closeEditStockModal();
				} else if (showRefillModal) {
					closeRefillModal();
				} else if (showShareDialog) {
					closeShareDialog();
				} else if (showAbout) {
					closeAbout();
				} else if (showProfile) {
					closeProfile();
				} else if (selectedUser) {
					closeUserFilter();
				} else if (selectedMed) {
					closeMedDetail();
				}
			}
		};
		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
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
		closeAbout,
		closeEditStockModal,
		closeImageLightbox,
		closeMedDetail,
		closeProfile,
		closeRefillModal,
		closeScheduleLightbox,
		closeShareDialog,
		closeUserFilter,
	]);

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

	// Close tooltips on scroll/touch (for mobile)
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
				// Close other tooltips first
				closeAllTooltips();
				// Toggle this one
				tooltipTrigger.classList.add("tooltip-active");
				// Position tooltip above the icon on mobile
				if (window.innerWidth <= 640) {
					const rect = tooltipTrigger.getBoundingClientRect();
					// Place tooltip bottom edge just above the icon
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

	// Prevent background scroll when modal is open
	useEffect(() => {
		const isModalOpen = selectedMed || selectedUser || showProfile || showAbout || showShareDialog;
		if (isModalOpen) {
			document.documentElement.classList.add("modal-open");
			document.body.classList.add("modal-open");
		} else {
			document.documentElement.classList.remove("modal-open");
			document.body.classList.remove("modal-open");
		}
		return () => {
			document.documentElement.classList.remove("modal-open");
			document.body.classList.remove("modal-open");
		};
	}, [selectedMed, selectedUser, showProfile, showAbout, showShareDialog]);

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

	const handleOpenMedicationEdit = () => {
		if (!selectedMed) return;
		const medId = selectedMed.id;
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

	function openProfile() {
		setShowProfile(true);
		window.history.pushState({ modal: "profile" }, "");
	}
	function closeProfile() {
		if (showProfile) {
			window.history.back();
		}
	}

	function openAbout() {
		setShowAbout(true);
		window.history.pushState({ modal: "about" }, "");
	}
	function closeAbout() {
		if (showAbout) {
			window.history.back();
		}
	}

	return (
		<main className="page">
			<AppHeader onOpenProfile={openProfile} onOpenAbout={openAbout} />

			{/* Profile Modal */}
			<ProfileModal isOpen={showProfile} onClose={closeProfile} />

			{/* About Modal */}
			<AboutModal isOpen={showAbout} onClose={closeAbout} />

			<Routes>
				<Route path="/" element={<Navigate to="/dashboard" replace />} />
				<Route path="/dashboard" element={<DashboardPage />} />

				<Route path="/medications" element={<MedicationsPage />} />

				<Route path="/planner" element={<PlannerPage />} />

				<Route path="/settings" element={<SettingsPage />} />

				<Route path="/schedule" element={<SchedulePage />} />
				{/* Catch-all: redirect unknown routes to dashboard */}
				<Route path="*" element={<Navigate to="/dashboard" replace />} />
			</Routes>

			{/* Medication Detail Modal */}
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

			{/* User Medications Modal */}
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

			{/* Share Dialog Modal */}
			<ShareDialog
				show={showShareDialog}
				sharePeople={sharePeople}
				shareSelectedPerson={shareSelectedPerson}
				onShareSelectedPersonChange={setShareSelectedPerson}
				shareSelectedDays={shareSelectedDays}
				onShareSelectedDaysChange={setShareSelectedDays}
				shareGenerating={shareGenerating}
				shareLink={shareLink}
				onShareLinkChange={setShareLink}
				shareCopied={shareCopied}
				onShareCopiedChange={setShareCopied}
				onClose={closeShareDialog}
				onGenerateShareLink={generateShareLink}
				onCopyShareLink={copyShareLink}
			/>

			{/* Schedule Lightbox - for clicking medication images in schedule */}
			{scheduleLightboxImage && (
				<Lightbox src={scheduleLightboxImage} alt="Medication" onClose={closeScheduleLightbox} />
			)}
		</main>
	);
}
