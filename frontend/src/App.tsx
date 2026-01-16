import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AuthProvider, useAuth, AuthPage, UserProfile } from "./components/Auth";

type Blister = {
	usage: number;
	every: number;
	start: string;
};

type Medication = {
	id: number;
	name: string;
	genericName?: string | null;
	takenBy: string[];
	packCount: number;
	blistersPerPack: number;
	pillsPerBlister: number;
	looseTablets: number;
	pillWeightMg?: number | null;
	blisters: Blister[];
	imageUrl?: string | null;
	expiryDate?: string | null;
	notes?: string | null;
	intakeRemindersEnabled?: boolean;
	updatedAt: string | number | null;
};

type PlannerRow = {
	medicationId: number;
	medicationName: string;
	totalPills: number;
	plannerUsage: number;
	blisterSize: number;
	blistersNeeded: number;
	fullBlisters: number;
	loosePills: number;
	enough: boolean;
};

type FormBlister = { usage: string; every: string; startDate: string; startTime: string };

type FormState = {
	name: string;
	genericName: string;
	takenBy: string[]; // Changed from string to array
	packCount: string;
	blistersPerPack: string;
	pillsPerBlister: string;
	looseTablets: string;
	pillWeightMg: string;
	expiryDate: string;
	notes: string;
	intakeRemindersEnabled: boolean;
	blisters: FormBlister[];
};

const defaultBlister = (): FormBlister => {
	const now = new Date();
	return {
		usage: "1",
		every: "1",
		startDate: toDateValue(now),
		startTime: toTimeValue(now)
	};
};

const defaultForm = (): FormState => ({ name: "", genericName: "", takenBy: [], packCount: "1", blistersPerPack: "1", pillsPerBlister: "1", looseTablets: "0", pillWeightMg: "", expiryDate: "", notes: "", intakeRemindersEnabled: false, blisters: [defaultBlister()] });

// Field validation limits (must match backend)
const FIELD_LIMITS = {
	name: { min: 1, max: 100 },
	genericName: { max: 100 },
	takenBy: { max: 100 },
	notes: { max: 2000 }
} as const;

type FieldErrors = {
	name?: string;
	genericName?: string;
	takenBy?: string;
	notes?: string;
};

const todayIso = () => new Date().toISOString();
const plusDaysIso = (days: number) => {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return d.toISOString();
};

