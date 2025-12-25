import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

type Slice = {
	usage: number;
	every: number;
	start: string;
};

type Medication = {
	id: number;
	name: string;
	genericName?: string | null;
	takenBy?: string | null;
	count: number;
	strips: number;
	stripSize: number;
	packCount?: number;
	stripsPerPack?: number;
	tabsPerStrip?: number;
	looseTablets?: number;
	pillWeightMg?: number | null;
	slices: Slice[];
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
	stripSize: number;
	stripsNeeded: number;
	stripsAvailable: number;
	enough: boolean;
};

type FormSlice = { usage: string; every: string; start: string };

type FormState = {
	name: string;
	genericName: string;
	takenBy: string;
	packCount: string;
	stripsPerPack: string;
	tabsPerStrip: string;
	looseTablets: string;
	pillWeightMg: string;
	expiryDate: string;
	notes: string;
	intakeRemindersEnabled: boolean;
	slices: FormSlice[];
};

const defaultSlice = (): FormSlice => ({ usage: "1", every: "1", start: toInputValue(new Date().toISOString()) });

const defaultForm = (): FormState => ({ name: "", genericName: "", takenBy: "", packCount: "1", stripsPerPack: "1", tabsPerStrip: "1", looseTablets: "0", pillWeightMg: "", expiryDate: "", notes: "", intakeRemindersEnabled: false, slices: [defaultSlice()] });

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