type Coverage = {
	name: string;
	medsLeft: number;
	daysLeft: number | null;
	depletionDate: string | null;
	depletionTime: number | null;
	nextDose: string | null;
};

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
	const location = useLocation();
	const navigate = useNavigate();

	// Show loading while checking auth state
	if (loading) {
		return (
			<div className="auth-container">
				<div className="auth-card" style={{ textAlign: "center" }}>
					<h1 className="auth-title">💊 MedAssist</h1>
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
					<h1 className="auth-title">💊 MedAssist</h1>
					<div className="auth-error" style={{ marginBottom: "1rem" }}>
						<strong>Connection Error</strong><br />
						{authError}
					</div>
					<p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
						Please check if the server is running and try again.
					</p>
					<button 
						className="btn btn-primary" 
						onClick={() => window.location.reload()}
						style={{ marginTop: "1rem" }}
					>
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
					<h1 className="auth-title">💊 MedAssist</h1>
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
	return <AppContent />;
}

// =============================================================================
// Main App Content
// =============================================================================

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

function AppContent() {
	const { t, i18n } = useTranslation();
	const { user, authState, logout } = useAuth();
	const [showProfile, setShowProfile] = useState(false);
	const [meds, setMeds] = useState<Medication[]>([]);
	const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
	const [plannerLoading, setPlannerLoading] = useState(false);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [formSaved, setFormSaved] = useState(false);
	const [originalForm, setOriginalForm] = useState<FormState>(defaultForm());
	const [editingId, setEditingId] = useState<number | null>(null);
	const [showEditModal, setShowEditModal] = useState(false);
	const [form, setForm] = useState<FormState>(defaultForm());
	const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
	const [range, setRange] = useState<{ start: string; end: string }>({
		start: toInputValue(todayIso()),
		end: toInputValue(plusDaysIso(3))
	});

	// Validate form fields
	const validateField = (field: keyof FieldErrors, value: string | string[]): string | undefined => {
		const limits = FIELD_LIMITS[field];
		// Skip validation for takenBy array (individual items validated on add)
		if (field === 'takenBy') return undefined;
		const strValue = typeof value === 'string' ? value : '';
		if (field === 'name' && (!strValue || strValue.trim().length === 0)) {
			return t('common.validation.required');
		}
		if ('max' in limits && strValue.length > limits.max) {
			return t('common.validation.maxLength', { max: limits.max, current: strValue.length });
		}
		return undefined;
	};

	// Check if form has any errors
	const hasValidationErrors = useMemo(() => {
		return Object.values(fieldErrors).some(error => error !== undefined);
	}, [fieldErrors]);

	// Check if form has been modified from original state
	const formChanged = useMemo(() => {
		return JSON.stringify(form) !== JSON.stringify(originalForm);
	}, [form, originalForm]);

	// Reset formSaved when form changes
	useEffect(() => {
		if (formChanged) {
			setFormSaved(false);
		}
	}, [formChanged]);

	// Validate all fields when form changes
	useEffect(() => {
		const errors: FieldErrors = {};
		(['name', 'genericName', 'notes'] as const).forEach(field => {
			const error = validateField(field, form[field]);
			if (error) errors[field] = error;
		});
		setFieldErrors(errors);
	}, [form.name, form.genericName, form.notes, t]);

	// Load user-specific planner data when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const savedRows = localStorage.getItem(userStorageKey(user.id, "plannerRows"));
			const savedRange = localStorage.getItem(userStorageKey(user.id, "plannerRange"));
			
			if (savedRows) {
				try { setPlannerRows(JSON.parse(savedRows)); } catch { setPlannerRows([]); }
			} else {
				setPlannerRows([]);
			}
			
			if (savedRange) {
				try { setRange(JSON.parse(savedRange)); } catch { /* keep default */ }
			} else {
				setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
			}
		} else {
			setPlannerRows([]);
			setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		}
	}, [user?.id]);

	const navigate = useNavigate();
	const location = useLocation();
	const currentPath = location.pathname;

	// Settings state
	const [settings, setSettings] = useState({
		emailEnabled: false,
		notificationEmail: "",
		reminderDaysBefore: 7,
		repeatDailyReminders: false,
		skipRemindersForTakenDoses: false,
		repeatRemindersEnabled: false,
		reminderRepeatIntervalMinutes: 30,
		maxNaggingReminders: 5,
		lowStockDays: 30,
		normalStockDays: 90,
		highStockDays: 180,
		smtpHost: "",
		smtpPort: 587,
		smtpUser: "",
		smtpPass: "",
		smtpFrom: "",
		smtpSecure: false,
		hasSmtpPassword: false,
		lastAutoEmailSent: null as string | null,
		nextScheduledCheck: null as string | null,
		lastNotificationType: null as "stock" | "intake" | null,
		lastNotificationChannel: null as "email" | "push" | "both" | null,
		// Shoutrrr/ntfy settings
		shoutrrrEnabled: false,
		shoutrrrUrl: "",
		// Granular notification settings
		emailStockReminders: true,
		emailIntakeReminders: true,
		shoutrrrStockReminders: true,
		shoutrrrIntakeReminders: true,
		// Stock calculation mode: "automatic" or "manual"
		stockCalculationMode: "automatic" as "automatic" | "manual",
		// Admin settings (from .env, read-only)
		expiryWarningDays: 30,
	});
	const [savedSettings, setSavedSettings] = useState(settings);
	const [settingsLoading, setSettingsLoading] = useState(false);
	const [settingsSaving, setSettingsSaving] = useState(false);
	const [settingsSaved, setSettingsSaved] = useState(false);
	const [testingEmail, setTestingEmail] = useState(false);
	const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [testingShoutrrr, setTestingShoutrrr] = useState(false);
	const [testShoutrrrResult, setTestShoutrrrResult] = useState<{ success: boolean; message: string } | null>(null);
	const [sendingPlannerEmail, setSendingPlannerEmail] = useState(false);
	const [plannerEmailResult, setPlannerEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [sendingReminderEmail, setSendingReminderEmail] = useState(false);
	const [reminderEmailResult, setReminderEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [uploadingImage, setUploadingImage] = useState(false);
	const [pendingImage, setPendingImage] = useState<File | null>(null);
	const [pendingImagePreview, setPendingImagePreview] = useState<string | null>(null);
	const [selectedMed, setSelectedMed] = useState<Medication | null>(null);
	const [showImageLightbox, setShowImageLightbox] = useState(false);
	const [selectedUser, setSelectedUser] = useState<string | null>(null);
	const [scheduleDays, setScheduleDays] = useState<number>(30);
	const [showPastDays, setShowPastDays] = useState(false);
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	// Tag input state for "Taken By" field
	const [takenByInput, setTakenByInput] = useState("");
	// Share dialog state
	const [showShareDialog, setShowShareDialog] = useState(false);
	const [sharePeople, setSharePeople] = useState<string[]>([]);
	const [shareSelectedPerson, setShareSelectedPerson] = useState<string>("");
	const [shareSelectedDays, setShareSelectedDays] = useState<number>(30);
	const [shareGenerating, setShareGenerating] = useState(false);
	const [shareLink, setShareLink] = useState<string | null>(null);
	const [shareCopied, setShareCopied] = useState(false);
	// Export/Import state
	const [exporting, setExporting] = useState(false);
	const [importing, setImporting] = useState(false);
	const [includeSensitiveData, setIncludeSensitiveData] = useState(false);
	const [showImportConfirm, setShowImportConfirm] = useState(false);
	const [pendingImportData, setPendingImportData] = useState<any>(null);
	// Collapsed days state (manually collapsed days are persisted)
	const [manuallyCollapsedDays, setManuallyCollapsedDays] = useState<Set<string>>(new Set());
	const [manuallyExpandedDays, setManuallyExpandedDays] = useState<Set<string>>(new Set());

	// Load user-specific scheduleDays when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const storedDays = localStorage.getItem(userStorageKey(user.id, "scheduleDays"));
			setScheduleDays(storedDays ? Number(storedDays) : 30);
			
			// Load manually collapsed/expanded days from localStorage
			const { collapsed, expanded } = loadCollapsedDaysFromStorage(
				userStorageKey(user.id, "collapsedDays"),
				userStorageKey(user.id, "expandedDays")
			);
			setManuallyCollapsedDays(collapsed);
			setManuallyExpandedDays(expanded);
		}
	}, [user?.id]);

	// Poll for taken doses from server (works with or without auth)
	useEffect(() => {
		async function loadTakenDoses() {
			try {
				const res = await fetch("/api/doses/taken", { credentials: "include" });
				if (res.ok) {
					const data = await res.json();
					setTakenDoses(new Set(data.doses.map((d: { doseId: string }) => d.doseId)));
				}
				// Don't reset on error - keep current state
			} catch {
				// Don't reset on error - keep current state
			}
		}
		loadTakenDoses();
		
		// Poll for updates every 5 seconds (real-time sync with share links)
		const interval = setInterval(loadTakenDoses, 5000);
		return () => clearInterval(interval);
	}, []);

	// Get dose ID with optional person suffix
	function getDoseId(baseDoseId: string, person: string | null): string {
		return person ? `${baseDoseId}-${person}` : baseDoseId;
	}

	// Count taken doses for a day/item
	function countTakenDoses(doses: Array<{ id: string; takenBy: string[] }>): { total: number; taken: number } {
		let total = 0;
		let taken = 0;
		for (const d of doses) {
			const people = (d.takenBy || []).length > 0 ? d.takenBy : [null];
			for (const person of people) {
				total++;
				if (takenDoses.has(getDoseId(d.id, person))) taken++;
			}
		}
		return { total, taken };
	}

	async function markDoseTaken(doseId: string) {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			return next;
		});
		
		// Send to server
		try {
			await fetch("/api/doses/taken", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ doseId }),
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.delete(doseId);
				return next;
			});
		}
	}

	async function undoDoseTaken(doseId: string) {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			return next;
		});
		
		// Send to server
		try {
			await fetch(`/api/doses/taken/${encodeURIComponent(doseId)}`, {
				method: "DELETE",
				credentials: "include",
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.add(doseId);
				return next;
			});
		}
	}

	// Close modal on Escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Close modals in order of priority (topmost first)
				if (showImageLightbox) {
					setShowImageLightbox(false);
				} else if (showEditModal) {
					setShowEditModal(false);
					resetForm();
				} else if (showShareDialog) {
					setShowShareDialog(false);
				} else if (showProfile) {
					setShowProfile(false);
				} else if (selectedUser) {
					setSelectedUser(null);
				} else if (selectedMed) {
					setSelectedMed(null);
				}
			}
		};
		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [selectedMed, showImageLightbox, selectedUser, showProfile, showShareDialog, showEditModal]);

	// Prevent background scroll when modal is open
	useEffect(() => {
		const isModalOpen = selectedMed || selectedUser || showProfile || showShareDialog || showEditModal;
		if (isModalOpen) {
			const scrollY = window.scrollY;
			document.body.classList.add('modal-open');
			document.body.style.top = `-${scrollY}px`;
		} else {
			const scrollY = document.body.style.top;
			document.body.classList.remove('modal-open');
			document.body.style.top = '';
			if (scrollY) {
				window.scrollTo(0, parseInt(scrollY || '0', 10) * -1);
			}
		}
		return () => {
			document.body.classList.remove('modal-open');
			document.body.style.top = '';
		};
	}, [selectedMed, selectedUser, showProfile, showShareDialog, showEditModal]);

	// Check if settings have changed
	const settingsChanged = settings.emailEnabled !== savedSettings.emailEnabled ||
		settings.notificationEmail !== savedSettings.notificationEmail ||
		settings.reminderDaysBefore !== savedSettings.reminderDaysBefore ||
		settings.repeatDailyReminders !== savedSettings.repeatDailyReminders ||
		settings.lowStockDays !== savedSettings.lowStockDays ||
		settings.normalStockDays !== savedSettings.normalStockDays ||
		settings.highStockDays !== savedSettings.highStockDays ||
		settings.shoutrrrEnabled !== savedSettings.shoutrrrEnabled ||
		settings.shoutrrrUrl !== savedSettings.shoutrrrUrl;

	const schedule = useMemo(() => buildSchedulePreview(meds, i18n.language, true), [meds, i18n.language]);
	const totalTablets = useMemo(() => deriveTotal(form), [form]);
	const coverage = useMemo(() => calculateCoverage(meds, schedule.events, i18n.language, settings.reminderDaysBefore, settings.stockCalculationMode, takenDoses), [meds, schedule.events, i18n.language, settings.reminderDaysBefore, settings.stockCalculationMode, takenDoses]);
	const depletionByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c.depletionTime])), [coverage.all]);
	const coverageByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c])), [coverage.all]);
	
	// Get all unique people from medications for autocomplete suggestions
	const existingPeople = useMemo(() => {
		const allPeople = meds.flatMap(m => m.takenBy || []);
		return [...new Set(allPeople)].filter(Boolean).sort();
	}, [meds]);

	// Get worst stock status for a day's medications (for coloring day blocks)
	const getDayStockStatus = (dayMeds: { medName: string; lastWhen: number }[]) => {
		const statuses = dayMeds.map((item) => {
			const cov = coverageByMed[item.medName];
			const depletionTime = depletionByMed[item.medName];
			
			// Will be out of stock by this day?
			if (typeof depletionTime === "number" && item.lastWhen > depletionTime) {
				return "danger";
			}
			
			if (!cov) return "success";
			const { daysLeft, medsLeft } = cov;
			
			// Currently out of stock
			if (medsLeft <= 0 || daysLeft === 0) return "danger";
			// No schedule (can't calculate)
			if (daysLeft === null) return "success";
			// Low stock: < lowStockDays (warning)
			if (daysLeft < settings.lowStockDays) return "warning";
			// Normal/High stock
			return "success";
		});
		return statuses.includes("danger") ? "danger" : statuses.includes("warning") ? "warning" : "success";
	};

	const groupedSchedule = useMemo(() => {
		type DoseInfo = { id: string; timeStr: string; when: number; usage: number; takenBy: string[] };
		const days = new Map<string, { dateStr: string; date: Date; isPast: boolean; meds: Map<string, { medName: string; total: number; doses: DoseInfo[]; lastWhen: number }> }>();
		schedule.events.slice(0, 2000).forEach((event) => {
			const day = days.get(event.dateStr) ?? { dateStr: event.dateStr, date: new Date(event.when), isPast: event.isPast, meds: new Map() };
			const medEntry = day.meds.get(event.medName) ?? { medName: event.medName, total: 0, doses: [], lastWhen: event.when };
			medEntry.total += event.usage;
			medEntry.doses.push({ id: event.id, timeStr: event.timeStr, when: event.when, usage: event.usage, takenBy: event.takenBy || [] });
			medEntry.lastWhen = Math.max(medEntry.lastWhen, event.when);
			day.meds.set(event.medName, medEntry);
			days.set(event.dateStr, day);
		});
		return Array.from(days.values()).map((d) => ({ dateStr: d.dateStr, date: d.date, isPast: d.isPast, meds: Array.from(d.meds.values()) }));
	}, [schedule.events]);

	const pastDays = useMemo(() => groupedSchedule.filter(d => d.isPast), [groupedSchedule]);
	const futureDays = useMemo(() => groupedSchedule.filter(d => !d.isPast).slice(0, scheduleDays), [groupedSchedule, scheduleDays]);

	// Load medications and settings when user changes (or on initial mount)
	useEffect(() => {
		loadMeds();
		loadSettings();
		// Reset planner when user changes
		setPlannerRows([]);
		setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
	}, [user?.id]);

	function loadMeds() {
		setLoading(true);
		fetch("/api/medications")
			.then((res) => res.json())
			.then((data) => setMeds(Array.isArray(data) ? data : []))
			.catch(() => setMeds([]))
			.finally(() => setLoading(false));
	}

	function loadSettings() {
		setSettingsLoading(true);
		fetch("/api/settings")
			.then((res) => res.json())
			.then((data) => {
				const newSettings = { ...settings, ...data, smtpPass: "" };
				setSettings(newSettings);
				setSavedSettings(newSettings);
				setSettingsSaved(false);
			})
			.catch(() => {})
			.finally(() => setSettingsLoading(false));
	}

	async function saveSettings(e: React.FormEvent) {
		e.preventDefault();
		
		// Auto-disable email if no recipient is set
		const effectiveEmailEnabled = settings.emailEnabled && !!settings.notificationEmail?.trim();
		// Auto-disable push if no URL is set
		const effectiveShoutrrrEnabled = settings.shoutrrrEnabled && !!settings.shoutrrrUrl?.trim();
		
		// Validate email if email notifications are enabled
		if (effectiveEmailEnabled && settings.notificationEmail) {
			const emailRegex = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
			if (!emailRegex.test(settings.notificationEmail)) {
				setTestEmailResult({ success: false, message: "Invalid email address" });
				return;
			}
		}
		
		setSettingsSaving(true);
		setTestEmailResult(null);
		
		const payload = {
			emailEnabled: effectiveEmailEnabled,
			notificationEmail: settings.notificationEmail,
			reminderDaysBefore: settings.reminderDaysBefore,
			repeatDailyReminders: settings.repeatDailyReminders,
			skipRemindersForTakenDoses: settings.skipRemindersForTakenDoses,
			repeatRemindersEnabled: settings.repeatRemindersEnabled,
			reminderRepeatIntervalMinutes: settings.reminderRepeatIntervalMinutes,
			maxNaggingReminders: settings.maxNaggingReminders ?? 5,
			lowStockDays: settings.lowStockDays,
			normalStockDays: settings.normalStockDays,
			highStockDays: settings.highStockDays,
			shoutrrrEnabled: effectiveShoutrrrEnabled,
			shoutrrrUrl: settings.shoutrrrUrl,
			// Granular notification settings
			emailStockReminders: settings.emailStockReminders,
			emailIntakeReminders: settings.emailIntakeReminders,
			shoutrrrStockReminders: settings.shoutrrrStockReminders,
			shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
			// Stock calculation mode
			stockCalculationMode: settings.stockCalculationMode,
			// Language setting (for backend notifications)
			language: i18n.language,
			// SMTP (legacy - not saved, read from .env)
			smtpHost: settings.smtpHost,
			smtpPort: settings.smtpPort,
			smtpUser: settings.smtpUser,
			smtpPass: settings.smtpPass || undefined,
			smtpFrom: settings.smtpFrom,
			smtpSecure: settings.smtpSecure,
		};

		await fetch("/api/settings", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}).catch(() => null);

		// Update local state with effective values
		const updatedSettings = { 
			...settings, 
			emailEnabled: effectiveEmailEnabled,
			shoutrrrEnabled: effectiveShoutrrrEnabled 
		};
		setSettings(updatedSettings);
		setSettingsSaving(false);
		setSavedSettings(updatedSettings);
		setSettingsSaved(true);
	}

	async function testEmail() {
		if (!settings.notificationEmail) return;
		setTestingEmail(true);
		setTestEmailResult(null);

		try {
			const res = await fetch("/api/settings/test-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email: settings.notificationEmail }),
			});
			const data = await res.json();
			if (res.ok) {
				setTestEmailResult({ success: true, message: data.message || "Email sent!" });
			} else {
				setTestEmailResult({ success: false, message: data.error || "Failed to send" });
			}
		} catch {
			setTestEmailResult({ success: false, message: "Network error" });
		}
		setTestingEmail(false);
	}

	async function testShoutrrr() {
		if (!settings.shoutrrrUrl) return;
		setTestingShoutrrr(true);
		setTestShoutrrrResult(null);

		try {
			const res = await fetch("/api/settings/test-shoutrrr", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url: settings.shoutrrrUrl }),
			});
			const data = await res.json();
			if (res.ok) {
				setTestShoutrrrResult({ success: true, message: data.message || "Notification sent!" });
			} else {
				setTestShoutrrrResult({ success: false, message: data.error || "Failed to send" });
			}
		} catch {
			setTestShoutrrrResult({ success: false, message: "Network error" });
		}
		setTestingShoutrrr(false);
	}

	async function sendPlannerEmail() {
		if (!settings.notificationEmail || plannerRows.length === 0) return;
		setSendingPlannerEmail(true);
		setPlannerEmailResult(null);

		try {
			const res = await fetch("/api/planner/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: settings.notificationEmail,
					from: range.start,
					until: range.end,
					rows: plannerRows,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setPlannerEmailResult({ success: true, message: data.message || "Email sent!" });
			} else {
				setPlannerEmailResult({ success: false, message: data.error || "Failed to send" });
			}
		} catch {
			setPlannerEmailResult({ success: false, message: "Network error" });
		}
		setSendingPlannerEmail(false);
	}

	async function sendReminderEmail() {
		if (!settings.notificationEmail || coverage.low.length === 0) return;
		setSendingReminderEmail(true);
		setReminderEmailResult(null);

		try {
			const res = await fetch("/api/reminder/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: settings.notificationEmail,
					lowStock: coverage.low,
				}),
			});
			const data = await res.json();
			if (res.ok) {
				setReminderEmailResult({ success: true, message: data.message || "Email sent!" });
				// Reload settings to get updated lastAutoEmailSent
				loadSettings();
			} else {
				setReminderEmailResult({ success: false, message: data.error || "Failed to send" });
			}
		} catch {
			setReminderEmailResult({ success: false, message: "Network error" });
		}
		setSendingReminderEmail(false);
	}

	// Export data to JSON file
	async function handleExport() {
		setExporting(true);
		try {
			const res = await fetch(`/api/export?includeSensitive=${includeSensitiveData}`, {
				credentials: "include",
			});
			if (!res.ok) throw new Error("Export failed");
			const data = await res.json();
			
			// Create download
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			const dateStr = new Date().toISOString().split("T")[0];
			a.href = url;
			a.download = `${t('exportImport.downloadFilename')}-${dateStr}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error("Export error:", err);
		}
		setExporting(false);
	}

	// Handle file selection for import
	function handleImportFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		
		const reader = new FileReader();
		reader.onload = (event) => {
			try {
				const data = JSON.parse(event.target?.result as string);
				if (!data.version || !data.exportedAt) {
					alert(t('exportImport.invalidFile'));
					return;
				}
				setPendingImportData(data);
				setShowImportConfirm(true);
			} catch {
				alert(t('exportImport.invalidFile'));
			}
		};
		reader.readAsText(file);
		// Reset file input
		e.target.value = "";
	}

	// Confirm and execute import
	async function handleImportConfirm() {
		if (!pendingImportData) return;
		setImporting(true);
		setShowImportConfirm(false);
		
		try {
			const res = await fetch("/api/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(pendingImportData),
			});
			
			if (!res.ok) {
				const err = await res.json();
				alert(t('exportImport.importError') + ": " + (err.error || "Unknown error"));
				return;
			}
			
			const result = await res.json();
			alert(t('exportImport.importSuccess') + "\n" + t('exportImport.importSuccessDetails', {
				medications: result.imported.medications,
				doses: result.imported.doseHistory,
				shares: result.imported.shareLinks,
			}));
			
			// Reload all data
			loadMeds();
			loadSettings();
			loadTakenDoses();
		} catch (err) {
			console.error("Import error:", err);
			alert(t('exportImport.importError'));
		}
		
		setPendingImportData(null);
		setImporting(false);
	}

	// Helper function to load taken doses (extracted from useEffect)
	async function loadTakenDoses() {
		try {
			const res = await fetch("/api/doses/taken", { credentials: "include" });
			if (res.ok) {
				const data = await res.json();
				setTakenDoses(new Set(data.doses.map((d: { doseId: string }) => d.doseId)));
			}
		} catch {
			// Silently fail
		}
	}

	async function deleteMed(id: number) {
		await fetch(`/api/medications/${id}`, { method: "DELETE" }).catch(() => null);
		if (editingId === id) resetForm();
		loadMeds();
	}

	async function uploadMedImage(medId: number, file: File) {
		setUploadingImage(true);
		const formData = new FormData();
		formData.append("file", file);
		
		try {
			const res = await fetch(`/api/medications/${medId}/image`, {
				method: "POST",
				body: formData,
			});
			if (res.ok) {
				loadMeds();
			}
		} catch {
			// ignore
		}
		setUploadingImage(false);
	}

	async function deleteMedImage(medId: number) {
		await fetch(`/api/medications/${medId}/image`, { method: "DELETE" }).catch(() => null);
		loadMeds();
	}

	function setBlisterValue(idx: number, field: keyof FormBlister, value: string) {
		setForm((prev) => {
			const next = [...prev.blisters];
			next[idx] = { ...next[idx], [field]: value };
			return { ...prev, blisters: next };
		});
	}

	function addBlister() {
		setForm((prev) => ({ ...prev, blisters: [...prev.blisters, defaultBlister()] }));
	}

	function removeBlister(idx: number) {
		setForm((prev) => ({ ...prev, blisters: prev.blisters.filter((_, i) => i !== idx) }));
	}

	function startEdit(med: Medication) {
		setEditingId(med.id);
		setTakenByInput(""); // Clear tag input when starting edit
		setFormSaved(false);
		const editForm: FormState = {
			name: med.name,
			genericName: med.genericName ?? "",
			takenBy: med.takenBy || [], // Already an array from API
			packCount: String(med.packCount),
			blistersPerPack: String(med.blistersPerPack),
			pillsPerBlister: String(med.pillsPerBlister),
			looseTablets: String(med.looseTablets),
			pillWeightMg: med.pillWeightMg ? String(med.pillWeightMg) : "",
			expiryDate: med.expiryDate ? med.expiryDate.slice(0, 10) : "",
			notes: med.notes ?? "",
			intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
			blisters: med.blisters.map((s) => ({ 
				usage: String(s.usage), 
				every: String(s.every), 
				startDate: toDateValue(s.start),
				startTime: toTimeValue(s.start)
			})),
		};
		setForm(editForm);
		setOriginalForm(editForm);
		// Show modal on mobile
		if (window.innerWidth <= 768) {
			setShowEditModal(true);
		}
	}

	function resetForm() {
		setEditingId(null);
		setShowEditModal(false);
		setPendingImage(null);
		setPendingImagePreview(null);
		setTakenByInput("");
		setFormSaved(false);
		const newForm = defaultForm();
		setForm(newForm);
		setOriginalForm(newForm);
	}

	function handleValueChange<K extends keyof FormState>(key: K, value: string) {
		setForm((prev) => ({ ...prev, [key]: value }));
	}

	// Tag input helpers for "Taken By" field
	function addTakenByPerson(name: string) {
		const trimmed = name.trim();
		if (trimmed && trimmed.length <= FIELD_LIMITS.takenBy.max && !form.takenBy.includes(trimmed)) {
			setForm(prev => ({ ...prev, takenBy: [...prev.takenBy, trimmed] }));
		}
		setTakenByInput("");
	}

	function removeTakenByPerson(name: string) {
		setForm(prev => ({ ...prev, takenBy: prev.takenBy.filter(p => p !== name) }));
	}

	function handleTakenByKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			addTakenByPerson(takenByInput);
		} else if (e.key === 'Backspace' && !takenByInput && form.takenBy.length > 0) {
			// Remove last tag on backspace when input is empty
			removeTakenByPerson(form.takenBy[form.takenBy.length - 1]);
		}
	}

	async function saveMedication(e: React.FormEvent) {
		e.preventDefault();
		if (!form.name.trim()) return;
		setSaving(true);

		const payload = {
			name: form.name.trim(),
			genericName: form.genericName.trim() || null,
			takenBy: form.takenBy.filter(name => name.trim()), // Send array, filter empty strings
			packCount: Number(form.packCount) || 0,
			blistersPerPack: Math.max(1, Number(form.blistersPerPack) || 1),
			pillsPerBlister: Math.max(1, Number(form.pillsPerBlister) || 1),
			looseTablets: Math.max(0, Number(form.looseTablets) || 0),
			pillWeightMg: form.pillWeightMg ? Number(form.pillWeightMg) : null,
			expiryDate: form.expiryDate || null,
			notes: form.notes.trim() || null,
			intakeRemindersEnabled: form.intakeRemindersEnabled,
			blisters: form.blisters.map((s) => ({ 
				usage: Number(s.usage) || 0, 
				every: Math.max(1, Number(s.every) || 1), 
				start: toIsoString(combineDateAndTime(s.startDate, s.startTime))
			})),
		};

		const method = editingId ? "PUT" : "POST";
		const url = editingId ? `/api/medications/${editingId}` : "/api/medications";
		const wasEditing = editingId;

		try {
			const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
			
			// If creating new medication and we have a pending image, upload it
			if (!wasEditing && pendingImage && res.ok) {
				const newMed = await res.json();
				if (newMed?.id) {
					await uploadMedImage(newMed.id, pendingImage);
				}
			}
			
			// Mark as saved and update original form to current state
			if (res.ok) {
				setFormSaved(true);
				setOriginalForm(form);
			}
		} catch {
			// ignore
		}

		setSaving(false);
		
		// Only reset form if creating new medication, not when editing
		if (!wasEditing) {
			resetForm();
		} else {
			// Close modal on mobile after edit
			setShowEditModal(false);
		}
		
		loadMeds();
	}

	async function runPlanner(e: React.FormEvent) {
		e.preventDefault();
		setPlannerLoading(true);
		const body = { startDate: toIsoString(range.start), endDate: toIsoString(range.end) };
		const rows = await fetch("/api/medications/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
			.then((res) => res.json())
			.catch(() => []) as PlannerRow[];
		setPlannerRows(rows);
		setPlannerLoading(false);
		// Save to user-specific localStorage
		if (user?.id) {
			localStorage.setItem(userStorageKey(user.id, "plannerRange"), JSON.stringify(range));
			localStorage.setItem(userStorageKey(user.id, "plannerRows"), JSON.stringify(rows));
		}
	}

	function resetRange() {
		setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		setPlannerRows([]);
		if (user?.id) {
			localStorage.removeItem(userStorageKey(user.id, "plannerRange"));
			localStorage.removeItem(userStorageKey(user.id, "plannerRows"));
		}
	}

	// Share dialog functions
	async function openShareDialog() {
		setShowShareDialog(true);
		setShareLink(null);
		setShareCopied(false);
		setShareSelectedPerson("");
		setShareSelectedDays(30);
		
		// Get unique takenBy people from all medications (flatten arrays)
		const allPeople = meds.flatMap(m => m.takenBy || []);
		const uniquePeople = [...new Set(allPeople)].filter(Boolean).sort();
		setSharePeople(uniquePeople);
		if (uniquePeople.length > 0) {
			setShareSelectedPerson(uniquePeople[0]);
		}
	}

	async function generateShareLink() {
		if (!shareSelectedPerson) return;
		setShareGenerating(true);
		setShareCopied(false);
		
		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					takenBy: shareSelectedPerson,
					scheduleDays: shareSelectedDays,
				}),
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
	}

	function copyShareLink() {
		if (shareLink) {
			navigator.clipboard.writeText(shareLink);
			setShareCopied(true);
			setTimeout(() => setShareCopied(false), 2000);
		}
	}

	function closeShareDialog() {
		setShowShareDialog(false);
		setShareLink(null);
		setShareCopied(false);
	}

	// Toggle day collapse/expand
	function toggleDayCollapse(dateStr: string, isAutoCollapsed: boolean) {
		if (isAutoCollapsed) {
			// Day is auto-collapsed (all taken) - toggle the expanded override
			setManuallyExpandedDays((prev) => {
				const next = new Set(prev);
				if (next.has(dateStr)) {
					next.delete(dateStr);
				} else {
					next.add(dateStr);
				}
				if (user?.id) localStorage.setItem(userStorageKey(user.id, "expandedDays"), JSON.stringify([...next]));
				return next;
			});
		} else {
			// Day is not auto-collapsed - toggle manual collapse
			setManuallyCollapsedDays((prev) => {
				const next = new Set(prev);
				if (next.has(dateStr)) {
					next.delete(dateStr);
				} else {
					next.add(dateStr);
				}
				if (user?.id) localStorage.setItem(userStorageKey(user.id, "collapsedDays"), JSON.stringify([...next]));
				return next;
			});
		}
	}

	const [theme, setTheme] = useState<"light" | "dark">(() => {
		if (typeof window !== "undefined") {
			return (localStorage.getItem("theme") as "light" | "dark") || "dark";
		}
		return "dark";
	});

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("theme", theme);
	}, [theme]);

	function toggleTheme() {
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	}

	// Page titles based on current route
	const pageInfo = {
		"/dashboard": { eyebrow: t('header.eyebrow.overview'), title: t('nav.dashboard') },
		"/medications": { eyebrow: t('header.eyebrow.inventory'), title: t('nav.medications') },
		"/planner": { eyebrow: t('header.eyebrow.planner'), title: t('nav.planner') },
		"/settings": { eyebrow: t('header.eyebrow.settings'), title: t('nav.settings') },
		"/schedule": { eyebrow: t('header.eyebrow.schedule'), title: t('dashboard.schedules.title') },
	}[currentPath] || { eyebrow: t('header.eyebrow.overview'), title: t('nav.dashboard') };

	return (
		<main className="page">
			<header className="hero">
				<div className="hero-title">
					<img src="/favicon.svg" alt="MedAssist-ng" className="hero-logo" />
					<div>
						<p className="eyebrow">{pageInfo.eyebrow}</p>
						<h1>{pageInfo.title}</h1>
					</div>
				</div>
				<div className="header-actions">
					<div className="tabs">
						<button className={currentPath === "/dashboard" || currentPath === "/" ? "pill primary" : "pill"} onClick={() => navigate("/dashboard")}>{t('nav.dashboard')}</button>
						<button className={currentPath === "/medications" ? "pill primary" : "pill"} onClick={() => navigate("/medications")}>{t('nav.medications')}</button>
						<button className={currentPath === "/planner" ? "pill primary" : "pill"} onClick={() => navigate("/planner")}>{t('nav.planner')}</button>
					</div>
					{/* Settings button only shown when auth is disabled (no user dropdown available) */}
					{!authState?.authEnabled && (
						<button className={`icon-btn ${currentPath === "/settings" ? "active" : ""}`} onClick={() => navigate("/settings")} title={t('nav.settings')}>⚙️</button>
					)}
					<button className="icon-btn" onClick={toggleTheme} title={theme === "dark" ? t('tooltips.lightMode') : t('tooltips.darkMode')}>
						{theme === "dark" ? "☀️" : "🌙"}
					</button>
					{authState?.authEnabled && user && (
						<div className="user-menu">
							<button className="user-menu-btn">
								{user.avatarUrl ? (
									<img src={`/api/images/${user.avatarUrl}`} alt={user.username} className="user-avatar-img" />
								) : (
									<span className="user-avatar">{user.username.charAt(0).toUpperCase()}</span>
								)}
							</button>
							<div className="user-dropdown">
								<div className="dropdown-header">
									{user.avatarUrl ? (
										<img src={`/api/images/${user.avatarUrl}`} alt={user.username} className="dropdown-avatar-img" />
									) : (
										<div className="dropdown-avatar">{user.username.charAt(0).toUpperCase()}</div>
									)}
									<span className="dropdown-username">{user.username}</span>
								</div>
								<div className="dropdown-menu">
									<button className="dropdown-item" onClick={() => setShowProfile(true)}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
										{t('auth.profile', 'Profile')}
									</button>
									<button className="dropdown-item" onClick={() => navigate('/settings')}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
										{t('nav.settings', 'Settings')}
									</button>
									<button className="dropdown-item danger" onClick={() => logout()}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
										{t('auth.signOut', 'Sign Out')}
									</button>
								</div>
							</div>
						</div>
					)}
				</div>
			</header>

			{/* Profile Modal */}
			{showProfile && (
				<div className="modal-overlay" onClick={() => setShowProfile(false)}>
					<div className="modal-content profile-modal" onClick={(e) => e.stopPropagation()}>
						<button className="modal-close" onClick={() => setShowProfile(false)}>×</button>
						<UserProfile onClose={() => setShowProfile(false)} />
					</div>
				</div>
			)}

			<Routes>
				<Route path="/" element={<Navigate to="/dashboard" replace />} />
				<Route path="/dashboard" element={
					<>
						{(settings.emailEnabled || settings.shoutrrrEnabled) && (
							<section className="email-status-bar">
								<span className="email-status-icon">{settings.emailEnabled && settings.shoutrrrEnabled ? "🔔" : settings.emailEnabled ? "📧" : "🔔"}</span>
								<span className="email-status-text">
									<span className="email-status-line">{t('dashboard.reminders.active')}</span>
									{getReminderStatusText(settings.reminderDaysBefore, settings.lowStockDays, coverage.low, coverage.all, settings.lastAutoEmailSent, settings.lastNotificationType, settings.lastNotificationChannel, t, i18n.language)}
								</span>
								{settings.emailEnabled && settings.notificationEmail && <span className="email-status-recipient">→ {settings.notificationEmail}</span>}
							</section>
						)}
						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>{t('dashboard.reorder.title')}</h2>
								</div>
								{(() => {
									if (meds.length === 0) {
										return <p className="muted">{t('dashboard.reorder.noMeds')}</p>;
									}
									
									// Count medications with "Low" stock status (based on lowStockDays setting)
									const lowStockCount = coverage.all.filter(c => {
										if (c.medsLeft <= 0) return true; // out of stock
										if (c.daysLeft === null) return false; // no schedule
										return c.daysLeft < settings.lowStockDays;
									}).length;
									
									if (coverage.low.length === 0) {
										// No critical meds (≤3 days)
										if (lowStockCount === 0) {
											// All good - everything is Normal or High
											return <p className="success-text">{t('dashboard.reorder.allGood')}</p>;
										} else {
											// Some meds are Low but not critical
											return <p className="warning-text">{t('dashboard.reorder.lowWarning', { count: lowStockCount })}</p>;
										}
									}
									
									return (
										<>
											<div className="table table-7">
											<div className="table-head">
												<span>{t('table.name')}</span>
												<span>{t('table.fullBlisters')}</span>
												<span>{t('table.openBlister')}</span>
												<span>{t('table.daysLeft')}</span>
												<span>{t('table.status')}</span>
												<span>{t('table.runsOut')}</span>
												<span>{t('table.autoRemind')}</span>
											</div>
											{coverage.low.map((row) => {
												const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
												const med = meds.find(m => m.name === row.name);
												const textClass = status.className === "danger" ? "danger-text" : status.className === "warning" ? "warning-text" : "success-text";
												const stock = getBlisterStock(
													Math.round(row.medsLeft), 
													med?.pillsPerBlister ?? 1,
													med?.looseTablets ?? 0,
													med ? med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets : Math.round(row.medsLeft)
												);
												return (
													<div key={row.name} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
														<span data-label={t('table.name')} className="cell-with-avatar">
															<MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />
															<span className="med-name-text">{row.name}</span>
															{med?.takenBy && med.takenBy.length > 0 && med.takenBy.map((person) => (
																<span key={person} className="taken-by-badge clickable" onClick={(e) => { e.stopPropagation(); setSelectedUser(person); }}>{person}</span>
															))}
															{(med?.intakeRemindersEnabled || med?.notes) && (
																<span className="med-icons">
																	{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}
																	{med?.notes && <span className="notes-icon info-tooltip" data-tooltip={t('tooltips.hasNotes')}>📝</span>}
																</span>
															)}
														</span>
														<span data-label={t('table.fullBlisters')} className={textClass}>{formatFullBlisters(stock.fullBlisters, t)}</span>
														<span data-label={t('table.openBlister')} className={textClass}>{formatOpenBlisterAndLoose(stock.openBlisterPills, stock.loosePills, med?.pillsPerBlister ?? 1, t)}</span>
														<span data-label={t('table.days')} className={textClass}>{formatNumber(row.daysLeft)}</span>
														<span data-label={t('table.status')} className={`status-chip ${status.className}`}>{t(status.label)}</span>
														<span data-label={t('table.runsOut')}>{row.depletionDate ?? "-"}</span>
														<span data-label={t('table.autoRemind')} className="next-reminder-date">{getNextReminderForMed(row, settings.reminderDaysBefore, i18n.language)}</span>
													</div>
												);
											})}
										</div>
										{(settings.emailEnabled || settings.shoutrrrEnabled) && (
											<div className="email-send-action">
												<button type="button" className="ghost" onClick={sendReminderEmail} disabled={sendingReminderEmail}>
													{sendingReminderEmail ? t('common.sending') : t('dashboard.reorder.sendReminder')}
												</button>
												{reminderEmailResult && (
													<span className={reminderEmailResult.success ? "success-text" : "danger-text"}>
														{reminderEmailResult.message}
													</span>
												)}
											</div>
										)}
									</>
									);
								})()}
							</article>
						</section>

						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>{t('dashboard.overview.title')}</h2>
								</div>
								<div className="table table-7">
									<div className="table-head">
										<span>{t('table.name')}</span>
										<span>{t('table.fullBlisters')}</span>
										<span>{t('table.openBlister')}</span>
										<span>{t('table.daysLeft')}</span>
										<span>{t('table.runsOut')}</span>
										<span>{t('table.expiry')}</span>
										<span>{t('table.status')}</span>
									</div>
									{coverage.all.map((row) => {
										const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
										const med = meds.find(m => m.name === row.name);
										const expiryClass = getExpiryClass(med?.expiryDate, settings.expiryWarningDays);
										const textClass = status.className === "danger" ? "danger-text" : status.className === "warning" ? "warning-text" : "success-text";
										const stock = getBlisterStock(
											Math.round(row.medsLeft), 
											med?.pillsPerBlister ?? 1,
											med?.looseTablets ?? 0,
											med ? med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets : Math.round(row.medsLeft)
										);
										return (
											<div key={row.name} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
												<span data-label={t('table.name')} className="cell-with-avatar">
													<span className="med-name-line">
														<MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />
														<span className="med-name-text">{row.name}</span>
														{med?.takenBy && med.takenBy.length > 0 && med.takenBy.map((person) => (
															<span key={person} className="taken-by-badge clickable" onClick={(e) => { e.stopPropagation(); setSelectedUser(person); }}>{person}</span>
														))}
													</span>
													{(med?.intakeRemindersEnabled || med?.notes) && (
														<span className="med-icons">
															{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}
															{med?.notes && <span className="notes-icon info-tooltip" data-tooltip={t('tooltips.hasNotes')}>📝</span>}
														</span>
													)}
												</span>
												<span data-label={t('table.fullBlisters')} className={textClass}>{formatFullBlisters(stock.fullBlisters, t)}</span>
												<span data-label={t('table.openBlister')} className={textClass}>{formatOpenBlisterAndLoose(stock.openBlisterPills, stock.loosePills, med?.pillsPerBlister ?? 1, t)}</span>
												<span data-label={t('table.daysLeft')} className={textClass}>{formatNumber(row.daysLeft)}</span>
												<span data-label={t('table.runsOut')}>{row.depletionDate ?? "-"}</span>
												<span data-label={t('table.expiry')} className={expiryClass}>{med?.expiryDate ? new Date(med.expiryDate).toLocaleDateString(i18n.language, { day: "2-digit", month: "short", year: "2-digit" }) : "-"}</span>
												<span data-label={t('table.status')} className={`status-chip ${status.className}`}>{t(status.label)}</span>
											</div>
										);
									})}
								</div>
							</article>
						</section>

						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>{t('dashboard.schedules.title')}</h2>
									<div className="card-head-actions">
										{meds.some(m => m.takenBy && m.takenBy.length > 0) && (
											<button className="ghost share-btn" onClick={openShareDialog} title={t('share.button')}>
												🔗 {t('share.button')}
											</button>
										)}
										<select 
											className="schedule-days-select"
											value={scheduleDays}
											onChange={(e) => {
												const val = Number(e.target.value);
												setScheduleDays(val);
												if (user?.id) localStorage.setItem(userStorageKey(user.id, "scheduleDays"), String(val));
											}}
										>
											<option value={30}>{t('dashboard.schedules.1month')}</option>
											<option value={90}>{t('dashboard.schedules.3months')}</option>
											<option value={180}>{t('dashboard.schedules.6months')}</option>
										</select>
									</div>
								</div>
								<div className="timeline">
									{/* Past days toggle */}
									{pastDays.length > 0 && (() => {
										const totalPastDoses = pastDays.flatMap(d => d.meds.flatMap(m => m.doses.flatMap(dose => (dose.takenBy || []).length > 0 ? dose.takenBy.map(p => `${dose.id}-${p}`) : [dose.id])));
										const missedPastDoses = totalPastDoses.filter(id => !takenDoses.has(id)).length;
										return (
											<div 
												className={`past-days-toggle ${showPastDays ? 'expanded' : ''} ${missedPastDoses > 0 ? 'has-missed' : ''}`}
												onClick={() => setShowPastDays(!showPastDays)}
											>
												<span className="past-days-icon">{showPastDays ? '▼' : '▶'}</span>
												<span className="past-days-label">
													{showPastDays ? t('dashboard.schedules.hidePastDays') : t('dashboard.schedules.showPastDays')}
												</span>
												<span className="past-days-count">({t('dashboard.schedules.pastDaysCount', { count: pastDays.length })})</span>
												{missedPastDoses > 0 ? (
													<span className="past-days-warning" title={t('dashboard.schedules.missedDoses', { count: missedPastDoses })}>⚠️ {missedPastDoses}</span>
												) : totalPastDoses.length > 0 ? (
													<span className="past-days-complete" title={t('dashboard.schedules.allTaken')}>✓</span>
												) : null}
											</div>
										);
									})()}
									{/* Past days (when expanded) */}
									{showPastDays && pastDays.map((day) => {
										const allDoseIds = day.meds.flatMap((item) => item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]));
										const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
										const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
										const isAutoCollapsed = true; // Past days are always auto-collapsed
										const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
										const isCollapsed = !isManuallyExpanded;
										const worstStatus = getDayStockStatus(day.meds);
										
										return (
											<div key={day.dateStr} className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${worstStatus}`}>
												<div 
													className="day-divider clickable" 
													onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
													title={isCollapsed ? t('common.expand') : t('common.collapse')}
												>
													<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
													<span className="day-date">{day.dateStr}</span>
													<span className="day-summary">
														{allDayTaken ? (
															<span className="day-complete">✓ {t('dashboard.schedules.allTaken')}</span>
														) : (
															<><span className="day-warning" title={t('dashboard.schedules.missedDoses', { count: allDoseIds.length - takenCount })}>⚠️</span><span className="day-progress">{takenCount}/{allDoseIds.length}</span></>
														)}
													</span>
												</div>
												{!isCollapsed && day.meds.map((item) => {
													const med = meds.find(m => m.name === item.medName);
													const medCov = coverageByMed[item.medName];
													const isEmpty = medCov ? medCov.medsLeft <= 0 : false;
													const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
													return (
														<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
															<div className="time-main">
																<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" /><span className="med-name-text">{item.medName}</span>{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</div>
																<div className="tag-row">
																	<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	// If no takenBy, show single checkbox; otherwise show one per person
																	const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
																	return (
																		<div key={dose.id} className="dose-item past">
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}</span>
																			<div className="dose-checks">
																				{people.map((person) => {
																					const doseId = getDoseId(dose.id, person);
																					const isTaken = takenDoses.has(doseId);
																					return (
																						<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																							{person && <span className="person-name clickable" onClick={() => setSelectedUser(person)}>{person}</span>}
																							{isTaken ? (
																								<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																							) : (
																								<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} title={t('dose.markAsTaken')} disabled={isEmpty}>✓</button>
																							)}
																						</div>
																					);
																				})}
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
									{/* Current and future days */}
									{futureDays.map((day) => {
										// Check if all doses in this day are taken (auto-collapse)
										const allDoseIds = day.meds.flatMap((item) => item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]));
										const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
										const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
										
										// Calculate worst stock status for this day
										const dayStockStatuses = day.meds.map((item) => {
											const medCoverage = coverageByMed[item.medName];
											const depletionTime = depletionByMed[item.medName];
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											if (willBeOutOfStock) return "danger";
											if (!medCoverage) return "success";
											const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings);
											return status.className;
										});
										const worstStatus = dayStockStatuses.includes("danger") ? "danger" : dayStockStatuses.includes("warning") ? "warning" : "success";
										
										// Check if this is today, past, or future
										const today = new Date();
										today.setHours(0, 0, 0, 0);
										const dayDate = new Date(day.date);
										dayDate.setHours(0, 0, 0, 0);
										const isToday = dayDate.getTime() === today.getTime();
										
										// Determine if day should be collapsed: only today is expanded by default
										const isAutoCollapsed = allDayTaken || !isToday;
										const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
										const isManuallyCollapsed = manuallyCollapsedDays.has(day.dateStr);
										const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;
										
										return (
											<div key={day.dateStr} className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} ${isToday ? "today" : ""} ${worstStatus ? `stock-${worstStatus}` : ""}`}>
												<div 
													className="day-divider clickable" 
													onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
													title={isCollapsed ? t('common.expand') : t('common.collapse')}
												>
													<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
													<span className="day-date">{day.dateStr}</span>
													<span className="day-summary">
														{allDayTaken ? (
															<span className="day-complete">✓ {t('dashboard.schedules.allTaken')}</span>
														) : (
															<span className="day-progress">{takenCount}/{allDoseIds.length}</span>
														)}
													</span>
												</div>
												{!isCollapsed && day.meds.map((item) => {
													const medCoverage = coverageByMed[item.medName];
													const med = meds.find(m => m.name === item.medName);
													const depletionTime = depletionByMed[item.medName];
													const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
													// Check if this dose is scheduled after medication runs out
													const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
													const status = willBeOutOfStock 
														? { className: "danger", label: "status.outOfStock" }
														: medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
													const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
													const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
													return (
														<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
															<div className="time-main">
																<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" /><span className="med-name-text">{item.medName}</span>{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</div>
																<div className="tag-row">
																	<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
																	{status && <span className={`tag ${status.className}`}>
																		{t(status.label)}
																	</span>}
																</div>
															</div>
															<div className="doses-col">
																{item.doses.map((dose) => {
																	const isOverdue = dose.when < Date.now();
																	// Only disable doses on future DAYS, not later today
																	const doseDate = new Date(dose.when);
																	doseDate.setHours(0, 0, 0, 0);
																	const todayMidnight = new Date();
																	todayMidnight.setHours(0, 0, 0, 0);
																	const isFutureDose = doseDate.getTime() > todayMidnight.getTime();
																	// If no takenBy, show single checkbox; otherwise show one per person
																	const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
																	const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
																	return (
																		<div key={dose.id} className={`dose-item ${isOverdue ? "overdue" : ""} ${isFutureDose ? "future" : ""} ${allTaken ? "all-taken" : ""}`}>
																			<span className="dose-time">{dose.timeStr}</span>
																			<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}</span>
																			<div className="dose-checks">
																				{people.map((person) => {
																					const doseId = getDoseId(dose.id, person);
																					const isTaken = takenDoses.has(doseId);
																					return (
																						<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																							{person && <span className="person-name clickable" onClick={() => setSelectedUser(person)}>{person}</span>}
																							{isTaken ? (
																								<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																							) : (
																								<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} title={t('dose.markAsTaken')} disabled={isFutureDose || isEmpty}>✓</button>
																							)}
																						</div>
																					);
																				})}
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
								</div>
							</article>
						</section>
					</>
				} />

				<Route path="/medications" element={
					<section className="grid">
						<article className="card meds">
							<div className="card-head">
								<h2>{t('medications.list.title')}</h2>
							</div>
							<div className="med-list">
								{meds.map((med) => (
									<div key={med.id} className="med-row">
										<div className="med-header">
											<div className="med-info">
												<div className="med-name-row">
													<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="lg" />
													<div className="med-name">{med.name}</div>
												</div>
												<div className="med-details">
													<span>{t('medications.details.packs')}: <strong>{med.packCount}</strong></span>
													<span>{t('medications.details.blisters')}: <strong>{med.blistersPerPack}</strong></span>
													<span>{t('medications.details.pillsPerBlister')}: <strong>{med.pillsPerBlister}</strong></span>
													<span>{t('medications.details.loose')}: <strong>{med.looseTablets}</strong></span>
												</div>
												<div className="med-total">{t('medications.details.total')}: {med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets} {t('common.pills')}</div>
											</div>
											<div className="med-actions">
												<button className="secondary" onClick={() => startEdit(med)}>{t('common.edit')}</button>
												<button className="danger" onClick={() => deleteMed(med.id)}>{t('common.delete')}</button>
											</div>
										</div>
										<div className="blister-list">
											{med.blisters.map((s, idx) => (
												<div key={`${med.id}-${idx}`} className="blister-row-simple">
													{s.usage} {s.usage === 1 ? t('common.pill') : t('common.pills')} · {t('form.blisters.every')} {s.every} {s.every === 1 ? t('common.day') : t('common.days')} · {t('form.blisters.from')} {formatDateTime(s.start, i18n.language)}
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</article>

						<article className="card form desktop-only">
							<div className="card-head">
								<h2>{editingId ? t('form.editEntry') : t('form.newEntry')}</h2>
								{editingId && (
									<button type="button" className="btn secondary small" onClick={resetForm}>
										+ {t('form.newEntry')}
									</button>
								)}
							</div>
							<form className="form-grid" onSubmit={saveMedication}>
								<label className={fieldErrors.name ? 'has-error' : ''}>
									{t('form.commercialName')}
									<input 
										value={form.name} 
										onChange={(e) => setForm({ ...form, name: e.target.value })} 
										placeholder={t('form.placeholders.commercial')} 
										maxLength={FIELD_LIMITS.name.max}
										required 
									/>
									{fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
								</label>
								<label className={fieldErrors.genericName ? 'has-error' : ''}>
									{t('form.genericName')}
									<input 
										value={form.genericName} 
										onChange={(e) => setForm({ ...form, genericName: e.target.value })} 
										placeholder={t('form.placeholders.generic')} 
										maxLength={FIELD_LIMITS.genericName.max}
									/>
									{fieldErrors.genericName && <span className="field-error">{fieldErrors.genericName}</span>}
								</label>
								<label className={fieldErrors.takenBy ? 'has-error' : ''}>
									{t('form.takenBy')}
									<div className="tag-input-container">
										{form.takenBy.map((person) => (
											<span key={person} className="tag">
												{person}
												<button type="button" className="tag-remove" onClick={() => removeTakenByPerson(person)}>×</button>
											</span>
										))}
										<input 
											value={takenByInput} 
											onChange={(e) => setTakenByInput(e.target.value)} 
											onKeyDown={handleTakenByKeyDown}
											onBlur={() => { if (takenByInput.trim()) addTakenByPerson(takenByInput); }}
											placeholder={form.takenBy.length === 0 ? t('form.placeholders.takenBy') : t('form.placeholders.addPerson')}
											maxLength={FIELD_LIMITS.takenBy.max}
											list="takenby-suggestions"
										/>
										<datalist id="takenby-suggestions">
											{existingPeople.filter(p => !form.takenBy.includes(p)).map(person => (
												<option key={person} value={person} />
											))}
										</datalist>
									</div>
									{fieldErrors.takenBy && <span className="field-error">{fieldErrors.takenBy}</span>}
								</label>
								<label>
									{t('form.packs')}
									<input type="number" min="0" value={form.packCount} onChange={(e) => handleValueChange("packCount", e.target.value)} />
								</label>
								<label>
									{t('form.blistersPerPack')}
									<input type="number" min="1" value={form.blistersPerPack} onChange={(e) => handleValueChange("blistersPerPack", e.target.value)} />
								</label>
								<label>
									{t('form.pillsPerBlister')}
									<input type="number" min="1" value={form.pillsPerBlister} onChange={(e) => handleValueChange("pillsPerBlister", e.target.value)} />
								</label>
								<label>
									{t('form.loosePills')}
									<input type="number" min="0" value={form.looseTablets} onChange={(e) => handleValueChange("looseTablets", e.target.value)} />
								</label>
								<label>
									{t('form.pillWeight')}
									<input type="number" min="1" value={form.pillWeightMg} onChange={(e) => handleValueChange("pillWeightMg", e.target.value)} placeholder={t('form.placeholders.weight')} />
								</label>
								<label>
									{t('form.total')}
									<div className="static-value">{formatNumber(totalTablets)}</div>
								</label>
								<label>
									{t('form.expiryDate')}
									<input type="date" value={form.expiryDate} onChange={(e) => handleValueChange("expiryDate", e.target.value)} placeholder={t('common.optional')} />
								</label>

								<label className={`full ${fieldErrors.notes ? 'has-error' : ''}`}>
									{t('form.notes')}
									<textarea 
										value={form.notes} 
										onChange={(e) => handleValueChange("notes", e.target.value)} 
										placeholder={t('form.placeholders.notes')}
										rows={2}
										maxLength={FIELD_LIMITS.notes.max}
										className="auto-resize"
										onInput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
									/>
									{form.notes.length > 0 && (
										<span className={`char-count ${form.notes.length > FIELD_LIMITS.notes.max * 0.9 ? 'warning' : ''}`}>
											{t('common.validation.tooLong', { current: form.notes.length, max: FIELD_LIMITS.notes.max })}
										</span>
									)}
									{fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
								</label>

<div className="full blisters">
									<div className="card-head">
											<h3>{t('form.blisters.title')}</h3>
											<div className="blisters-actions">
												<label className="inline-checkbox" title={t('form.blisters.remindTooltip')}>
													<input 
														type="checkbox" 
														checked={form.intakeRemindersEnabled} 
														onChange={(e) => setForm(prev => ({ ...prev, intakeRemindersEnabled: e.target.checked }))}
													/>
													<span>🔔 {t('form.blisters.remind')}</span>
												</label>
												<button type="button" className="ghost" onClick={addBlister}>+ {t('form.blisters.addIntake')}</button>
											</div>
									</div>
									{form.blisters.map((s, idx) => (
										<div key={idx} className="blister-row">
											<div className="blister-inputs">
												<label>
													{t('form.blisters.usage')}
													<input type="number" min="0" step="0.1" value={s.usage} onChange={(e) => setBlisterValue(idx, "usage", e.target.value)} />
												</label>
												<label>
													{t('form.blisters.everyDays')}
													<input type="number" min="1" value={s.every} onChange={(e) => setBlisterValue(idx, "every", e.target.value)} />
												</label>
												<label>
													{t('form.blisters.startDate')}
													<input type="date" value={s.startDate} onChange={(e) => setBlisterValue(idx, "startDate", e.target.value)} />
												</label>
												<label>
													{t('form.blisters.startTime')}
													<input type="time" value={s.startTime} onChange={(e) => setBlisterValue(idx, "startTime", e.target.value)} />
												</label>
											</div>
											{form.blisters.length > 1 && (
												<button type="button" className="danger" onClick={() => removeBlister(idx)}>{t('common.remove')}</button>
											)}
										</div>
									))}
								</div>

								<div className="full image-upload-section">
									<label className="setting-label">{t('form.medicationImage')}</label>
									{(() => {
										// When editing an existing medication
										if (editingId) {
											const currentMed = meds.find(m => m.id === editingId);
											if (currentMed?.imageUrl) {
												return (
													<div className="image-preview">
														<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
														<button type="button" className="danger" onClick={() => deleteMedImage(editingId)}>{t('form.removeImage')}</button>
													</div>
												);
											}
											return (
												<input 
													type="file" 
													accept="image/jpeg,image/png,image/webp,image/gif"
													onChange={(e) => e.target.files?.[0] && uploadMedImage(editingId, e.target.files[0])}
													disabled={uploadingImage}
												/>
											);
										}
										// When creating a new medication
										if (pendingImagePreview) {
											return (
												<div className="image-preview">
													<img src={pendingImagePreview} alt="Preview" />
													<button type="button" className="danger" onClick={() => { setPendingImage(null); setPendingImagePreview(null); }}>{t('form.removeImage')}</button>
												</div>
											);
										}
										return (
											<input 
												type="file" 
												accept="image/jpeg,image/png,image/webp,image/gif"
												onChange={(e) => {
													const file = e.target.files?.[0];
													if (file) {
														setPendingImage(file);
														const reader = new FileReader();
														reader.onload = (ev) => setPendingImagePreview(ev.target?.result as string);
														reader.readAsDataURL(file);
													}
								}}
											/>
										);
									})()}
								</div>

								<div className="full align-end gap">
									{editingId && (
										<button type="button" className="ghost" onClick={resetForm}>
											{t('common.cancel')}
										</button>
									)}
									<button type="submit" disabled={saving || hasValidationErrors || (!formChanged && (formSaved || editingId))}>
										{saving ? t('common.saving') : formSaved && !formChanged ? t('common.saved') : t('common.save')}
									</button>
								</div>
							</form>
						</article>
					</section>
				} />

				<Route path="/planner" element={
					<section className="grid">
						<article className="card">
							<div className="card-head">
								<h2>{t('planner.title')}</h2>
							</div>
							<form className="planner" onSubmit={runPlanner}>
								<label>
									{t('planner.from')}
									<input type="datetime-local" step="60" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
								</label>
								<label>
									{t('planner.until')}
									<input type="datetime-local" step="60" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
								</label>
								<div className="planner-actions">
									<button type="button" className="ghost" onClick={resetRange}>{t('common.reset')}</button>
									<button type="submit" disabled={plannerLoading}>{plannerLoading ? t('planner.calculating') : t('planner.calculate')}</button>
								</div>
							</form>
							{plannerRows.length > 0 && (
								<>
									<div className="table">
										<div className="table-head">
											<span>{t('planner.table.medication')}</span>
											<span>{t('planner.table.usage')}</span>
											<span>{t('planner.table.blistersNeeded')}</span>
											<span>{t('planner.table.available')}</span>
											<span>{t('table.status')}</span>
										</div>
										{plannerRows.map((row) => {
											const med = meds.find(m => m.name === row.medicationName);
											return (
												<div key={row.medicationId} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
													<span data-label={t('planner.table.medication')} className="cell-with-avatar"><MedicationAvatar name={row.medicationName} imageUrl={med?.imageUrl} />{row.medicationName}</span>
													<span data-label={t('planner.table.usage')}><strong>{row.plannerUsage}</strong>&nbsp;{t('common.pills')}</span>
													<span data-label={t('planner.table.blisters')}>{row.blistersNeeded} × {row.blisterSize}</span>
													<span data-label={t('planner.table.available')}>
														{row.fullBlisters} {t('common.blisters')}{row.loosePills > 0 && ` + ${row.loosePills} ${t('common.pills')}`}
													</span>
													<span data-label={t('table.status')} className={row.enough ? "status-chip success" : "status-chip danger"}>{row.enough ? t('status.enough') : t('status.outOfStock')}</span>
												</div>
											);
										})}
									</div>
									{settings.emailEnabled && settings.notificationEmail && (
										<div className="planner-email-action">
											<button type="button" className="ghost" onClick={sendPlannerEmail} disabled={sendingPlannerEmail}>
												{sendingPlannerEmail ? t('common.sending') : t('planner.sendEmail')}
											</button>
											{plannerEmailResult && (
												<span className={plannerEmailResult.success ? "success-text" : "danger-text"}>
													{plannerEmailResult.message}
												</span>
											)}
										</div>
									)}
								</>
							)}
						</article>
					</section>
				} />

				<Route path="/settings" element={
					<section className="grid">
						{settingsLoading ? (
							<p>{t('settings.loading')}</p>
						) : (
							<form className="settings-form" onSubmit={saveSettings}>
								{/* Language */}
								<article className="card">
									<div className="card-head">
										<h2>{t('settings.language.title')}</h2>
									</div>
									<div className="setting-section">
										<label className="setting-row language-row">
											<span className="setting-label">{t('settings.language.select')}</span>
											<select
												value={i18n.language}
												onChange={(e) => i18n.changeLanguage(e.target.value)}
												className="language-select"
											>
												<option value="en">🇬🇧 English</option>
												<option value="de">🇩🇪 Deutsch</option>
											</select>
										</label>
									</div>
								</article>

								{/* Notifications */}
								<article className="card">
									<div className="card-head">
										<h2>{t('settings.notifications.title')}</h2>
									</div>
									
									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.notifications.channels')}</h3>
										</div>
										<div className="notification-matrix">
											<div className="matrix-header">
												<div className="matrix-label"></div>
												<div className="matrix-channel">{t('settings.notifications.email')}</div>
												<div className="matrix-channel">{t('settings.notifications.push')}</div>
											</div>
											<div className="matrix-row">
												<div className="matrix-label">{t('settings.notifications.stockReminders')}</div>
												<div className="matrix-cell">
													<label className={`toggle-switch small${!settings.emailEnabled ? ' disabled' : ''}`}>
														<input
															type="checkbox"
															checked={settings.smtpHost && settings.emailEnabled ? settings.emailStockReminders : false}
															onChange={(e) => setSettings({ ...settings, emailStockReminders: e.target.checked })}
															disabled={!settings.emailEnabled}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
												<div className="matrix-cell">
													<label className={`toggle-switch small${!settings.shoutrrrEnabled ? ' disabled' : ''}`}>
														<input
															type="checkbox"
															checked={settings.shoutrrrUrl && settings.shoutrrrEnabled ? settings.shoutrrrStockReminders : false}
															onChange={(e) => setSettings({ ...settings, shoutrrrStockReminders: e.target.checked })}
															disabled={!settings.shoutrrrEnabled}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
											</div>
											<div className="matrix-row">
												<div className="matrix-label">{t('settings.notifications.intakeReminders')}</div>
												<div className="matrix-cell">
													<label className={`toggle-switch small${!settings.emailEnabled ? ' disabled' : ''}`}>
														<input
															type="checkbox"
															checked={settings.smtpHost && settings.emailEnabled ? settings.emailIntakeReminders : false}
															onChange={(e) => setSettings({ ...settings, emailIntakeReminders: e.target.checked })}
															disabled={!settings.emailEnabled}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
												<div className="matrix-cell">
													<label className={`toggle-switch small${!settings.shoutrrrEnabled ? ' disabled' : ''}`}>
														<input
															type="checkbox"
															checked={settings.shoutrrrUrl && settings.shoutrrrEnabled ? settings.shoutrrrIntakeReminders : false}
															onChange={(e) => setSettings({ ...settings, shoutrrrIntakeReminders: e.target.checked })}
															disabled={!settings.shoutrrrEnabled}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
											</div>
										</div>
										{!settings.emailEnabled && !settings.shoutrrrEnabled && (
											<p className="hint-text">{t('settings.notifications.enableHint')}</p>
										)}
										
										{/* Skip reminders for taken doses */}
										<div className="setting-row compact" style={{marginTop: "16px", paddingTop: "16px", borderTop: "1px solid var(--border-color)"}}>
											<label className="setting-label">
												{t('settings.notifications.skipTakenDoses')}
												<span className="info-tooltip small" data-tooltip={t('settings.notifications.skipTakenDosesTooltip')}>ⓘ</span>
											</label>
											<label className={`toggle-switch small${!settings.emailEnabled && !settings.shoutrrrEnabled ? ' disabled' : ''}`}>
												<input
													type="checkbox"
													checked={settings.skipRemindersForTakenDoses}
													onChange={(e) => setSettings({ ...settings, skipRemindersForTakenDoses: e.target.checked })}
													disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
										
										{/* Repeat reminders for missed doses */}
										<div className="setting-row compact" style={{marginTop: "12px"}}>
											<label className="setting-label">
												{t('settings.notifications.repeatReminders')}
												<span className="info-tooltip small" data-tooltip={t('settings.notifications.repeatRemindersTooltip')}>ⓘ</span>
											</label>
											<label className={`toggle-switch small${!settings.emailEnabled && !settings.shoutrrrEnabled ? ' disabled' : ''}`}>
												<input
													type="checkbox"
													checked={settings.repeatRemindersEnabled}
													onChange={(e) => setSettings({ ...settings, repeatRemindersEnabled: e.target.checked })}
													disabled={!settings.emailEnabled && !settings.shoutrrrEnabled}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
										
										{/* Reminder interval (only shown when repeat is enabled) */}
										{settings.repeatRemindersEnabled && (
											<>
												<div className="setting-row compact" style={{marginTop: "12px", marginLeft: "24px"}}>
													<label className="setting-label">
														{t('settings.notifications.reminderInterval')}
														<span className="info-tooltip small" data-tooltip={t('settings.notifications.reminderIntervalTooltip')}>ⓘ</span>
													</label>
													<input
														type="number"
														min="5"
														max="480"
														step="5"
														value={settings.reminderRepeatIntervalMinutes}
														onChange={(e) => setSettings({ ...settings, reminderRepeatIntervalMinutes: parseInt(e.target.value) || 30 })}
														style={{width: "80px", textAlign: "center"}}
													/>
												</div>
												<div className="setting-row compact" style={{marginTop: "8px", marginLeft: "24px"}}>
													<label className="setting-label">
														{t('settings.notifications.maxNaggingReminders')}
														<span className="info-tooltip small" data-tooltip={t('settings.notifications.maxNaggingRemindersTooltip')}>ⓘ</span>
													</label>
													<input
														type="number"
														min="1"
														max="20"
														step="1"
														value={settings.maxNaggingReminders ?? 5}
														onChange={(e) => setSettings({ ...settings, maxNaggingReminders: parseInt(e.target.value) || 5 })}
														style={{width: "80px", textAlign: "center"}}
													/>
												</div>
											</>
										)}
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.notifications.email')}</h3>
											<label className={`toggle-switch small${!settings.smtpHost ? ' disabled' : ''}`}>
												<input
													type="checkbox"
													checked={settings.smtpHost ? settings.emailEnabled : false}
													onChange={(e) => {
														const newVal = e.target.checked;
														if (!newVal && !settings.shoutrrrEnabled) {
															setSettings({ ...settings, emailEnabled: false, emailStockReminders: false, emailIntakeReminders: false, skipRemindersForTakenDoses: false, repeatRemindersEnabled: false });
														} else {
															setSettings({ ...settings, emailEnabled: newVal });
														}
													}}
													disabled={!settings.smtpHost}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
										{settings.emailEnabled && (
											<>
												<div className="setting-group">
													<label className="full">
														<span className="field-label">{t('settings.email.recipient')}</span>
														<div className="input-with-tooltip">
															<input
																type="email"
																value={settings.notificationEmail}
																onChange={(e) => setSettings({ ...settings, notificationEmail: e.target.value })}
																placeholder="your@email.com"
																pattern="[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$"
																autoComplete="email"
															/>
															<span className="info-tooltip" data-tooltip={`SMTP: ${settings.smtpHost || t('settings.email.notConfigured')}:${settings.smtpPort}${settings.hasSmtpPassword ? '\nPassword: ✓' : ''}`}>ⓘ</span>
														</div>
													</label>
												</div>
												<div className="setting-actions">
													<button type="button" className="ghost" onClick={testEmail} disabled={testingEmail || !settings.notificationEmail}>
														{testingEmail ? t('common.sending') : t('common.test')}
													</button>
													{testEmailResult && (
														<span className={testEmailResult.success ? "success-text" : "danger-text"}>
															{testEmailResult.message}
														</span>
													)}
												</div>
											</>
										)}
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.notifications.push')}</h3>
											<label className="toggle-switch small">
												<input
													type="checkbox"
													checked={settings.shoutrrrEnabled}
													onChange={(e) => {
														const newVal = e.target.checked;
														if (!newVal && !settings.emailEnabled) {
															setSettings({ ...settings, shoutrrrEnabled: false, shoutrrrStockReminders: false, shoutrrrIntakeReminders: false, skipRemindersForTakenDoses: false, repeatRemindersEnabled: false });
														} else {
															setSettings({ ...settings, shoutrrrEnabled: newVal });
														}
													}}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
										{settings.shoutrrrEnabled && (
											<>
												<div className="setting-group">
													<label className="full">
														<span className="field-label">{t('settings.push.url')}</span>
														<div className="input-with-tooltip">
															<input
																type="url"
																value={settings.shoutrrrUrl}
																onChange={(e) => setSettings({ ...settings, shoutrrrUrl: e.target.value })}
																placeholder="https://ntfy.sh/your-topic"
															/>
															<span className="info-tooltip" data-tooltip={t('settings.push.supports')}>ⓘ</span>
														</div>
													</label>
												</div>
												<div className="setting-actions">
													<button type="button" className="ghost" onClick={testShoutrrr} disabled={testingShoutrrr || !settings.shoutrrrUrl}>
														{testingShoutrrr ? t('common.sending') : t('common.test')}
													</button>
													{testShoutrrrResult && (
														<span className={testShoutrrrResult.success ? "success-text" : "danger-text"}>
															{testShoutrrrResult.message}
														</span>
													)}
												</div>
											</>
										)}
									</div>

									<div className="schedule-overview">
										<div className="schedule-header">
											<span className="schedule-title">{t('settings.schedule.title')}</span>
											<span className="info-tooltip" data-tooltip={t('settings.schedule.envHint')}>ⓘ</span>
										</div>
										<div className="schedule-row">
											<span className="schedule-label">{t('settings.schedule.stockCheck')}</span>
											<span className="schedule-value">{t('settings.schedule.dailyAt6')}</span>
										</div>
										<div className="schedule-row">
											<span className="schedule-label">{t('settings.schedule.intakeCheck')}</span>
											<span className="schedule-value">{t('settings.schedule.15minBefore')}</span>
										</div>
										{settings.nextScheduledCheck && (
											<div className="schedule-row">
												<span className="schedule-label">{t('settings.schedule.nextCheck')}</span>
												<span className="schedule-value">{new Date(settings.nextScheduledCheck).toLocaleString(i18n.language, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
											</div>
										)}
										{settings.lastAutoEmailSent && (
											<div className="schedule-row">
												<span className="schedule-label">{t('settings.schedule.lastSent')}</span>
												<span className="schedule-value">{new Date(settings.lastAutoEmailSent).toLocaleString(i18n.language, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
											</div>
										)}
									</div>
								</article>

								{/* Stock Settings */}
								<article className="card">
									<div className="card-head">
										<h2>{t('settings.stock.title')}</h2>
									</div>
									
									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.stock.threshold')}</h3>
										</div>
										<div className="threshold-input">
											<label>
												<span className="threshold-label">{t('settings.stock.remindWhen')}</span>
												<div className="threshold-field">
													<input
														type="number"
														min="1"
														max="90"
														value={settings.reminderDaysBefore}
														onChange={(e) => setSettings({ ...settings, reminderDaysBefore: Number(e.target.value) || 7 })}
													/>
													<span className="threshold-unit">{t('common.days')}</span>
												</div>
											</label>
										</div>
										<div className="setting-row compact">
											<label className="setting-label">
												{t('settings.stock.repeatDaily')}
												<span className="info-tooltip small" data-tooltip={t('settings.stock.repeatTooltip')}>ⓘ</span>
											</label>
											<label className={`toggle-switch small${!((settings.emailEnabled && settings.emailStockReminders && settings.notificationEmail) || (settings.shoutrrrEnabled && settings.shoutrrrStockReminders && settings.shoutrrrUrl)) ? ' disabled' : ''}`}>
												<input
													type="checkbox"
													checked={settings.repeatDailyReminders}
													onChange={(e) => setSettings({ ...settings, repeatDailyReminders: e.target.checked })}
													disabled={!((settings.emailEnabled && settings.emailStockReminders && settings.notificationEmail) || (settings.shoutrrrEnabled && settings.shoutrrrStockReminders && settings.shoutrrrUrl))}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.stock.calculationMode')}</h3>
										</div>
										<div className="setting-group calculation-mode-group">
											<label className={`radio-card ${settings.stockCalculationMode === 'automatic' ? 'selected' : ''}`}>
												<input
													type="radio"
													name="stockCalculationMode"
													value="automatic"
													checked={settings.stockCalculationMode === 'automatic'}
													onChange={(e) => setSettings({ ...settings, stockCalculationMode: e.target.value as 'automatic' | 'manual' })}
												/>
												<div className="radio-card-content">
													<div className="radio-card-text">
														<span className="radio-card-title">{t('settings.stock.automatic')}</span>
														<span className="radio-card-desc">{t('settings.stock.automaticDesc')}</span>
													</div>
												</div>
											</label>
											<label className={`radio-card ${settings.stockCalculationMode === 'manual' ? 'selected' : ''}`}>
												<input
													type="radio"
													name="stockCalculationMode"
													value="manual"
													checked={settings.stockCalculationMode === 'manual'}
													onChange={(e) => setSettings({ ...settings, stockCalculationMode: e.target.value as 'automatic' | 'manual' })}
												/>
												<div className="radio-card-content">
													<div className="radio-card-text">
														<span className="radio-card-title">{t('settings.stock.manual')}</span>
														<span className="radio-card-desc">{t('settings.stock.manualDesc')}</span>
													</div>
												</div>
											</label>
										</div>
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.stock.display')}</h3>
										</div>
										<div className="setting-group">
											<label>
												<span className="field-label">{t('settings.stock.lowStockDays')}</span>
												<div className="input-with-tooltip">
													<input
														type="number"
														min="1"
														max="365"
														value={settings.lowStockDays}
														onChange={(e) => setSettings({ ...settings, lowStockDays: Number(e.target.value) || 30 })}
													/>
													<span className="info-tooltip" data-tooltip={t('settings.stock.lowStockTooltip')}>ⓘ</span>
												</div>
											</label>
											<label>
												<span className="field-label">{t('settings.stock.highStockDays')}</span>
												<div className="input-with-tooltip">
													<input
														type="number"
														min="1"
														max="730"
														value={settings.highStockDays}
														onChange={(e) => setSettings({ ...settings, highStockDays: Number(e.target.value) || 180 })}
													/>
													<span className="info-tooltip" data-tooltip={t('settings.stock.highStockTooltip')}>ⓘ</span>
												</div>
											</label>
										</div>
									</div>
								</article>

								{/* Export/Import Section */}
								<article className="card">
									<div className="card-head">
										<h2>
											{t('exportImport.title')}
											<span className="info-tooltip" data-tooltip={t('exportImport.description')}>ⓘ</span>
										</h2>
									</div>
									<div className="setting-section">
										<div className="export-import-grid">
											{/* Export */}
											<div className="export-import-card">
												<h3>{t('exportImport.exportTitle')}</h3>
												<p className="export-import-desc">{t('exportImport.exportDesc')}</p>
												<label className="export-import-checkbox">
													<input
														type="checkbox"
														checked={includeSensitiveData}
														onChange={(e) => setIncludeSensitiveData(e.target.checked)}
													/>
													<span>{t('exportImport.includeSensitive')}</span>
												</label>
												{includeSensitiveData && (
													<p className="export-import-warning">
														⚠️ {t('exportImport.sensitiveWarning')}
													</p>
												)}
												<button
													type="button"
													className="secondary"
													onClick={handleExport}
													disabled={exporting}
												>
													{exporting ? t('exportImport.exporting') : t('exportImport.export')}
												</button>
											</div>
											
											{/* Import */}
											<div className="export-import-card">
												<h3>{t('exportImport.importTitle')}</h3>
												<p className="export-import-desc">{t('exportImport.importDesc')}</p>
												<label className="export-import-file-btn">
													{importing ? t('exportImport.importing') : t('exportImport.import')}
													<input
														type="file"
														accept=".json,application/json"
														onChange={handleImportFileSelect}
														disabled={importing}
													/>
												</label>
											</div>
										</div>
									</div>
								</article>

								<div className="form-footer">
									<button type="submit" disabled={settingsSaving || (!settingsChanged && settingsSaved)}>
										{settingsSaving ? t('common.saving') : settingsSaved && !settingsChanged ? t('common.saved') : t('settings.saveSettings')}
									</button>
								</div>
							</form>
						)}

						{/* Import Confirmation Modal */}
						{showImportConfirm && (
							<div className="modal-overlay" onClick={() => setShowImportConfirm(false)}>
								<div className="modal-content" onClick={(e) => e.stopPropagation()} style={{maxWidth: "450px"}}>
									<button className="modal-close" onClick={() => { setShowImportConfirm(false); setPendingImportData(null); }}>×</button>
									<h2 style={{marginBottom: "16px", paddingRight: "2rem"}}>{t('exportImport.confirmImport')}</h2>
									<p style={{marginBottom: "12px"}}>{t('exportImport.confirmImportMessage')}</p>
									<p className="warning-text" style={{marginBottom: "24px"}}>
										⚠️ {t('exportImport.confirmImportWarning')}
									</p>
									<div className="modal-footer" style={{padding: "1rem 0 0 0", borderTop: "none", justifyContent: "flex-end"}}>
										<button
											type="button"
											className="ghost"
											onClick={() => {
												setShowImportConfirm(false);
												setPendingImportData(null);
											}}
										>
											{t('exportImport.cancelButton')}
										</button>
										<button
											type="button"
											className="danger"
											onClick={handleImportConfirm}
										>
											{t('exportImport.confirmButton')}
										</button>
									</div>
								</div>
							</div>
						)}
					</section>
				} />

				<Route path="/schedule" element={
					<section className="grid">
						<article className="card schedule-full">
							<div className="card-head">
								<h2>{t('dashboard.schedules.title')}</h2>
								<select 
									className="schedule-days-select"
									value={scheduleDays}
									onChange={(e) => {
										const val = Number(e.target.value);
										setScheduleDays(val);
										if (user?.id) localStorage.setItem(userStorageKey(user.id, "scheduleDays"), String(val));
									}}
								>
									<option value={30}>{t('dashboard.schedules.1month')}</option>
									<option value={90}>{t('dashboard.schedules.3months')}</option>
									<option value={180}>{t('dashboard.schedules.6months')}</option>
								</select>
							</div>
							<div className="timeline">
								{/* Past days toggle */}
								{pastDays.length > 0 && (() => {
									const totalPastDoses = pastDays.flatMap(d => d.meds.flatMap(m => m.doses.flatMap(dose => (dose.takenBy || []).length > 0 ? dose.takenBy.map(p => `${dose.id}-${p}`) : [dose.id])));
									const missedPastDoses = totalPastDoses.filter(id => !takenDoses.has(id)).length;
									return (
										<div 
											className={`past-days-toggle ${showPastDays ? 'expanded' : ''} ${missedPastDoses > 0 ? 'has-missed' : ''}`}
											onClick={() => setShowPastDays(!showPastDays)}
										>
											<span className="past-days-icon">{showPastDays ? '▼' : '▶'}</span>
											<span className="past-days-label">
												{showPastDays ? t('dashboard.schedules.hidePastDays') : t('dashboard.schedules.showPastDays')}
											</span>
											<span className="past-days-count">({t('dashboard.schedules.pastDaysCount', { count: pastDays.length })})</span>
											{missedPastDoses > 0 && <span className="past-days-warning" title={t('dashboard.schedules.missedDoses', { count: missedPastDoses })}>⚠️ {missedPastDoses}</span>}
										</div>
									);
								})()}
								{/* Past days (when expanded) */}
								{showPastDays && pastDays.map((day) => {
									const allDoseIds = day.meds.flatMap((item) => item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]));
									const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
									const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
									const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
									const isCollapsed = !isManuallyExpanded;
									const worstStatus = getDayStockStatus(day.meds);
									
									return (
										<div key={day.dateStr} className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${worstStatus}`}>
											<div 
												className="day-divider clickable" 
												onClick={() => toggleDayCollapse(day.dateStr, true)}
												title={isCollapsed ? t('common.expand') : t('common.collapse')}
											>
												<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
												<span className="day-date">{day.dateStr}</span>
												<span className="day-summary">
													{allDayTaken ? (
														<span className="day-complete">✓ {t('dashboard.schedules.allTaken')}</span>
													) : (
														<><span className="day-warning" title={t('dashboard.schedules.missedDoses', { count: allDoseIds.length - takenCount })}>⚠️</span><span className="day-progress">{takenCount}/{allDoseIds.length}</span></>
													)}
												</span>
											</div>
											{!isCollapsed && day.meds.map((item) => {
												const med = meds.find(m => m.name === item.medName);
												const medCov = coverageByMed[item.medName];
												const isEmpty = medCov ? medCov.medsLeft <= 0 : false;
												const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
												const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
												return (
													<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
														<div className="time-main">
															<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" /><span className="med-name-text">{item.medName}</span>{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</div>
															<div className="tag-row">
																<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
															</div>
														</div>
														<div className="doses-col">
															{item.doses.map((dose) => {
																// If no takenBy, show single checkbox; otherwise show one per person
																const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
																return (
																	<div key={dose.id} className="dose-item past">
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}</span>
																		<div className="dose-checks">
																			{people.map((person) => {
																				const doseId = getDoseId(dose.id, person);
																				const isTaken = takenDoses.has(doseId);
																				return (
																					<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																						{person && <span className="person-name clickable" onClick={() => setSelectedUser(person)}>{person}</span>}
																						{isTaken ? (
																							<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																						) : (
																							<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} disabled={isEmpty} title={t('dose.markAsTaken')}>✓</button>
																						)}
																					</div>
																				);
																			})}
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
								{/* Current and future days */}
								{futureDays.map((day) => {
									const today = new Date();
									today.setHours(0, 0, 0, 0);
									const dayDate = new Date(day.date);
									dayDate.setHours(0, 0, 0, 0);
									const isToday = dayDate.getTime() === today.getTime();
									return (
									<div key={day.dateStr} className={`day-block ${isToday ? "today" : ""}`}>
										<div className="day-divider">{day.dateStr}</div>
										{day.meds.map((item) => {
											const medCoverage = coverageByMed[item.medName];
											const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
											const med = meds.find(m => m.name === item.medName);
											const depletionTime = depletionByMed[item.medName];
											// Check if this dose is scheduled after medication runs out
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											const status = willBeOutOfStock 
												? { className: "danger", label: "status.outOfStock" }
												: medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
											const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
											const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
											return (
												<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
													<div className="time-main">
														<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" /><span className="med-name-text">{item.medName}</span>{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</div>
														<div className="tag-row">
															<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
															{status && <span className={`tag ${status.className}`}>
																{t(status.label)}
															</span>}
														</div>
													</div>
													<div className="doses-col">
														{item.doses.map((dose) => {
															const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
															const now = Date.now();
															const dayStart = new Date(day.date).setHours(0, 0, 0, 0);
															const isPastDay = dayStart < new Date().setHours(0, 0, 0, 0);
															return (
																<div key={dose.id} className="dose-item">
																	<span className="dose-time">{dose.timeStr}</span>
																	<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}</span>
																	<div className="dose-checks">
																		{people.map((person) => {
																			const doseId = getDoseId(dose.id, person);
																			const isTaken = takenDoses.has(doseId);
																			const isOverdue = !isTaken && dose.when < now && !isPastDay;
																			return (
																				<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}>
																					{person && <span className="person-name clickable" onClick={() => setSelectedUser(person)}>{person}</span>}
																					{isTaken ? (
																						<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																					) : (
																						<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} disabled={isEmpty} title={t('dose.markAsTaken')}>✓</button>
																					)}
																				</div>
																			);
																		})}
																	</div>
																</div>
															);
														})}
													</div>
												</div>
											);
										})}
									</div>
								);})}
							</div>
						</article>
					</section>
				} />
				{/* Catch-all: redirect unknown routes to dashboard */}
				<Route path="*" element={<Navigate to="/dashboard" replace />} />
			</Routes>

			{/* Medication Detail Modal */}
			{selectedMed && (
				<div className="modal-overlay" onClick={() => setSelectedMed(null)}>
					<div className="modal-content med-detail-modal" onClick={(e) => e.stopPropagation()}>
						<button className="modal-close" onClick={() => setSelectedMed(null)}>×</button>
						
						<div className="med-detail-body">
							<div className="med-detail-header">
								<div 
									className={`med-detail-avatar-wrapper ${selectedMed.imageUrl ? 'clickable' : ''}`}
									onClick={() => selectedMed.imageUrl && setShowImageLightbox(true)}
								>
									<MedicationAvatar name={selectedMed.name} imageUrl={selectedMed.imageUrl} size="lg" />
									{selectedMed.imageUrl && <span className="expand-icon">🔍</span>}
								</div>
								<div className="med-detail-titles">
									<h2>{selectedMed.name}</h2>
									{selectedMed.genericName && <span className="med-generic-name">{selectedMed.genericName}</span>}
									{selectedMed.takenBy && (selectedMed.takenBy || []).length > 0 && <span className="med-taken-by">{t('modal.for')} {selectedMed.takenBy.join(", ")}</span>}
								</div>
							</div>
							<div className="med-detail-section">
								<h3>{t('modal.stockInfo')}</h3>
								{(() => {
									const medCoverage = coverage.all.find(c => c.name === selectedMed.name);
									const totalStock = selectedMed.packCount * selectedMed.blistersPerPack * selectedMed.pillsPerBlister + selectedMed.looseTablets;
									const currentStock = medCoverage ? Math.round(medCoverage.medsLeft) : totalStock;
									const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
									const textClass = status?.className === "danger" ? "danger-text" : status?.className === "warning" ? "warning-text" : "success-text";
									const stock = getBlisterStock(
										currentStock, 
										selectedMed.pillsPerBlister,
										selectedMed.looseTablets,
										totalStock
									);
									return (
								<div className="med-detail-grid">
									<div className="med-detail-item">
										<span className="med-detail-label">{t('table.fullBlisters')}</span>
										<span className={`med-detail-value ${textClass}`}>{formatFullBlisters(stock.fullBlisters, t)}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('table.openBlister')}</span>
										<span className={`med-detail-value ${textClass}`}>{formatOpenBlisterAndLoose(stock.openBlisterPills, stock.loosePills, selectedMed.pillsPerBlister ?? 1, t)}</span>
									</div>
									<div className="med-detail-item full-width">
										<span className="med-detail-label">{t('modal.currentStock')}</span>
										<span className={`med-detail-value ${textClass}`}>{currentStock} / {totalStock}</span>
									</div>
								</div>
									);
								})()}
							</div>

							<div className="med-detail-section">
								<h3>{t('modal.packageDetails')}</h3>
								<div className="med-detail-grid">
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.packs')}</span>
										<span className="med-detail-value">{selectedMed.packCount}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.blistersPerPack')}</span>
										<span className="med-detail-value">{selectedMed.blistersPerPack}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.pillsPerBlister')}</span>
										<span className="med-detail-value">{selectedMed.pillsPerBlister}</span>
									</div>
									{selectedMed.pillWeightMg && (
										<div className="med-detail-item">
											<span className="med-detail-label">{t('modal.pillWeight')}</span>
											<span className="med-detail-value">{selectedMed.pillWeightMg} mg</span>
										</div>
									)}
									{selectedMed.expiryDate && (
										<div className="med-detail-item">
											<span className="med-detail-label">{t('modal.expiryDate')}</span>
											<span className={`med-detail-value ${new Date(selectedMed.expiryDate) < new Date() ? 'danger-text' : ''}`}>
												{new Date(selectedMed.expiryDate).toLocaleDateString(i18n.language, { day: "2-digit", month: "short", year: "numeric" })}
											</span>
										</div>
									)}
								</div>
						</div>

							{selectedMed.blisters.length > 0 && (
								<div className="med-detail-section">
									<h3>{t('modal.intakeSchedule')} {selectedMed.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</h3>
									<div className="med-detail-schedules">
										{selectedMed.blisters.map((blister, idx) => {
											const personCount = Math.max(1, selectedMed.takenBy?.length || 1);
											const totalUsage = blister.usage * personCount;
											return (
											<div key={idx} className="med-schedule-item">
												<span className="med-schedule-usage">{totalUsage} {totalUsage !== 1 ? t('common.pills') : t('common.pill')}{selectedMed.pillWeightMg && ` (${totalUsage * selectedMed.pillWeightMg} mg)`}</span>
												<span className="med-schedule-freq">{t('form.blisters.every')} {blister.every} {blister.every !== 1 ? t('common.days') : t('common.day')}</span>
												<span className="med-schedule-time">{t('modal.at')} {new Date(blister.start).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}</span>
											</div>
											);
										})}
									</div>
								</div>
							)}

							{(() => {
								const medCoverage = coverage.all.find(c => c.name === selectedMed.name);
								if (!medCoverage) return null;
								const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings);
								return (
									<div className="med-detail-section">
										<h3 className="section-header-with-badge">
											{t('modal.coverageStatus')}
											<span className={`status-chip small ${status.className}`}>{t(status.label)}</span>
										</h3>
										<div className="med-detail-grid">
											<div className="med-detail-item">
												<span className="med-detail-label">{t('modal.daysLeft')}</span>
												<span className="med-detail-value">{medCoverage.daysLeft !== null ? formatNumber(medCoverage.daysLeft) : "—"}</span>
											</div>
											<div className="med-detail-item">
												<span className="med-detail-label">{t('modal.runsOut')}</span>
												<span className="med-detail-value">{medCoverage.depletionDate ?? "—"}</span>
											</div>
										</div>
									</div>
								);
							})()}

							{selectedMed.notes && (
								<div className="med-detail-section">
									<h3>📝 {t('modal.notes')}</h3>
									<div className="med-notes-content">
										{selectedMed.notes}
									</div>
								</div>
							)}
						</div>

						<div className="med-detail-footer">
							<button onClick={() => { setSelectedMed(null); setShowImageLightbox(false); }}>
								{t('common.close')}
							</button>
							<div className="footer-actions">
								<button className="secondary" onClick={() => { setSelectedMed(null); setShowImageLightbox(false); navigate("/medications"); startEdit(selectedMed); }}>
									{t('common.edit')}
								</button>
								{selectedMed.blisters.length > 0 && (
									<button className="secondary icon-only" onClick={() => generateICS(selectedMed)} title={t('modal.exportTooltip')}>
										📅
									</button>
								)}
							</div>
						</div>
					</div>

					{/* Image Lightbox */}
					{showImageLightbox && selectedMed.imageUrl && (
						<div className="lightbox-overlay" onClick={(e) => { e.stopPropagation(); setShowImageLightbox(false); }}>
							<button className="lightbox-close" onClick={(e) => { e.stopPropagation(); setShowImageLightbox(false); }}>×</button>
							<img 
								src={`/api/images/${selectedMed.imageUrl}`} 
								alt={selectedMed.name} 
								className="lightbox-image"
								onClick={(e) => e.stopPropagation()}
							/>
						</div>
					)}
				</div>
			)}

			{/* User Medications Modal */}
			{selectedUser && (
				<div className="modal-overlay" onClick={() => setSelectedUser(null)}>
					<div className="modal-content user-meds-modal" onClick={(e) => e.stopPropagation()}>
						<button className="modal-close" onClick={() => setSelectedUser(null)}>×</button>
						
						<div className="user-meds-header">
							<div className="user-avatar">{selectedUser.charAt(0).toUpperCase()}</div>
							<h2>{t('modal.userMedications', { name: selectedUser })}</h2>
						</div>

						<div className="user-meds-list">
							{meds.filter(m => (m.takenBy || []).includes(selectedUser)).map((med) => {
								const medCoverage = coverage.all.find(c => c.name === med.name);
								const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
								const totalPills = med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets;
								const currentStock = medCoverage ? formatNumber(medCoverage.medsLeft) : formatNumber(totalPills);
								return (
									<div 
										key={med.id} 
										className="user-med-item clickable"
										onClick={() => { setSelectedUser(null); setSelectedMed(med); }}
									>
										<MedicationAvatar name={med.name} imageUrl={med.imageUrl} size="sm" />
										<div className="user-med-info">
											<span className="user-med-name">{med.name}</span>
											{med.genericName && <span className="user-med-generic">{med.genericName}</span>}
										</div>
										<div className="user-med-stats">
											<span className="user-med-pills">{currentStock}/{formatNumber(totalPills)} {t('common.pills')}</span>
											{status && <span className={`status-chip ${status.className}`}>{t(status.label)}</span>}
										</div>
									</div>
								);
							})}
							{meds.filter(m => (m.takenBy || []).includes(selectedUser)).length === 0 && (
								<div className="user-meds-empty">{t('modal.noMedsForUser', { name: selectedUser })}</div>
							)}
						</div>

						<div className="user-meds-footer">
							<button onClick={() => setSelectedUser(null)}>{t('common.close')}</button>
						</div>
					</div>
				</div>
			)}

			{/* Share Dialog Modal */}
			{showShareDialog && (
				<div className="modal-overlay" onClick={closeShareDialog}>
					<div className="modal-content share-dialog-modal" onClick={(e) => e.stopPropagation()}>
						<button className="modal-close" onClick={closeShareDialog}>×</button>
						
						<div className="share-dialog-header">
							<h2>🔗 {t('share.title')}</h2>
							<p className="share-dialog-description">{t('share.description')}</p>
						</div>

						{sharePeople.length === 0 ? (
							<div className="share-dialog-empty">
								<p>{t('share.noPeople')}</p>
							</div>
						) : shareLink ? (
							<div className="share-dialog-result">
								<p className="share-success">{t('share.linkGenerated')}</p>
								<div className="share-link-box">
									<input
										type="text"
										value={shareLink}
										readOnly
										className="share-link-input"
										onClick={(e) => (e.target as HTMLInputElement).select()}
									/>
									<button className="btn-copy" onClick={copyShareLink}>
										{shareCopied ? "✓" : "📋"}
									</button>
								</div>
								{shareCopied && <span className="share-copied-hint">{t('share.copied')}</span>}
								<div className="share-dialog-footer">
									<button className="ghost" onClick={() => { setShareLink(null); setShareCopied(false); }}>
										{t('share.generateAnother')}
									</button>
									<button onClick={closeShareDialog}>{t('common.close')}</button>
								</div>
							</div>
						) : (
							<div className="share-dialog-form">
								<div className="form-group">
									<label>{t('share.selectPerson')}</label>
									<select 
										value={shareSelectedPerson} 
										onChange={(e) => setShareSelectedPerson(e.target.value)}
									>
										{sharePeople.map((person) => (
											<option key={person} value={person}>{person}</option>
										))}
									</select>
								</div>
								
								<div className="form-group">
									<label>{t('share.selectPeriod')}</label>
									<select 
										value={shareSelectedDays} 
										onChange={(e) => setShareSelectedDays(Number(e.target.value))}
									>
										<option value={30}>{t('dashboard.schedules.1month')}</option>
										<option value={90}>{t('dashboard.schedules.3months')}</option>
										<option value={180}>{t('dashboard.schedules.6months')}</option>
									</select>
								</div>

								<div className="share-dialog-footer">
									<button className="ghost" onClick={closeShareDialog}>{t('common.cancel')}</button>
									<button onClick={generateShareLink} disabled={shareGenerating || !shareSelectedPerson}>
										{shareGenerating ? t('share.generating') : t('share.generateLink')}
									</button>
								</div>
							</div>
						)}
					</div>
				</div>
			)}

			{/* Mobile Edit Modal */}
			{showEditModal && (
				<div className="modal-overlay" onClick={() => setShowEditModal(false)}>
					<div className="modal-content edit-modal" onClick={(e) => e.stopPropagation()}>
						<button className="modal-close" onClick={() => { setShowEditModal(false); resetForm(); }}>×</button>
						<div className="edit-modal-header">
							<h2>{editingId ? t('form.editEntry') : t('form.newEntry')}</h2>
							{editingId && (
								<button type="button" className="btn secondary small" onClick={resetForm}>
									+ {t('form.newEntry')}
								</button>
							)}
						</div>
						<form className="form-grid mobile-edit-form" onSubmit={(e) => { saveMedication(e); setShowEditModal(false); }}>
							<label className={`full ${fieldErrors.name ? 'has-error' : ''}`}>
								{t('form.commercialName')}
								<input 
									value={form.name} 
									onChange={(e) => setForm({ ...form, name: e.target.value })} 
									placeholder={t('form.placeholders.commercial')} 
									maxLength={FIELD_LIMITS.name.max}
									required 
								/>
								{fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
							</label>
							<label className={`full ${fieldErrors.genericName ? 'has-error' : ''}`}>
								{t('form.genericName')}
								<input 
									value={form.genericName} 
									onChange={(e) => setForm({ ...form, genericName: e.target.value })} 
									placeholder={t('form.placeholders.generic')} 
									maxLength={FIELD_LIMITS.genericName.max}
								/>
								{fieldErrors.genericName && <span className="field-error">{fieldErrors.genericName}</span>}
							</label>
							<label className={`full ${fieldErrors.takenBy ? 'has-error' : ''}`}>
								{t('form.takenBy')}
								<div className="tag-input-container">
									{form.takenBy.map((person) => (
										<span key={person} className="tag">
											{person}
											<button type="button" className="tag-remove" onClick={() => removeTakenByPerson(person)}>×</button>
										</span>
									))}
									<input 
										value={takenByInput} 
										onChange={(e) => setTakenByInput(e.target.value)} 
										onKeyDown={handleTakenByKeyDown}
										onBlur={() => { if (takenByInput.trim()) addTakenByPerson(takenByInput); }}
										placeholder={form.takenBy.length === 0 ? t('form.placeholders.takenBy') : t('form.placeholders.addPerson')}
										maxLength={FIELD_LIMITS.takenBy.max}
										list="takenby-suggestions-modal"
									/>
									<datalist id="takenby-suggestions-modal">
										{existingPeople.filter(p => !form.takenBy.includes(p)).map(person => (
											<option key={person} value={person} />
										))}
									</datalist>
								</div>
								{fieldErrors.takenBy && <span className="field-error">{fieldErrors.takenBy}</span>}
							</label>
							<label>
								{t('form.packs')}
								<input type="number" min="0" value={form.packCount} onChange={(e) => handleValueChange("packCount", e.target.value)} />
							</label>
							<label>
								{t('form.blistersPerPack')}
								<input type="number" min="0" value={form.blistersPerPack} onChange={(e) => handleValueChange("blistersPerPack", e.target.value)} />
							</label>
							<label>
								{t('form.pillsPerBlister')}
								<input type="number" min="1" value={form.pillsPerBlister} onChange={(e) => handleValueChange("pillsPerBlister", e.target.value)} />
							</label>
							<label>
								{t('form.loosePills')}
								<input type="number" min="0" value={form.looseTablets} onChange={(e) => handleValueChange("looseTablets", e.target.value)} />
							</label>
							<div className="full">
								<p className="sub"><strong>{t('form.total')}:</strong> {deriveTotal(form)} {t('common.pills')}</p>
							</div>
							<label className="full">
								{t('form.pillWeight')}
								<input type="number" min="0" step="0.1" value={form.pillWeightMg} onChange={(e) => setForm({ ...form, pillWeightMg: e.target.value })} placeholder={t('form.placeholders.weight')} />
							</label>
							<label className="full">
								{t('form.expiryDate')}
								<input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
							</label>
							<label className={`full ${fieldErrors.notes ? 'has-error' : ''}`}>
								{t('form.notes')}
								<textarea 
									value={form.notes} 
									onChange={(e) => setForm({ ...form, notes: e.target.value })} 
									placeholder={t('form.placeholders.notes')} 
									rows={2} 
									maxLength={FIELD_LIMITS.notes.max}
									className="auto-resize"
									onInput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
								/>
								{form.notes.length > 0 && (
									<span className={`char-count ${form.notes.length > FIELD_LIMITS.notes.max * 0.9 ? 'warning' : ''}`}>
										{t('common.validation.tooLong', { current: form.notes.length, max: FIELD_LIMITS.notes.max })}
									</span>
								)}
								{fieldErrors.notes && <span className="field-error">{fieldErrors.notes}</span>}
							</label>

							{editingId && (() => {
								const currentMed = meds.find(m => m.id === editingId);
								if (currentMed?.imageUrl) {
									return (
										<div className="full image-field">
											<span className="field-label">{t('form.medicationImage')}</span>
											<div className="image-preview">
												<img src={currentMed.imageUrl} alt={currentMed.name} />
												<button type="button" className="danger" onClick={() => deleteMedImage(editingId)}>{t('form.removeImage')}</button>
											</div>
										</div>
									);
								}
								return (
									<label className="full">
										{t('form.medicationImage')}
										<input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadMedImage(editingId, e.target.files[0])} />
									</label>
								);
							})()}

							<fieldset className="full blister-section">
								<legend>
									{t('form.blisters.title')}
									<label className="toggle-switch small" title={t('form.blisters.remindTooltip')}>
										<input type="checkbox" checked={form.intakeRemindersEnabled} onChange={(e) => setForm({ ...form, intakeRemindersEnabled: e.target.checked })} />
										<span className="toggle-slider"></span>
									</label>
									<span className="legend-hint">{t('form.blisters.remind')}</span>
								</legend>
								{form.blisters.map((b, idx) => (
									<div key={idx} className="blister-row">
										<label className="compact">
											<span>{t('form.blisters.usage')}</span>
											<input type="number" min="0.5" step="0.5" value={b.usage} onChange={(e) => setBlisterValue(idx, "usage", e.target.value)} />
										</label>
										<label className="compact">
											<span>{t('form.blisters.everyDays')}</span>
											<input type="number" min="1" value={b.every} onChange={(e) => setBlisterValue(idx, "every", e.target.value)} />
										</label>
										<label className="compact full-row">
											<span>{t('form.blisters.startDate')}</span>
											<input type="date" value={b.startDate} onChange={(e) => setBlisterValue(idx, "startDate", e.target.value)} />
										</label>
										<label className="compact time-label">
											<span>{t('form.blisters.startTime')}</span>
											<input type="time" value={b.startTime} onChange={(e) => setBlisterValue(idx, "startTime", e.target.value)} />
										</label>
										{form.blisters.length > 1 && <button type="button" className="danger remove-blister-btn" onClick={() => removeBlister(idx)}>{t('common.remove')}</button>}
									</div>
								))}
								<button type="button" className="ghost add-blister" onClick={addBlister}>+ {t('form.blisters.addIntake')}</button>
							</fieldset>

							<div className="modal-footer">
								<button type="button" className="ghost" onClick={() => { setShowEditModal(false); resetForm(); }}>
									{t('common.cancel')}
								</button>
								<button type="submit" disabled={saving || hasValidationErrors || (!formChanged && (formSaved || editingId))}>
									{saving ? t('common.saving') : formSaved && !formChanged ? t('common.saved') : t('common.save')}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</main>
	);
}

function deriveTotal(form: FormState) {
	const packCount = Number(form.packCount) || 0;
	const blistersPerPack = Number(form.blistersPerPack) || 0;
	const pillsPerBlister = Number(form.pillsPerBlister) || 1;
	const looseTablets = Number(form.looseTablets) || 0;
	return packCount * blistersPerPack * pillsPerBlister + looseTablets;
}

function toIsoString(value: string) {
	if (!value) return new Date().toISOString();
	// datetime-local input gives us local time without timezone info
	// We need to treat it as local time and convert to ISO
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function loadCollapsedDaysFromStorage(collapsedKey: string, expandedKey: string): { collapsed: Set<string>; expanded: Set<string> } {
	const storedCollapsed = localStorage.getItem(collapsedKey);
	const storedExpanded = localStorage.getItem(expandedKey);
	try {
		return {
			collapsed: storedCollapsed ? new Set(JSON.parse(storedCollapsed)) : new Set(),
			expanded: storedExpanded ? new Set(JSON.parse(storedExpanded)) : new Set()
		};
	} catch {
		return {
			collapsed: new Set(),
			expanded: new Set()
		};
	}
}

function toDateValue(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const fallback = Number.isNaN(d.getTime()) ? new Date() : d;
	return `${fallback.getFullYear()}-${pad2(fallback.getMonth() + 1)}-${pad2(fallback.getDate())}`;
}

function toTimeValue(date: Date | string): string {
	const d = typeof date === 'string' ? new Date(date) : date;
	const fallback = Number.isNaN(d.getTime()) ? new Date() : d;
	return `${pad2(fallback.getHours())}:${pad2(fallback.getMinutes())}`;
}

function combineDateAndTime(dateStr: string, timeStr: string): string {
	// Combine separate date and time strings into ISO format
	return `${dateStr}T${timeStr}`;
}

function toInputValue(value: string) {
	const date = new Date(value);
	const d = Number.isNaN(date.getTime()) ? new Date() : date;
	// Use existing helper functions to avoid duplication
	return `${toDateValue(d)}T${toTimeValue(d)}`;
}

function formatDateTime(value: string, locale: string) {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return value;
	return d.toLocaleString(locale, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function generateICS(med: Medication) {
	const formatICSDate = (date: Date) => {
		return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	};
	
	const events = med.blisters.map((blister, idx) => {
		const start = new Date(blister.start);
		const end = new Date(start.getTime() + 15 * 60 * 1000); // 15 min duration
		const interval = blister.every;
		
		const pillInfo = `${blister.usage} pill${blister.usage !== 1 ? 's' : ''}${med.pillWeightMg ? ` (${blister.usage * med.pillWeightMg} mg)` : ''}`;
		const summary = `💊 ${med.name} - ${pillInfo}`;
		const description = [
			`Medication: ${med.name}`,
			med.genericName ? `Generic: ${med.genericName}` : '',
			med.takenBy && me(d.takenBy || []).length > 0 ? `For: ${med.takenBy.join(', ')}` : '',
			`Dosage: ${pillInfo}`,
			`Frequency: every ${interval} day${interval !== 1 ? 's' : ''}`,
			med.notes ? `Notes: ${med.notes}` : '',
		].filter(Boolean).join('\\n');
		
		return `BEGIN:VEVENT
UID:medassist-ng-${med.id}-${idx}@medassist-ng
DTSTAMP:${formatICSDate(new Date())}
DTSTART:${formatICSDate(start)}
DTEND:${formatICSDate(end)}
RRULE:FREQ=DAILY;INTERVAL=${interval}
SUMMARY:${summary}
DESCRIPTION:${description}
BEGIN:VALARM
TRIGGER:-PT5M
ACTION:DISPLAY
DESCRIPTION:Time to take ${med.name}
END:VALARM
END:VEVENT`;
	}).join('\n');
	
	const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//MedAssist-ng//Medication Schedule//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${med.name} Schedule
${events}
END:VCALENDAR`;
	
	const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `${med.name.replace(/[^a-zA-Z0-9]/g, '_')}_schedule.ics`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function buildSchedulePreview(meds: Medication[], locale: string, includePast: boolean = false) {
	const events: Array<{ id: string; medName: string; timeStr: string; dateStr: string; usage: number; when: number; isPast: boolean; takenBy: string[] }> = [];
	if (!Array.isArray(meds)) return { events, groups: [] };
	
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Midnight today
	const end = new Date();
	end.setDate(end.getDate() + 180); // 6 months horizon

	meds.forEach((med) => {
		med.blisters.forEach((blister, idx) => {
			const start = new Date(blister.start);
			if (Number.isNaN(start.getTime())) return;
			for (let d = new Date(start); d <= end; d.setDate(d.getDate() + blister.every)) {
				const isPast = d < todayStart;
				// Skip past events unless includePast is true
				if (isPast && !includePast) continue;
				const whenMs = d.getTime();
				events.push({
					id: `${med.id}-${idx}-${whenMs}`,
					medName: med.name,
					takenBy: med.takenBy || [],
					usage: blister.usage,
					when: whenMs,
					isPast,
					timeStr: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
					dateStr: d.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" }),
				});
			}
		});
	});

	events.sort((a, b) => a.when - b.when);

	const todayCount = events.filter((e) => {
		const t = new Date(e.when);
		const n = new Date();
		return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
	}).length;

	return { events, today: todayCount, nextThree: events.length, totalBlisters: meds.reduce((acc, m) => acc + m.blisters.length, 0) };
}

function formatNumber(value: number | null) {
	if (value === null || Number.isNaN(value)) return "-";
	if (Math.abs(value % 1) < 0.05) return Math.round(value).toLocaleString();
	return value.toFixed(1);
}

// Calculate blister stock with realistic consumption order:
// Loose pills are consumed FIRST, then blisters are opened
function getBlisterStock(
	currentPills: number, 
	pillsPerBlister: number, 
	originalLooseTablets: number,
	originalTotalPills: number
): { fullBlisters: number; openBlisterPills: number; loosePills: number } {
	if (pillsPerBlister <= 0 || pillsPerBlister === 1) {
		return { fullBlisters: 0, openBlisterPills: 0, loosePills: currentPills };
	}
	
	// Calculate how many pills have been consumed
	const consumed = originalTotalPills - currentPills;
	
	// Loose pills are consumed first
	const looseConsumed = Math.min(consumed, originalLooseTablets);
	const loosePillsRemaining = originalLooseTablets - looseConsumed;
	
	// Remaining consumption comes from blisters
	const blisterPillsConsumed = consumed - looseConsumed;
	const originalBlisterPills = originalTotalPills - originalLooseTablets;
	const blisterPillsRemaining = originalBlisterPills - blisterPillsConsumed;
	
	// Calculate full blisters and open blister
	const fullBlisters = Math.floor(blisterPillsRemaining / pillsPerBlister);
	const openBlisterPills = blisterPillsRemaining % pillsPerBlister;
	
	return { fullBlisters, openBlisterPills, loosePills: loosePillsRemaining };
}

// Format full blisters column
function formatFullBlisters(fullBlisters: number, t: (key: string) => string): string {
	if (fullBlisters === 0) return "—";
	return `${fullBlisters} ${fullBlisters === 1 ? t('common.blister') : t('common.blisters')}`;
}

// Format open blister + loose pills column
function formatOpenBlisterAndLoose(
	openBlisterPills: number, 
	loosePills: number, 
	pillsPerBlister: number, 
	t: (key: string) => string
): string {
	// Format open blister part
	const openBlisterText = openBlisterPills > 0 
		? `${openBlisterPills} ${t('common.of')} ${pillsPerBlister} ${t('common.pills')}`
		: t('common.none');
	
	// Format loose pills part (if any)
	if (loosePills > 0) {
		return `${openBlisterText} + ${loosePills} ${t('common.loose')}`;
	}
	
	// No loose pills
	if (openBlisterPills === 0) return "—";
	return openBlisterText;
}

function getExpiryClass(expiryDate: string | null | undefined, expiryWarningDays: number = 30): string {
	if (!expiryDate) return "";
	const now = new Date();
	const expiry = new Date(expiryDate);
	const diffMs = expiry.getTime() - now.getTime();
	const diffDays = diffMs / (1000 * 60 * 60 * 24);
	
	if (diffDays <= 7) return "danger-text"; // 1 week or less (or expired)
	if (diffDays <= expiryWarningDays) return "warning-text"; // within warning period
	return "success-text"; // outside warning period
}

function calculateCoverage(
	meds: Medication[], 
	events: Array<{ medName: string; when: number }>, 
	locale: string, 
	reminderDaysBefore: number,
	stockCalculationMode: "automatic" | "manual",
	takenDoses: Set<string>
) {
	const MS_PER_DAY = 86_400_000;
	const now = Date.now();

	const coverage: Coverage[] = meds.map((m) => {
		// Multiply daily rate by number of people taking this medication
		const personCount = Math.max(1, m.takenBy?.length || 1);
		const dailyRate = m.blisters.reduce((sum, s) => sum + (s.every > 0 ? s.usage / s.every : 0), 0) * personCount;

		let consumed = 0;
		
		if (stockCalculationMode === "automatic") {
			// Automatic mode: calculate consumed based on schedule since start date
			// Multiply by personCount since each person takes the medication
			m.blisters.forEach((s) => {
				const start = new Date(s.start).getTime();
				if (Number.isNaN(start) || start > now) return;
				const period = Math.max(1, s.every) * MS_PER_DAY;
				const occurrences = Math.floor((now - start) / period) + 1; // include today if started
				consumed += occurrences * s.usage * personCount;
			});
		} else {
			// Manual mode: count only doses marked as taken for this medication
			// Dose IDs follow pattern: "{medicationId}-{blisterIndex}-{timestampMs}" or "{medicationId}-{blisterIndex}-{timestampMs}-{person}"
			takenDoses.forEach((doseId) => {
				const parts = doseId.split("-");
				if (parts.length >= 3) {
					const medId = parseInt(parts[0], 10);
					const blisterIdx = parseInt(parts[1], 10);
					const doseTimestamp = parseInt(parts[2], 10);
					if (medId === m.id && m.blisters[blisterIdx]) {
						// Only count doses that are on or after the blister's start date
						const blisterStart = new Date(m.blisters[blisterIdx].start).getTime();
						if (!Number.isNaN(blisterStart) && doseTimestamp >= blisterStart) {
							// Each taken dose (regardless of person) consumes the usage amount
							consumed += m.blisters[blisterIdx].usage;
						}
					}
				}
		});
	}

		const totalPills = m.packCount * m.blistersPerPack * m.pillsPerBlister + m.looseTablets;
		const medsLeft = Math.max(0, totalPills - consumed);
		const rawDaysLeft = dailyRate > 0 ? medsLeft / dailyRate : null;
		const daysLeft = rawDaysLeft !== null ? Math.max(0, Math.floor(rawDaysLeft)) : null; // conservative: round down
		const depletionMs = daysLeft !== null ? now + daysLeft * MS_PER_DAY : null;
		const depletionDate = depletionMs !== null ? new Date(depletionMs).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" }) : null;
		const nextEvent = events.find((e) => e.medName === m.name);

		return {
			name: m.name,
			medsLeft: Number(medsLeft.toFixed(1)),
			daysLeft,
			depletionDate,
			depletionTime: depletionMs,
			nextDose: nextEvent ? new Date(nextEvent.when).toLocaleString(locale, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null,
		};
	});

	const low = coverage.filter((c) => c.medsLeft <= 0 || (c.daysLeft !== null && c.daysLeft <= reminderDaysBefore));
	return { low, all: coverage };
}

function getReminderStatusText(
	reminderDaysBefore: number,
	lowStockDays: number,
	lowStock: Coverage[], 
	allCoverage: Coverage[],
	lastSent: string | null, 
	lastType: "stock" | "intake" | null,
	lastChannel: "email" | "push" | "both" | null,
	t: (key: string, options?: Record<string, unknown>) => string, 
	locale: string
): React.ReactNode {
	// Find empty medications (medsLeft <= 0)
	const emptyMeds = allCoverage.filter((c) => c.medsLeft <= 0);
	
	// Find medications that need reminder (daysLeft <= reminderDaysBefore but not empty)
	const medsNeedingReminder = allCoverage
		.filter((c) => c.medsLeft > 0 && c.daysLeft !== null && c.daysLeft <= reminderDaysBefore)
		.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
	
	// Find low stock medications (not yet critical but running low)
	const lowStockNotYetCritical = allCoverage.filter(
		(c) => c.medsLeft > 0 && c.daysLeft !== null && c.daysLeft > reminderDaysBefore && c.daysLeft < lowStockDays
	);

	const formatLastSent = (iso: string) => {
		const date = new Date(iso);
		return date.toLocaleDateString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
	};

	const getTypeLabel = () => lastType === "intake" ? t('dashboard.reminders.typeIntake') : t('dashboard.reminders.typeStock');
	const getChannelLabel = () => {
		if (lastChannel === "both") return t('dashboard.reminders.channelBoth');
		if (lastChannel === "push") return t('dashboard.reminders.channelPush');
		return t('dashboard.reminders.channelEmail');
	};

	const formatLastInfo = (iso: string) => {
		const dateStr = formatLastSent(iso);
		if (lastType && lastChannel) {
			return `${dateStr} (${getTypeLabel()}, ${getChannelLabel()})`;
		}
		return dateStr;
	};

	// Priority 1: Empty medications (critical - red)
	if (emptyMeds.length > 0) {
		const parts: React.ReactNode[] = [
			<strong key="empty" className="danger-text">🚨 {t('dashboard.reminders.emptyStock', { count: emptyMeds.length })}</strong>
		];
		if (medsNeedingReminder.length > 0) {
			parts.push(<span key="reorder" className="danger-text"> · ⚠ {t('dashboard.reminders.needReorder', { count: medsNeedingReminder.length })}</span>);
		}
		if (lowStockNotYetCritical.length > 0) {
			parts.push(<span key="low" className="warning-text"> · {t('dashboard.reminders.lowWarning', { count: lowStockNotYetCritical.length })}</span>);
		}
		return (
			<>
				<span className="email-status-line">{parts}</span>
				<span className="email-status-line">{lastSent ? `${t('dashboard.reminders.lastReminder')}: ${formatLastInfo(lastSent)}` : ''}</span>
			</>
		);
	}

	// Priority 2: Medications needing reminder soon (critical - red)
	if (medsNeedingReminder.length > 0) {
		const parts: React.ReactNode[] = [
			<strong key="reorder" className="danger-text">⚠ {t('dashboard.reminders.needReorder', { count: medsNeedingReminder.length })}</strong>
		];
		if (lowStockNotYetCritical.length > 0) {
			parts.push(<span key="low" className="warning-text"> · {t('dashboard.reminders.lowWarning', { count: lowStockNotYetCritical.length })}</span>);
		}
		return (
			<>
				<span className="email-status-line">{parts}</span>
				<span className="email-status-line">{lastSent ? `${t('dashboard.reminders.lastReminder')}: ${formatLastInfo(lastSent)}` : ''}</span>
			</>
		);
	}

	// Priority 3: Low stock but not yet critical (warning - yellow)
	if (lowStockNotYetCritical.length > 0) {
		const nextMed = lowStockNotYetCritical.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
		const daysUntilReminder = Math.max(0, (nextMed.daysLeft ?? 0) - reminderDaysBefore);
		return (
			<>
				<span className="email-status-line"><span className="warning-text">{t('dashboard.reminders.lowWarning', { count: lowStockNotYetCritical.length })}</span></span>
				<span className="email-status-line">{t('dashboard.reminders.nextIn')}: <strong>{nextMed.name}</strong> {t('dashboard.reminders.inDays', { days: daysUntilReminder })}</span>
			</>
		);
	}

	// Calculate when next reminder would be triggered
	const allWithDepletion = allCoverage
		.filter((c) => c.depletionTime !== null && c.daysLeft !== null && c.medsLeft > 0)
		.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

	if (allWithDepletion.length > 0) {
		const nextMed = allWithDepletion[0];
		const daysUntilReminder = (nextMed.daysLeft ?? 0) - reminderDaysBefore;
		if (daysUntilReminder > 0) {
			return (
				<>
					<span className="email-status-line"><span className="success-text">✓ {t('dashboard.reminders.allOk')}</span></span>
					<span className="email-status-line">{t('dashboard.reminders.nextIn')}: <strong>{nextMed.name}</strong> {t('dashboard.reminders.inDays', { days: daysUntilReminder })}</span>
				</>
			);
		}
	}

	// No low stock medications at all
	if (lastSent) {
		return (
			<>
				<span className="email-status-line"><span className="success-text">✓ {t('dashboard.reminders.allStockOk')}</span></span>
				<span className="email-status-line">{t('dashboard.reminders.lastReminder')}: {formatLastInfo(lastSent)}</span>
			</>
		);
	}
	return (
		<>
			<span className="email-status-line"><span className="success-text">✓ {t('dashboard.reminders.allStockOk')}</span></span>
			<span className="email-status-line">{t('dashboard.reminders.noRemindersNeeded')}</span>
		</>
	);
}

function getNextReminderForMed(med: Coverage, reminderDaysBefore: number, locale: string): string {
	if (!med.depletionTime) return "—";
	
	const reminderTime = med.depletionTime - reminderDaysBefore * 86_400_000;
	const now = Date.now();
	
	if (reminderTime <= now) {
		return "Due now";
	}
	
	return new Date(reminderTime).toLocaleDateString(locale, {
		day: "2-digit",
		month: "short",
	});
}

type StockStatus = {
	level: "out-of-stock" | "low" | "normal" | "high";
	className: string;
	label: string;
};

type StockThresholds = {
	lowStockDays: number;
	normalStockDays: number;
	highStockDays: number;
};

function getStockStatus(daysLeft: number | null, medsLeft: number, thresholds: StockThresholds): StockStatus {
	// Out of stock: 0 pills
	if (medsLeft <= 0 || daysLeft === 0) {
		return { level: "out-of-stock", className: "danger", label: "status.outOfStock" };
	}
	
	// No schedule set (no daysLeft calculation possible)
	if (daysLeft === null) {
		return { level: "normal", className: "success", label: "status.noSchedule" };
	}
	
	// High stock: > highStockDays (e.g. > 180 days)
	if (daysLeft > thresholds.highStockDays) {
		return { level: "high", className: "high", label: "status.highStock" };
	}
	
	// Normal stock: between lowStockDays and highStockDays
	if (daysLeft >= thresholds.lowStockDays) {
		return { level: "normal", className: "success", label: "status.normal" };
	}
	
	// Low stock: < lowStockDays (e.g. < 30 days)
	return { level: "low", className: "warning", label: "status.lowStock" };
}

function MedicationAvatar({ name, imageUrl, size = "sm" }: { name: string; imageUrl?: string | null; size?: "sm" | "md" | "lg" }) {
	const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
	const sizeClass = `med-avatar med-avatar-${size}`;
	
	if (imageUrl) {
		return <img src={`/api/images/${imageUrl}`} alt={name} className={sizeClass} />;
	}
	return <div className={`${sizeClass} med-avatar-initials`}>{initials}</div>;
}

// =============================================================================
// Shared Schedule Component - Public view for shared schedules
// =============================================================================
type SharedMedication = {
	id: number;
	name: string;
	genericName?: string | null;
	pillWeightMg?: number | null;
	imageUrl?: string | null;
	totalPills: number;
	packCount: number;
	blistersPerPack: number;
	looseTablets: number;
	pillsPerBlister: number;
	takenBy: string[];
	blisters: Blister[];
};

type SharedScheduleData = {
	takenBy: string;
	sharedBy: string | null;
	scheduleDays: number;
	medications: SharedMedication[];
	stockThresholds?: {
		lowStockDays: number;
	};
};

type ExpiredLinkData = {
	ownerUsername: string;
	takenBy: string;
	expiredAt: string;
};

function SharedSchedule() {
	const { token } = useParams<{ token: string }>();
	const { t, i18n } = useTranslation();
	const [data, setData] = useState<SharedScheduleData | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [expiredData, setExpiredData] = useState<ExpiredLinkData | null>(null);
	const [takenDoses, setTakenDoses] = useState<Set<string>>(new Set());
	const [lightboxImage, setLightboxImage] = useState<{ url: string; name: string } | null>(null);
	const [showPastDays, setShowPastDays] = useState(false);
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		if (typeof window !== "undefined") {
			return (localStorage.getItem("theme") as "light" | "dark") || "dark";
		}
		return "dark";
	});

	// Apply theme to document
	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
		localStorage.setItem("theme", theme);
	}, [theme]);

	function toggleTheme() {
		setTheme((prev) => (prev === "dark" ? "light" : "dark"));
	}
	// Collapsed days state for SharedSchedule (token-specific localStorage)
	const [manuallyCollapsedDays, setManuallyCollapsedDays] = useState<Set<string>>(new Set());
	const [manuallyExpandedDays, setManuallyExpandedDays] = useState<Set<string>>(new Set());

	// Load collapsed/expanded state from localStorage
	useEffect(() => {
		if (token && typeof window !== "undefined") {
			const { collapsed, expanded } = loadCollapsedDaysFromStorage(
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
				const next = new Set(prev);
				if (next.has(dateStr)) {
					next.delete(dateStr);
				} else {
					next.add(dateStr);
				}
				if (token) localStorage.setItem(`share_${token}_expandedDays`, JSON.stringify([...next]));
				return next;
			});
		} else {
			setManuallyCollapsedDays((prev) => {
				const next = new Set(prev);
				if (next.has(dateStr)) {
					next.delete(dateStr);
				} else {
					next.add(dateStr);
				}
				if (token) localStorage.setItem(`share_${token}_collapsedDays`, JSON.stringify([...next]));
				return next;
			});
		}
	}

	// Close lightbox on Escape key
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape" && lightboxImage) {
				setLightboxImage(null);
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [lightboxImage]);

	// Load taken doses from server with polling for real-time sync
	useEffect(() => {
		if (token) {
			async function loadTakenDoses() {
				try {
					const res = await fetch(`/api/share/${token}/doses`);
					if (res.ok) {
						const data = await res.json();
						setTakenDoses(new Set(data.doses.map((d: { doseId: string }) => d.doseId)));
					} else {
						setTakenDoses(new Set());
					}
				} catch {
					setTakenDoses(new Set());
				}
			}
			loadTakenDoses();
			
			// Poll for updates every 5 seconds (real-time sync with dashboard)
			const interval = setInterval(loadTakenDoses, 5000);
			return () => clearInterval(interval);
		}
	}, [token]);

	// Get dose ID with optional person suffix
	function getDoseId(baseDoseId: string, person: string | null): string {
		return person ? `${baseDoseId}-${person}` : baseDoseId;
	}

	// Count taken doses for a day/item
	function countTakenDoses(doses: Array<{ id: string; takenBy: string[] }>): { total: number; taken: number } {
		let total = 0;
		let taken = 0;
		for (const d of doses) {
			const people = (d.takenBy || []).length > 0 ? d.takenBy : [null];
			for (const person of people) {
				total++;
				if (takenDoses.has(getDoseId(d.id, person))) taken++;
			}
		}
		return { total, taken };
	}

	async function markDoseTaken(doseId: string) {
		// Optimistic update
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			return next;
		});
		
		// Send to server
		try {
			await fetch(`/api/share/${token}/doses`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ doseId }),
			});
		} catch {
			// Revert on error
			setTakenDoses((prev) => {
				const next = new Set(prev);
				next.delete(doseId);
				return next;
			});
		}
	}

	async function undoDoseTaken(doseId: string) {
		// Optimistic update
		setTakenDoses((prev) => {
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
		}
	}

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
					setError(t('share.notFound'));
				} else {
					setError(t('share.error'));
				}
			} catch {
				setError(t('share.error'));
			} finally {
				setLoading(false);
			}
		}
		fetchData();
	}, [token, t]);

	// Build schedule from medications - matches buildSchedulePreview logic exactly
	const schedule = useMemo(() => {
		if (!data) return [];

		// Use same logic as buildSchedulePreview in main app
		const now = new Date();
		const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Midnight today
		const todayStartTime = todayStart.getTime();
		
		// Use 180 days horizon like main app (scheduleDays only limits futureDays display)
		const end = new Date();
		end.setDate(end.getDate() + 180);
		const endTime = end.getTime();
		
		const doses: { id: string; when: number; medName: string; usage: number; timeStr: string; isPast: boolean; takenBy: string[]; dateStr: string }[] = [];

		for (const med of data.medications) {
			med.blisters.forEach((blister, blisterIdx) => {
				const startDate = new Date(blister.start);
				if (Number.isNaN(startDate.getTime())) return;
				
				// Use the same iteration method as buildSchedulePreview (setDate instead of adding ms)
				// This ensures identical timestamps even across DST changes
				for (let d = new Date(startDate); d <= end; d.setDate(d.getDate() + blister.every)) {
					const t = d.getTime();
					const isPast = d < todayStart;
					// Generate dose ID matching Dashboard format: ${med.id}-${blisterIdx}-${whenMs}
					const doseId = `${med.id}-${blisterIdx}-${t}`;
					doses.push({
						id: doseId,
						when: t,
						medName: med.name,
						usage: blister.usage,
						isPast,
						takenBy: med.takenBy || [],
						timeStr: d.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
						dateStr: d.toLocaleDateString(i18n.language, { weekday: "short", day: "2-digit", month: "short" }),
					});
				}
			});
		}

		doses.sort((a, b) => a.when - b.when);

		// Group by date - matches groupedSchedule logic in main app
		type DoseInfo = typeof doses[number];
		const days = new Map<string, { dateStr: string; date: Date; isPast: boolean; meds: Map<string, { medName: string; total: number; doses: DoseInfo[]; lastWhen: number }> }>();
		
		for (const dose of doses.slice(0, 2000)) {
			const day = days.get(dose.dateStr) ?? { dateStr: dose.dateStr, date: new Date(dose.when), isPast: dose.isPast, meds: new Map() };
			const medEntry = day.meds.get(dose.medName) ?? { medName: dose.medName, total: 0, doses: [], lastWhen: dose.when };
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
			meds: Array.from(d.meds.values()) 
		}));
	}, [data, i18n.language]);

	// Split into past and future - matches main app logic
	const pastDays = useMemo(() => schedule.filter(d => d.isPast), [schedule]);
	// Limit future days by scheduleDays setting (same as main app)
	const futureDays = useMemo(() => schedule.filter(d => !d.isPast).slice(0, data?.scheduleDays ?? 30), [schedule, data?.scheduleDays]);

	// Calculate coverage for stock status colors (matches main app logic)
	// This needs to account for taken doses and calculate depletion time
	const { coverageByMed, depletionByMed } = useMemo(() => {
		if (!data) return { coverageByMed: {}, depletionByMed: {} };
		const coverage: Record<string, { daysLeft: number | null; medsLeft: number; dailyUsage: number }> = {};
		const depletion: Record<string, number | null> = {};
		
		// Calculate total pills taken per medication from takenDoses
		// Each person's taken dose counts separately toward pills consumed
		const takenByMed: Record<string, number> = {};
		for (const dose of schedule.flatMap(d => d.meds.flatMap(m => m.doses))) {
			// Check all person-specific dose IDs for this dose
			const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
			for (const person of people) {
				const doseId = person ? `${dose.id}-${person}` : dose.id;
				if (takenDoses.has(doseId)) {
					takenByMed[dose.medName] = (takenByMed[dose.medName] || 0) + dose.usage;
				}
			}
		}
		
		for (const med of data.medications) {
			const totalCount = med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets;
			const taken = takenByMed[med.name] || 0;
			const currentCount = Math.max(0, totalCount - taken);
			// Calculate daily usage from blisters, multiplied by number of people
			const personCount = Math.max(1, med.takenBy?.length || 1);
			const dailyUsage = med.blisters.reduce((sum, b) => sum + (b.usage / b.every), 0) * personCount;
			const daysLeft = dailyUsage > 0 ? currentCount / dailyUsage : null;
			coverage[med.name] = { daysLeft, medsLeft: currentCount, dailyUsage };
			
			// Calculate depletion time (when medication will run out)
			if (dailyUsage > 0 && currentCount > 0) {
				const daysUntilEmpty = currentCount / dailyUsage;
				depletion[med.name] = Date.now() + daysUntilEmpty * 24 * 60 * 60 * 1000;
			} else if (currentCount <= 0) {
				depletion[med.name] = Date.now(); // Already empty
			} else {
				depletion[med.name] = null; // No usage schedule
			}
		}
		return { coverageByMed: coverage, depletionByMed: depletion };
	}, [data, schedule, takenDoses]);

	// Stock thresholds from user settings (provided by API) or defaults
	const lowStockDays = data?.stockThresholds?.lowStockDays ?? 30;

	// Get worst stock status for a day's medications (matches main app logic with depletion)
	const getDayStockStatus = (meds: { medName: string; lastWhen: number }[]) => {
		const statuses = meds.map((item) => {
			const coverage = coverageByMed[item.medName];
			const depletionTime = depletionByMed[item.medName];
			
			// Will be out of stock by this day?
			if (typeof depletionTime === "number" && item.lastWhen > depletionTime) {
				return "danger";
			}
			
			if (!coverage) return "success";
			const { daysLeft, medsLeft } = coverage;
			
			// Currently out of stock
			if (medsLeft <= 0 || daysLeft === 0) return "danger";
			// No schedule (can't calculate)
			if (daysLeft === null) return "success";
			// Low stock: < lowStockDays (warning)
			if (daysLeft < lowStockDays) return "warning";
			// Normal/High stock
			return "success";
		});
		return statuses.includes("danger") ? "danger" : statuses.includes("warning") ? "warning" : "success";
	};

	if (loading) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-loading">
					<h1>💊 MedAssist</h1>
					<p>{t('common.loading')}</p>
				</div>
			</div>
		);
	}

	if (expiredData) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-error expired">
					<h1>💊 MedAssist</h1>
					<div className="expired-icon">⏰</div>
					<h2>{t('share.expired.title')}</h2>
					<p className="expired-message">
						{t('share.expired.message', { takenBy: expiredData.takenBy })}
					</p>
					<p className="expired-contact">
						{t('share.expired.contact', { username: expiredData.ownerUsername })}
					</p>
					<p className="expired-date">
						{t('share.expired.expiredOn', { date: new Date(expiredData.expiredAt).toLocaleDateString(i18n.language) })}
					</p>
				</div>
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="shared-schedule-page">
				<div className="shared-schedule-error">
					<h1>💊 MedAssist</h1>
					<p className="error-message">{error || "Unknown error"}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="shared-schedule-page">
			<div className="shared-schedule-container">
				<header className="shared-schedule-header">
					<h1>💊 {t('share.scheduleFor')} {data.takenBy}</h1>
					<div className="shared-schedule-header-actions">
						<button className="icon-btn" onClick={toggleTheme} title={theme === "dark" ? t('tooltips.lightMode') : t('tooltips.darkMode')}>
							{theme === "dark" ? "☀️" : "🌙"}
						</button>
					</div>
					<p className="shared-schedule-period">
						{t('share.period')}: {data.scheduleDays === 30 ? t('dashboard.schedules.1month') : data.scheduleDays === 90 ? t('dashboard.schedules.3months') : t('dashboard.schedules.6months')}
					</p>
				</header>

				<div className="timeline">
					{schedule.length === 0 ? (
						<p className="shared-schedule-empty">{t('share.noSchedule')}</p>
					) : (
						<>
							{/* Past days toggle */}
							{pastDays.length > 0 && (() => {
								const totalPastDoses = pastDays.flatMap(d => d.meds.flatMap(m => m.doses.flatMap(dose => (dose.takenBy || []).length > 0 ? dose.takenBy.map(p => `${dose.id}-${p}`) : [dose.id])));
								const missedPastDoses = totalPastDoses.filter(id => !takenDoses.has(id)).length;
								return (
									<div 
										className={`past-days-toggle ${showPastDays ? 'expanded' : ''} ${missedPastDoses > 0 ? 'has-missed' : ''}`}
										onClick={() => setShowPastDays(!showPastDays)}
									>
										<span className="past-days-icon">{showPastDays ? '▼' : '▶'}</span>
										<span className="past-days-label">
											{showPastDays ? t('dashboard.schedules.hidePastDays') : t('dashboard.schedules.showPastDays')}
										</span>
										<span className="past-days-count">({t('dashboard.schedules.pastDaysCount', { count: pastDays.length })})</span>
										{missedPastDoses > 0 ? (
											<span className="past-days-warning" title={t('dashboard.schedules.missedDoses', { count: missedPastDoses })}>⚠️ {missedPastDoses}</span>
										) : totalPastDoses.length > 0 ? (
											<span className="past-days-complete" title={t('dashboard.schedules.allTaken')}>✓</span>
										) : null}
									</div>
								);
							})()}
							{/* Past days (when expanded) */}
							{showPastDays && pastDays.map((day) => {
								const allDoseIds = day.meds.flatMap((item) => item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]));
								const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
								const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
								const isCollapsed = !isManuallyExpanded;
								
								// Calculate stock status for this day
								const worstStatus = getDayStockStatus(day.meds);
								
								return (
									<div key={day.dateStr} className={`day-block past ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} stock-${worstStatus}`}>
										<div 
											className="day-divider clickable" 
											onClick={() => toggleDayCollapse(day.dateStr, true)}
											title={isCollapsed ? t('common.expand') : t('common.collapse')}
										>
											<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
											<span className="day-date">{day.dateStr}</span>
											<span className="day-summary">
												{allDayTaken ? (
													<span className="day-complete">✓ {t('dashboard.schedules.allTaken')}</span>
												) : (
													<><span className="day-warning" title={t('dashboard.schedules.missedDoses', { count: allDoseIds.length - takenCount })}>⚠️</span><span className="day-progress">{takenCount}/{allDoseIds.length}</span></>
												)}
											</span>
										</div>
										{!isCollapsed && day.meds.map((item) => {
											const med = data.medications.find(m => m.name === item.medName);
											const medCoverage = coverageByMed[item.medName];
											const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
											const depletionTime = depletionByMed[item.medName];
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											
											// Calculate status for this medication on this day
											let status: { className: string; label: string } | null = null;
											if (willBeOutOfStock) {
												status = { className: "danger", label: "status.outOfStock" };
											} else if (medCoverage) {
												const { daysLeft, medsLeft } = medCoverage;
												if (medsLeft <= 0 || daysLeft === 0) {
													status = { className: "danger", label: "status.outOfStock" };
												} else if (daysLeft !== null && daysLeft < lowStockDays) {
													status = { className: "warning", label: "status.lowStock" };
												} else {
													status = { className: "success", label: "status.normal" };
												}
											}
											
											const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
											const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
											return (
												<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
													<div className="time-main">
														<div className="med-name">
															<span 
																className={med?.imageUrl ? 'clickable' : ''}
																onClick={() => med?.imageUrl && setLightboxImage({ url: med.imageUrl, name: med.name })}
															>
																<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
															</span>
															<span className="med-name-text">{item.medName}</span>
															{med?.genericName && <span className="med-generic-inline">({med.genericName})</span>}
														</div>
														<div className="tag-row">
															<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
															{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
														</div>
													</div>
													<div className="doses-col">
														{item.doses.map((dose) => {
															const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
															const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
															return (
																<div key={dose.id} className={`dose-item past ${allTaken ? "all-taken" : ""}`}>
																	<span className="dose-time">{dose.timeStr}</span>
																	<span className="dose-usage">
																		{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}
																		{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}
																	</span>
																	<div className="dose-checks">
																		{people.map((person) => {
																			const doseId = getDoseId(dose.id, person);
																			const isTaken = takenDoses.has(doseId);
																			return (
																				<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""}`}>
																					{person && <span className="person-name">{person}</span>}
																					{isTaken ? (
																						<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																					) : (
																						<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} disabled={isEmpty} title={t('dose.markAsTaken')}>✓</button>
																					)}
																				</div>
																			);
																		})}
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
							{/* Current and future days */}
							{futureDays.map((day) => {
								// Check if all doses in this day are taken (auto-collapse)
								const allDoseIds = day.meds.flatMap((item) => item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]));
								const allDayTaken = allDoseIds.length > 0 && allDoseIds.every((id) => takenDoses.has(id));
								const takenCount = allDoseIds.filter((id) => takenDoses.has(id)).length;
								
								// Calculate stock status for this day
								const worstStatus = getDayStockStatus(day.meds);
								
								// Check if this is today
								const today = new Date();
								today.setHours(0, 0, 0, 0);
								const dayDate = new Date(day.date);
								dayDate.setHours(0, 0, 0, 0);
								const isToday = dayDate.getTime() === today.getTime();
								
								// Determine if day should be collapsed: only today is expanded by default
								const isAutoCollapsed = allDayTaken || !isToday;
								const isManuallyExpanded = manuallyExpandedDays.has(day.dateStr);
								const isManuallyCollapsed = manuallyCollapsedDays.has(day.dateStr);
								const isCollapsed = isAutoCollapsed ? !isManuallyExpanded : isManuallyCollapsed;
								
								return (
									<div key={day.dateStr} className={`day-block ${isCollapsed ? "collapsed" : ""} ${allDayTaken ? "all-taken" : ""} ${isToday ? "today" : ""} stock-${worstStatus}`}>
										<div 
											className="day-divider clickable" 
											onClick={() => toggleDayCollapse(day.dateStr, isAutoCollapsed)}
											title={isCollapsed ? t('common.expand') : t('common.collapse')}
										>
											<span className="day-collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
											<span className="day-date">{day.dateStr}</span>
											<span className="day-summary">
												{allDayTaken ? (
													<span className="day-complete">✓ {t('dashboard.schedules.allTaken')}</span>
												) : (
													<span className="day-progress">{takenCount}/{allDoseIds.length}</span>
												)}
											</span>
										</div>
										{!isCollapsed && day.meds.map((item) => {
											const med = data.medications.find(m => m.name === item.medName);
											const medCoverage = coverageByMed[item.medName];
											const isEmpty = medCoverage ? medCoverage.medsLeft <= 0 : false;
											const depletionTime = depletionByMed[item.medName];
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											
											// Calculate status for this medication on this day
											let status: { className: string; label: string } | null = null;
											if (willBeOutOfStock) {
												status = { className: "danger", label: "status.outOfStock" };
											} else if (medCoverage) {
												const { daysLeft, medsLeft } = medCoverage;
												if (medsLeft <= 0 || daysLeft === 0) {
													status = { className: "danger", label: "status.outOfStock" };
												} else if (daysLeft !== null && daysLeft < lowStockDays) {
													status = { className: "warning", label: "status.lowStock" };
												} else {
													status = { className: "success", label: "status.normal" };
												}
											}
											
											const itemDoseIds = item.doses.flatMap((d) => (d.takenBy || []).length > 0 ? d.takenBy.map((p) => `${d.id}-${p}`) : [d.id]);
											const allTaken = itemDoseIds.every((id) => takenDoses.has(id));
											return (
												<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
													<div className="time-main">
														<div className="med-name">
															<span 
																className={med?.imageUrl ? 'clickable' : ''}
																onClick={() => med?.imageUrl && setLightboxImage({ url: med.imageUrl, name: med.name })}
															>
																<MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />
															</span>
															<span className="med-name-text">{item.medName}</span>
															{med?.genericName && <span className="med-generic-inline">({med.genericName})</span>}
														</div>
														<div className="tag-row">
															<span className="tag subtle">{item.total} {t('common.pills')} {t('common.total')}</span>
															{status && <span className={`tag ${status.className}`}>{t(status.label)}</span>}
														</div>
													</div>
													<div className="doses-col">
														{item.doses.map((dose) => {
															const people = (dose.takenBy || []).length > 0 ? dose.takenBy : [null];
															const allTaken = people.every((person) => takenDoses.has(getDoseId(dose.id, person)));
															// Only disable doses on future DAYS, not later today
															const doseDate = new Date(dose.when);
															doseDate.setHours(0, 0, 0, 0);
															const todayMidnight = new Date();
															todayMidnight.setHours(0, 0, 0, 0);
															const isFutureDose = doseDate.getTime() > todayMidnight.getTime();
															return (
																<div key={dose.id} className={`dose-item ${isFutureDose ? "future" : ""} ${allTaken ? "all-taken" : ""}`}>
																	<span className="dose-time">{dose.timeStr}</span>
																	<span className="dose-usage">
																		{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}
																		{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}
																	</span>
																	<div className="dose-checks">
																		{people.map((person) => {
																			const doseId = getDoseId(dose.id, person);
																			const isTaken = takenDoses.has(doseId);
																			const isOverdue = dose.when < Date.now() && !isTaken && !isFutureDose;
																			return (
																				<div key={doseId} className={`dose-person ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}>
																					{person && <span className="person-name">{person}</span>}
																					{isTaken ? (
																						<button className="dose-btn undo" onClick={() => undoDoseTaken(doseId)} title={t('common.undo')}>↩</button>
																					) : (
																						<button className="dose-btn take" onClick={() => markDoseTaken(doseId)} title={t('dose.markAsTaken')} disabled={isFutureDose || isEmpty}>✓</button>
																					)}
																				</div>
																			);
																		})}
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

				<footer className="shared-schedule-footer">
					<p>{t('share.generatedBy')} {data?.sharedBy && <><strong>{data.sharedBy}</strong> · </>}<a href="/">MedAssist</a></p>
				</footer>
			</div>

			{/* Image Lightbox */}
			{lightboxImage && (
				<div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
					<button className="lightbox-close" onClick={() => setLightboxImage(null)}>×</button>
					<img 
						src={`/api/images/${lightboxImage.url}`} 
						alt={lightboxImage.name} 
						className="lightbox-image"
						onClick={(e) => e.stopPropagation()}
					/>
				</div>
			)}
		</div>
	);
}