export default function App() {
	const { t, i18n } = useTranslation();
	const [meds, setMeds] = useState<Medication[]>([]);
	const [plannerRows, setPlannerRows] = useState<PlannerRow[]>(() => {
		if (typeof window !== "undefined") {
			const saved = localStorage.getItem("plannerRows");
			if (saved) {
				try { return JSON.parse(saved); } catch { return []; }
			}
		}
		return [];
	});
	const [plannerLoading, setPlannerLoading] = useState(false);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState<FormState>(defaultForm());
	const [range, setRange] = useState<{ start: string; end: string }>(() => {
		if (typeof window !== "undefined") {
			const saved = localStorage.getItem("plannerRange");
			if (saved) {
				try { return JSON.parse(saved); } catch { /* ignore */ }
			}
		}
		return { start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) };
	});

	const navigate = useNavigate();
	const location = useLocation();
	const currentPath = location.pathname;

	// Settings state
	const [settings, setSettings] = useState({
		emailEnabled: false,
		notificationEmail: "",
		reminderDaysBefore: 7,
		repeatDailyReminders: false,
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
	const [selectedMed, setSelectedMed] = useState<Medication | null>(null);
	const [showImageLightbox, setShowImageLightbox] = useState(false);
	const [selectedUser, setSelectedUser] = useState<string | null>(null);
	const [scheduleDays, setScheduleDays] = useState<number>(() => {
		const stored = localStorage.getItem("scheduleDays");
		return stored ? Number(stored) : 30;
	});

	// Track taken doses (stored in localStorage)
	const [takenDoses, setTakenDoses] = useState<Set<string>>(() => {
		try {
			const stored = localStorage.getItem("takenDoses");
			if (stored) {
				const parsed = JSON.parse(stored);
				// Clean up old entries (older than 7 days)
				const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
				const filtered = parsed.filter((item: { id: string; timestamp: number }) => item.timestamp > weekAgo);
				return new Set(filtered.map((item: { id: string }) => item.id));
			}
		} catch {}
		return new Set();
	});

	function markDoseTaken(doseId: string) {
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.add(doseId);
			// Persist with timestamp for cleanup
			const items = Array.from(next).map((id) => ({ id, timestamp: Date.now() }));
			localStorage.setItem("takenDoses", JSON.stringify(items));
			return next;
		});
	}

	function undoDoseTaken(doseId: string) {
		setTakenDoses((prev) => {
			const next = new Set(prev);
			next.delete(doseId);
			const items = Array.from(next).map((id) => ({ id, timestamp: Date.now() }));
			localStorage.setItem("takenDoses", JSON.stringify(items));
			return next;
		});
	}

	// Close modal on Escape key
	useEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				if (showImageLightbox) {
					setShowImageLightbox(false);
				} else if (selectedUser) {
					setSelectedUser(null);
				} else if (selectedMed) {
					setSelectedMed(null);
				}
			}
		};
		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [selectedMed, showImageLightbox, selectedUser]);

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

	const schedule = useMemo(() => buildSchedulePreview(meds, i18n.language), [meds, i18n.language]);
	const totalTablets = useMemo(() => deriveTotal(form), [form]);
	const coverage = useMemo(() => calculateCoverage(meds, schedule.events, i18n.language, settings.reminderDaysBefore), [meds, schedule.events, i18n.language, settings.reminderDaysBefore]);
	const depletionByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c.depletionTime])), [coverage.all]);
	const coverageByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c])), [coverage.all]);
	const groupedSchedule = useMemo(() => {
		type DoseInfo = { id: string; timeStr: string; when: number; usage: number };
		const days = new Map<string, { dateStr: string; meds: Map<string, { medName: string; total: number; doses: DoseInfo[]; lastWhen: number }> }>();
		schedule.events.slice(0, 2000).forEach((event) => {
			const day = days.get(event.dateStr) ?? { dateStr: event.dateStr, meds: new Map() };
			const medEntry = day.meds.get(event.medName) ?? { medName: event.medName, total: 0, doses: [], lastWhen: event.when };
			medEntry.total += event.usage;
			medEntry.doses.push({ id: event.id, timeStr: event.timeStr, when: event.when, usage: event.usage });
			medEntry.lastWhen = Math.max(medEntry.lastWhen, event.when);
			day.meds.set(event.medName, medEntry);
			days.set(event.dateStr, day);
		});
		return Array.from(days.values()).map((d) => ({ dateStr: d.dateStr, meds: Array.from(d.meds.values()) })).slice(0, scheduleDays);
	}, [schedule.events, scheduleDays]);

	useEffect(() => {
		loadMeds();
		loadSettings();
	}, []);

	function loadMeds() {
		setLoading(true);
		fetch("/api/medications")
			.then((res) => res.json())
			.then((data: Medication[]) => setMeds(data))
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
		
		// Validate email if email notifications are enabled
		if (settings.emailEnabled && settings.notificationEmail) {
			const emailRegex = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
			if (!emailRegex.test(settings.notificationEmail)) {
				setTestEmailResult({ success: false, message: "Invalid email address" });
				return;
			}
		}
		
		setSettingsSaving(true);
		setTestEmailResult(null);
		
		const payload = {
			emailEnabled: settings.emailEnabled,
			notificationEmail: settings.notificationEmail,
			reminderDaysBefore: settings.reminderDaysBefore,
			repeatDailyReminders: settings.repeatDailyReminders,
			lowStockDays: settings.lowStockDays,
			normalStockDays: settings.normalStockDays,
			highStockDays: settings.highStockDays,
			shoutrrrEnabled: settings.shoutrrrEnabled,
			shoutrrrUrl: settings.shoutrrrUrl,
			// Granular notification settings
			emailStockReminders: settings.emailStockReminders,
			emailIntakeReminders: settings.emailIntakeReminders,
			shoutrrrStockReminders: settings.shoutrrrStockReminders,
			shoutrrrIntakeReminders: settings.shoutrrrIntakeReminders,
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

		setSettingsSaving(false);
		setSavedSettings(settings);
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

	function setSliceValue(idx: number, field: keyof FormSlice, value: string) {
		setForm((prev) => {
			const next = [...prev.slices];
			next[idx] = { ...next[idx], [field]: value };
			return { ...prev, slices: next };
		});
	}

	function addSlice() {
		setForm((prev) => ({ ...prev, slices: [...prev.slices, defaultSlice()] }));
	}

	function removeSlice(idx: number) {
		setForm((prev) => ({ ...prev, slices: prev.slices.filter((_, i) => i !== idx) }));
	}

	function startEdit(med: Medication) {
		setEditingId(med.id);
		setForm({
			name: med.name,
			genericName: med.genericName ?? "",
			takenBy: med.takenBy ?? "",
			packCount: String(med.packCount ?? 1),
			stripsPerPack: String(med.stripsPerPack ?? med.strips ?? 1),
			tabsPerStrip: String(med.tabsPerStrip ?? med.stripSize ?? 1),
			looseTablets: String(med.looseTablets ?? 0),
			pillWeightMg: med.pillWeightMg ? String(med.pillWeightMg) : "",
			expiryDate: med.expiryDate ? med.expiryDate.slice(0, 10) : "",
			notes: med.notes ?? "",
			intakeRemindersEnabled: med.intakeRemindersEnabled ?? false,
			slices: med.slices.map((s) => ({ usage: String(s.usage), every: String(s.every), start: toInputValue(s.start) })),
		});
	}

	function resetForm() {
		setEditingId(null);
		setForm(defaultForm());
	}

	function handleValueChange<K extends keyof FormState>(key: K, value: string) {
		setForm((prev) => ({ ...prev, [key]: value }));
	}

	async function saveMedication(e: React.FormEvent) {
		e.preventDefault();
		if (!form.name.trim()) return;
		setSaving(true);

		const payload = {
			name: form.name.trim(),
			genericName: form.genericName.trim() || null,
			takenBy: form.takenBy.trim() || null,
			packCount: Number(form.packCount) || 0,
			stripsPerPack: Math.max(1, Number(form.stripsPerPack) || 1),
			tabsPerStrip: Math.max(1, Number(form.tabsPerStrip) || 1),
			looseTablets: Math.max(0, Number(form.looseTablets) || 0),
			pillWeightMg: form.pillWeightMg ? Number(form.pillWeightMg) : null,
			expiryDate: form.expiryDate || null,
			notes: form.notes.trim() || null,
			intakeRemindersEnabled: form.intakeRemindersEnabled,
			slices: form.slices.map((s) => ({ usage: Number(s.usage) || 0, every: Math.max(1, Number(s.every) || 1), start: toIsoString(s.start) })),
		};

		const method = editingId ? "PUT" : "POST";
		const url = editingId ? `/api/medications/${editingId}` : "/api/medications";

		await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);

		setSaving(false);
		resetForm();
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
		// Save to localStorage
		localStorage.setItem("plannerRange", JSON.stringify(range));
		localStorage.setItem("plannerRows", JSON.stringify(rows));
	}

	function resetRange() {
		setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		setPlannerRows([]);
		localStorage.removeItem("plannerRange");
		localStorage.removeItem("plannerRows");
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
					<button className={`icon-btn ${currentPath === "/settings" ? "active" : ""}`} onClick={() => navigate("/settings")} title={t('nav.settings')}>⚙️</button>
					<button className="icon-btn" onClick={toggleTheme} title={theme === "dark" ? t('tooltips.lightMode') : t('tooltips.darkMode')}>
						{theme === "dark" ? "☀️" : "🌙"}
					</button>
				</div>
			</header>

			<Routes>
				<Route path="/" element={<Navigate to="/dashboard" replace />} />
				<Route path="/dashboard" element={
					<>
						{(settings.emailEnabled || settings.shoutrrrEnabled) && (
							<section className="email-status-bar">
								<span className="email-status-icon">{settings.emailEnabled && settings.shoutrrrEnabled ? "🔔" : settings.emailEnabled ? "📧" : "🔔"}</span>
								<span className="email-status-text">
									{t('dashboard.reminders.active')} — {getReminderStatusText(settings.reminderDaysBefore, coverage.low, settings.lastAutoEmailSent, settings.lastNotificationType, settings.lastNotificationChannel, t, i18n.language)}
								</span>
								{settings.emailEnabled && settings.notificationEmail && <span className="email-status-recipient">→ {settings.notificationEmail}</span>}
							</section>
						)}
						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>{t('dashboard.reorder.title')}</h2>
									<span className="pill neutral">{t('dashboard.reorder.badge')}</span>
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
											<div className="table table-6">
											<div className="table-head">
												<span>{t('table.name')}</span>
												<span>{t('table.currentPills')}</span>
												<span>{t('table.daysLeft')}</span>
												<span>{t('table.status')}</span>
												<span>{t('table.runsOut')}</span>
												<span>{t('table.autoRemind')}</span>
											</div>
											{coverage.low.map((row) => {
												const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
												const med = meds.find(m => m.name === row.name);
												const textClass = status.className === "danger" ? "danger-text" : status.className === "warning" ? "warning-text" : "";
												return (
													<div key={row.name} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
														<span data-label={t('table.name')} className="cell-with-avatar"><MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />{row.name}{med?.takenBy && <span className="taken-by-badge clickable" onClick={(e) => { e.stopPropagation(); setSelectedUser(med.takenBy!); }}>{med.takenBy}</span>}{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}{med?.notes && <span className="notes-icon info-tooltip" data-tooltip={t('tooltips.hasNotes')}>📝</span>}</span>
														<span data-label={t('table.pills')} className={textClass}>{formatNumber(row.medsLeft)}</span>
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
									<span className="pill neutral">{t('dashboard.overview.badge')}</span>
								</div>
								<div className="table table-6">
									<div className="table-head">
										<span>{t('table.name')}</span>
										<span>{t('table.currentPills')}</span>
										<span>{t('table.daysLeft')}</span>
										<span>{t('table.runsOut')}</span>
										<span>{t('table.expiry')}</span>
										<span>{t('table.status')}</span>
									</div>
									{coverage.all.map((row) => {
										const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
										const med = meds.find(m => m.name === row.name);
										const expiryClass = getExpiryClass(med?.expiryDate, settings.expiryWarningDays);
										const textClass = status.className === "danger" ? "danger-text" : status.className === "warning" ? "warning-text" : "";
										return (
											<div key={row.name} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
												<span data-label={t('table.name')} className="cell-with-avatar"><MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />{row.name}{med?.takenBy && <span className="taken-by-badge clickable" onClick={(e) => { e.stopPropagation(); setSelectedUser(med.takenBy!); }}>{med.takenBy}</span>}{med?.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}{med?.notes && <span className="notes-icon info-tooltip" data-tooltip={t('tooltips.hasNotes')}>📝</span>}</span>
												<span data-label={t('table.pills')} className={textClass}>{formatNumber(row.medsLeft)}</span>
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
									<h2 className="clickable" onClick={() => navigate("/schedule")}>{t('dashboard.schedules.title')}</h2>
									<select 
										className="schedule-days-select"
										value={scheduleDays}
										onChange={(e) => {
											const val = Number(e.target.value);
											setScheduleDays(val);
											localStorage.setItem("scheduleDays", String(val));
										}}
									>
										<option value={30}>{t('dashboard.schedules.1month')}</option>
										<option value={90}>{t('dashboard.schedules.3months')}</option>
										<option value={180}>{t('dashboard.schedules.6months')}</option>
									</select>
								</div>
								<div className="timeline">
									{groupedSchedule.map((day) => (
										<div key={day.dateStr} className="day-block">
											<div className="day-divider">{day.dateStr}</div>
											{day.meds.map((item) => {
												const medCoverage = coverageByMed[item.medName];
												const med = meds.find(m => m.name === item.medName);
												const depletionTime = depletionByMed[item.medName];
												// Check if this dose is scheduled after medication runs out
												const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
												const status = willBeOutOfStock 
													? { className: "danger", label: "status.outOfStock" }
													: medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
												const allTaken = item.doses.every((d) => takenDoses.has(d.id));
												const takenCount = item.doses.filter((d) => takenDoses.has(d.id)).length;
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
																const isTaken = takenDoses.has(dose.id);
																const isOverdue = dose.when < Date.now();
																return (
																	<div key={dose.id} className={`dose-item ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}>
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}{med?.takenBy && <span className="taken-by-inline"> {t('dose.takenBy')} <span className="taken-by-name clickable" onClick={() => setSelectedUser(med.takenBy!)}>{med.takenBy}</span></span>}</span>
																		{isTaken ? (
																			<button className="dose-btn undo" onClick={() => undoDoseTaken(dose.id)} title={t('common.undo')}>↩</button>
																		) : (
																			<button className="dose-btn take" onClick={() => markDoseTaken(dose.id)} title={t('dose.markAsTaken')}>✓</button>
																		)}
																	</div>
																);
															})}
														</div>
													</div>
												);
											})}
										</div>
									))}
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
								<span className="pill neutral">{loading ? t('common.loading') : t('medications.list.entries', { count: meds.length })}</span>
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
													<span>{t('medications.details.packs')}: <strong>{med.packCount ?? 1}</strong></span>
													<span>{t('medications.details.blisters')}: <strong>{med.stripsPerPack ?? med.strips ?? 1}</strong></span>
													<span>{t('medications.details.pillsPerBlister')}: <strong>{med.tabsPerStrip ?? med.stripSize}</strong></span>
													<span>{t('medications.details.loose')}: <strong>{med.looseTablets ?? 0}</strong></span>
												</div>
												<div className="med-total">{t('medications.details.total')}: {med.count} {t('common.pills')}</div>
											</div>
											<div className="med-actions">
												<button className="ghost" onClick={() => startEdit(med)}>{t('common.edit')}</button>
												<button className="ghost danger" onClick={() => deleteMed(med.id)}>{t('common.delete')}</button>
											</div>
										</div>
										<div className="slice-list">
											{med.slices.map((s, idx) => (
												<div key={`${med.id}-${idx}`} className="slice-row-simple">
													{s.usage} {s.usage === 1 ? t('common.pill') : t('common.pills')} · {t('form.slices.every')} {s.every} {s.every === 1 ? t('common.day') : t('common.days')} · {t('form.slices.from')} {formatDateTime(s.start, i18n.language)}
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</article>

						<article className="card form">
							<div className="card-head">
								<h2>{editingId ? t('form.editEntry') : t('form.newEntry')}</h2>
								<span className="pill">{t('form.badge')}</span>
							</div>
							<form className="form-grid" onSubmit={saveMedication}>
								<label>
									{t('form.commercialName')}
									<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('form.placeholders.commercial')} required />
								</label>
								<label>
									{t('form.genericName')}
									<input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} placeholder={t('form.placeholders.generic')} />
								</label>
								<label>
									{t('form.takenBy')}
									<input value={form.takenBy} onChange={(e) => setForm({ ...form, takenBy: e.target.value })} placeholder={t('form.placeholders.takenBy')} />
								</label>
								<label>
									{t('form.packs')}
									<input type="number" min="0" value={form.packCount} onChange={(e) => handleValueChange("packCount", e.target.value)} />
								</label>
								<label>
									{t('form.blistersPerPack')}
									<input type="number" min="1" value={form.stripsPerPack} onChange={(e) => handleValueChange("stripsPerPack", e.target.value)} />
								</label>
								<label>
									{t('form.pillsPerBlister')}
									<input type="number" min="1" value={form.tabsPerStrip} onChange={(e) => handleValueChange("tabsPerStrip", e.target.value)} />
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

								<label className="full">
									{t('form.notes')}
									<textarea 
										value={form.notes} 
										onChange={(e) => handleValueChange("notes", e.target.value)} 
										placeholder={t('form.placeholders.notes')}
										rows={2}
										maxLength={500}
									/>
								</label>

								<div className="full slices">
									<div className="card-head">
										<h3>{t('form.slices.title')}</h3>
										<div className="slices-actions">
											<label className="inline-checkbox" title={t('form.slices.remindTooltip')}>
												<input 
													type="checkbox" 
													checked={form.intakeRemindersEnabled} 
													onChange={(e) => setForm(prev => ({ ...prev, intakeRemindersEnabled: e.target.checked }))}
												/>
												<span>🔔 {t('form.slices.remind')}</span>
											</label>
											<button type="button" className="ghost" onClick={addSlice}>+ {t('form.slices.addIntake')}</button>
										</div>
									</div>
									{form.slices.map((s, idx) => (
										<div key={idx} className="slice-row">
											<div className="slice-inputs">
												<label>
													{t('form.slices.usage')}
													<input type="number" min="0" step="0.1" value={s.usage} onChange={(e) => setSliceValue(idx, "usage", e.target.value)} />
												</label>
												<label>
													{t('form.slices.everyDays')}
													<input type="number" min="1" value={s.every} onChange={(e) => setSliceValue(idx, "every", e.target.value)} />
												</label>
												<label>
													{t('form.slices.start')}
													<input type="datetime-local" step="60" value={s.start} onChange={(e) => setSliceValue(idx, "start", e.target.value)} />
												</label>
											</div>
											{form.slices.length > 1 && (
												<button type="button" className="ghost" onClick={() => removeSlice(idx)}>{t('common.remove')}</button>
											)}
										</div>
									))}
								</div>

								{editingId && (
									<div className="full image-upload-section">
										<label className="setting-label">{t('form.medicationImage')}</label>
										{(() => {
											const currentMed = meds.find(m => m.id === editingId);
											if (currentMed?.imageUrl) {
												return (
													<div className="image-preview">
														<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
														<button type="button" className="ghost danger" onClick={() => deleteMedImage(editingId)}>{t('form.removeImage')}</button>
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
										})()}
									</div>
								)}

								<div className="full align-end gap">
									{editingId && (
										<button type="button" className="ghost" onClick={resetForm}>
											{t('common.cancel')}
										</button>
									)}
									<button type="submit" disabled={saving}>{saving ? t('common.saving') : t('common.save')}</button>
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
								<span className="pill neutral">{t('planner.badge')}</span>
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
													<span data-label={t('planner.table.usage')}><strong>{row.plannerUsage}</strong> {t('common.pills')}</span>
													<span data-label={t('planner.table.blisters')}>{row.stripsNeeded} × {row.stripSize}</span>
													<span data-label={t('planner.table.available')}>{row.stripsAvailable} {t('common.blisters')}</span>
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
													<label className="toggle-switch small">
														<input
															type="checkbox"
															checked={settings.emailStockReminders}
															onChange={(e) => setSettings({ ...settings, emailStockReminders: e.target.checked })}
															disabled={!settings.emailEnabled}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
												<div className="matrix-cell">
													<label className="toggle-switch small">
														<input
															type="checkbox"
															checked={settings.shoutrrrStockReminders}
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
													<label className="toggle-switch small">
														<input
															type="checkbox"
															checked={settings.emailIntakeReminders}
															onChange={(e) => setSettings({ ...settings, emailIntakeReminders: e.target.checked })}
															disabled={!settings.emailEnabled}
														/>
														<span className="toggle-slider"></span>
													</label>
												</div>
												<div className="matrix-cell">
													<label className="toggle-switch small">
														<input
															type="checkbox"
															checked={settings.shoutrrrIntakeReminders}
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
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>{t('settings.notifications.email')}</h3>
											<label className="toggle-switch small">
												<input
													type="checkbox"
													checked={settings.emailEnabled}
													onChange={(e) => setSettings({ ...settings, emailEnabled: e.target.checked })}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
										{settings.emailEnabled && (
											<>
												<div className="setting-group">
													<label className="full">
														<span className="field-label">{t('settings.email.recipient')}</span>
														<input
															type="email"
															value={settings.notificationEmail}
															onChange={(e) => setSettings({ ...settings, notificationEmail: e.target.value })}
															placeholder="your@email.com"
															pattern="[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$"
															autoComplete="email"
														/>
													</label>
												</div>
												<div className="smtp-info">
													<span className="smtp-summary">
														SMTP: {settings.smtpHost || t('settings.email.notConfigured')}:{settings.smtpPort}
														{settings.hasSmtpPassword && " ✓"}
													</span>
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
													onChange={(e) => setSettings({ ...settings, shoutrrrEnabled: e.target.checked })}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
										{settings.shoutrrrEnabled && (
											<>
												<div className="setting-group">
													<label className="full">
														<span className="field-label">{t('settings.push.url')}</span>
														<input
															type="url"
															value={settings.shoutrrrUrl}
															onChange={(e) => setSettings({ ...settings, shoutrrrUrl: e.target.value })}
															placeholder="https://ntfy.sh/your-topic"
														/>
													</label>
												</div>
												<div className="smtp-info">
													<span className="smtp-summary">
														{t('settings.push.supports')}
													</span>
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

								<div className="form-footer">
									<button type="submit" disabled={settingsSaving || (!settingsChanged && settingsSaved)}>
										{settingsSaving ? t('common.saving') : settingsSaved && !settingsChanged ? t('common.saved') : t('settings.saveSettings')}
									</button>
								</div>
							</form>
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
										localStorage.setItem("scheduleDays", String(val));
									}}
								>
									<option value={30}>{t('dashboard.schedules.1month')}</option>
									<option value={90}>{t('dashboard.schedules.3months')}</option>
									<option value={180}>{t('dashboard.schedules.6months')}</option>
								</select>
							</div>
							<div className="timeline">
								{groupedSchedule.map((day) => (
									<div key={day.dateStr} className="day-block">
										<div className="day-divider">{day.dateStr}</div>
										{day.meds.map((item) => {
											const medCoverage = coverageByMed[item.medName];
											const med = meds.find(m => m.name === item.medName);
											const depletionTime = depletionByMed[item.medName];
											// Check if this dose is scheduled after medication runs out
											const willBeOutOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
											const status = willBeOutOfStock 
												? { className: "danger", label: "status.outOfStock" }
												: medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
											const allTaken = item.doses.every((d) => takenDoses.has(d.id));
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
															const isTaken = takenDoses.has(dose.id);
															const isOverdue = !isTaken && dose.when < Date.now();
															return (
																<div key={dose.id} className={`dose-item ${isTaken ? "taken" : ""} ${isOverdue ? "overdue" : ""}`}>
																	<span className="dose-time">{dose.timeStr}</span>
																	<span className="dose-usage">{dose.usage} {dose.usage !== 1 ? t('common.pills') : t('common.pill')}{med?.pillWeightMg && ` (${dose.usage * med.pillWeightMg} mg)`}{med?.takenBy && <span className="taken-by-inline"> {t('dose.takenBy')} <span className="taken-by-name clickable" onClick={() => setSelectedUser(med.takenBy!)}>{med.takenBy}</span></span>}</span>
																	{isTaken ? (
																		<button className="dose-btn undo" onClick={() => undoDoseTaken(dose.id)} title={t('common.undo')}>↩</button>
																	) : (
																		<button className="dose-btn take" onClick={() => markDoseTaken(dose.id)} title={t('dose.markAsTaken')}>✓</button>
																	)}
																</div>
															);
														})}
													</div>
												</div>
											);
										})}
									</div>
								))}
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
								{selectedMed.takenBy && <span className="med-taken-by">{t('modal.for')} {selectedMed.takenBy}</span>}
							</div>
						</div>

						<div className="med-detail-body">
							<div className="med-detail-section">
								<h3>{t('modal.stockInfo')}</h3>
								{(() => {
									const medCoverage = coverage.all.find(c => c.name === selectedMed.name);
									const currentStock = medCoverage ? medCoverage.medsLeft : selectedMed.count;
									const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
									const textClass = status?.className === "danger" ? "danger-text" : status?.className === "warning" ? "warning-text" : "";
									return (
								<div className="med-detail-grid">
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.currentStock')}</span>
										<span className={`med-detail-value ${textClass}`}>{formatNumber(currentStock)}/{formatNumber(selectedMed.count)}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.packs')}</span>
										<span className="med-detail-value">{selectedMed.packCount ?? 0}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.blistersPerPack')}</span>
										<span className="med-detail-value">{selectedMed.stripsPerPack ?? 0}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.pillsPerBlister')}</span>
										<span className="med-detail-value">{selectedMed.tabsPerStrip ?? 1}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.loosePills')}</span>
										<span className="med-detail-value">{selectedMed.looseTablets ?? 0}</span>
									</div>
									{selectedMed.pillWeightMg && (
										<div className="med-detail-item">
											<span className="med-detail-label">{t('modal.pillWeight')}</span>
											<span className="med-detail-value">{selectedMed.pillWeightMg} mg</span>
										</div>
									)}
									<div className="med-detail-item">
										<span className="med-detail-label">{t('modal.expiryDate')}</span>
										<span className={`med-detail-value ${selectedMed.expiryDate && new Date(selectedMed.expiryDate) < new Date() ? 'danger-text' : ''}`}>
											{selectedMed.expiryDate ? new Date(selectedMed.expiryDate).toLocaleDateString(i18n.language, { day: "2-digit", month: "short", year: "numeric" }) : "—"}
										</span>
									</div>
								</div>
									);
								})()}
						</div>

							{selectedMed.slices.length > 0 && (
								<div className="med-detail-section">
									<h3>{t('modal.intakeSchedule')} {selectedMed.intakeRemindersEnabled && <span className="reminder-icon info-tooltip" data-tooltip={t('tooltips.intakeReminders')}>🔔</span>}</h3>
									<div className="med-detail-schedules">
										{selectedMed.slices.map((slice, idx) => (
											<div key={idx} className="med-schedule-item">
												<span className="med-schedule-usage">{slice.usage} {slice.usage !== 1 ? t('common.pills') : t('common.pill')}{selectedMed.pillWeightMg && ` (${slice.usage * selectedMed.pillWeightMg} mg)`}</span>
												<span className="med-schedule-freq">{t('form.slices.every')} {slice.every} {slice.every !== 1 ? t('common.days') : t('common.day')}</span>
												<span className="med-schedule-time">{t('modal.at')} {new Date(slice.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
											</div>
										))}
									</div>
								</div>
							)}

							{(() => {
								const medCoverage = coverage.all.find(c => c.name === selectedMed.name);
								if (!medCoverage) return null;
								const status = getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings);
								return (
									<div className="med-detail-section">
										<h3>{t('modal.coverageStatus')}</h3>
										<div className="med-detail-grid">
											<div className="med-detail-item">
												<span className="med-detail-label">{t('modal.daysLeft')}</span>
												<span className="med-detail-value">{medCoverage.daysLeft !== null ? formatNumber(medCoverage.daysLeft) : "—"}</span>
											</div>
											<div className="med-detail-item">
												<span className="med-detail-label">{t('modal.runsOut')}</span>
												<span className="med-detail-value">{medCoverage.depletionDate ?? "—"}</span>
											</div>
											<div className="med-detail-item full-width">
												<span className="med-detail-label">{t('table.status')}</span>
												<span className={`status-chip ${status.className}`}>{t(status.label)}</span>
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
							<button className="ghost" onClick={() => { setSelectedMed(null); setShowImageLightbox(false); }}>
								{t('common.close')}
							</button>
							{selectedMed.slices.length > 0 && (
								<button className="ghost" onClick={() => generateICS(selectedMed)} title={t('modal.exportTooltip')}>
									📅 {t('modal.exportCalendar')}
								</button>
							)}
							<button className="ghost" onClick={() => { setSelectedMed(null); setShowImageLightbox(false); navigate("/medications"); startEdit(selectedMed); }}>
								{t('modal.editMedication')}
							</button>
						</div>
					</div>

					{/* Image Lightbox */}
					{showImageLightbox && selectedMed.imageUrl && (
						<div className="lightbox-overlay" onClick={() => setShowImageLightbox(false)}>
							<button className="lightbox-close" onClick={() => setShowImageLightbox(false)}>×</button>
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
							{meds.filter(m => m.takenBy === selectedUser).map((med) => {
								const medCoverage = coverage.all.find(c => c.name === med.name);
								const status = medCoverage ? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings) : null;
								const currentStock = medCoverage ? formatNumber(medCoverage.medsLeft) : formatNumber(med.count);
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
											<span className="user-med-pills">{currentStock}/{formatNumber(med.count)} {t('common.pills')}</span>
											{status && <span className={`status-chip ${status.className}`}>{t(status.label)}</span>}
										</div>
									</div>
								);
							})}
							{meds.filter(m => m.takenBy === selectedUser).length === 0 && (
								<div className="user-meds-empty">{t('modal.noMedsForUser', { name: selectedUser })}</div>
							)}
						</div>

						<div className="user-meds-footer">
							<button className="ghost" onClick={() => setSelectedUser(null)}>{t('common.close')}</button>
						</div>
					</div>
				</div>
			)}
		</main>
	);
}

function deriveTotal(form: FormState) {
	const packCount = Number(form.packCount) || 0;
	const stripsPerPack = Number(form.stripsPerPack) || 0;
	const tabsPerStrip = Number(form.tabsPerStrip) || 1;
	const looseTablets = Number(form.looseTablets) || 0;
	return packCount * stripsPerPack * tabsPerStrip + looseTablets;
}

function toIsoString(value: string) {
	if (!value) return new Date().toISOString();
	// datetime-local input gives us local time without timezone info
	// We need to treat it as local time and convert to ISO
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toInputValue(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		// Return current local time in datetime-local format
		const now = new Date();
		const year = now.getFullYear();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		return `${year}-${month}-${day}T${hours}:${minutes}`;
	}
	// Convert to local time format for datetime-local input
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${year}-${month}-${day}T${hours}:${minutes}`;
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
	
	const events = med.slices.map((slice, idx) => {
		const start = new Date(slice.start);
		const end = new Date(start.getTime() + 15 * 60 * 1000); // 15 min duration
		const interval = slice.every;
		
		const pillInfo = `${slice.usage} pill${slice.usage !== 1 ? 's' : ''}${med.pillWeightMg ? ` (${slice.usage * med.pillWeightMg} mg)` : ''}`;
		const summary = `💊 ${med.name} - ${pillInfo}`;
		const description = [
			`Medication: ${med.name}`,
			med.genericName ? `Generic: ${med.genericName}` : '',
			med.takenBy ? `For: ${med.takenBy}` : '',
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

function buildSchedulePreview(meds: Medication[], locale: string) {
	const events: Array<{ id: string; medName: string; timeStr: string; dateStr: string; usage: number; when: number }> = [];
	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Midnight today
	const end = new Date();
	end.setDate(end.getDate() + 180); // 6 months horizon

	meds.forEach((med) => {
		med.slices.forEach((slice, idx) => {
			const start = new Date(slice.start);
			if (Number.isNaN(start.getTime())) return;
			for (let d = new Date(start); d <= end; d.setDate(d.getDate() + slice.every)) {
				// Include all doses from today onwards (even past ones from today)
				if (d < todayStart) continue;
				const whenMs = d.getTime();
				events.push({
					id: `${med.id}-${idx}-${whenMs}`,
					medName: med.name,
					usage: slice.usage,
					when: whenMs,
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

	return { events, today: todayCount, nextThree: events.length, totalSlices: meds.reduce((acc, m) => acc + m.slices.length, 0) };
}

function formatNumber(value: number | null) {
	if (value === null || Number.isNaN(value)) return "-";
	if (Math.abs(value % 1) < 0.05) return Math.round(value).toLocaleString();
	return value.toFixed(1);
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

function calculateCoverage(meds: Medication[], events: Array<{ medName: string; when: number }>, locale: string, reminderDaysBefore: number) {
	const MS_PER_DAY = 86_400_000;
	const now = Date.now();

	const coverage: Coverage[] = meds.map((m) => {
		const dailyRate = m.slices.reduce((sum, s) => sum + (s.every > 0 ? s.usage / s.every : 0), 0);

		let consumed = 0;
		m.slices.forEach((s) => {
			const start = new Date(s.start).getTime();
			if (Number.isNaN(start) || start > now) return;
			const period = Math.max(1, s.every) * MS_PER_DAY;
			const occurrences = Math.floor((now - start) / period) + 1; // include today if started
			consumed += occurrences * s.usage;
		});

		const medsLeft = Math.max(0, m.count - consumed);
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
	lowStock: Coverage[], 
	lastSent: string | null, 
	lastType: "stock" | "intake" | null,
	lastChannel: "email" | "push" | "both" | null,
	t: (key: string, options?: Record<string, unknown>) => string, 
	locale: string
): React.ReactNode {
	// Find the earliest medication that needs a reminder (based on reminderDaysBefore)
	const medsNeedingReminder = lowStock
		.filter((c) => c.depletionTime !== null && c.daysLeft !== null && c.daysLeft <= reminderDaysBefore)
		.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

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

	if (medsNeedingReminder.length > 0) {
		// There are medications that need reminders
		if (lastSent) {
			return (
				<>
					<strong className="warning-text">⚠ {t('dashboard.reminders.needReorder', { count: medsNeedingReminder.length })}</strong>
					{" · "}{t('dashboard.reminders.lastReminder')}: {formatLastInfo(lastSent)}
				</>
			);
		}
		return <strong className="warning-text">⚠ {t('dashboard.reminders.needReorder', { count: medsNeedingReminder.length })} — {t('dashboard.reminders.waitingFirstCheck')}</strong>;
	}

	// Calculate when next reminder would be triggered
	const allWithDepletion = lowStock
		.filter((c) => c.depletionTime !== null && c.daysLeft !== null)
		.sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));

	if (allWithDepletion.length > 0) {
		const nextMed = allWithDepletion[0];
		const daysUntilReminder = (nextMed.daysLeft ?? 0) - reminderDaysBefore;
		if (daysUntilReminder > 0) {
			return (
				<>
					<span className="success-text">✓ {t('dashboard.reminders.allOk')}</span>
					{" · "}{t('dashboard.reminders.nextIn')}: <strong>{nextMed.name}</strong> {t('dashboard.reminders.inDays', { days: daysUntilReminder })}
				</>
			);
		}
	}

	// No low stock medications at all
	if (lastSent) {
		return (
			<>
				<span className="success-text">✓ {t('dashboard.reminders.allStockOk')}</span>
				{" · "}{t('dashboard.reminders.lastReminder')}: {formatLastInfo(lastSent)}
			</>
		);
	}
	return <span className="success-text">✓ {t('dashboard.reminders.allStockOk')} — {t('dashboard.reminders.noRemindersNeeded')}</span>;
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
