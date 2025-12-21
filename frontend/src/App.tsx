import { useEffect, useMemo, useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";

type Slice = {
	usage: number;
	every: number;
	start: string;
};

type Medication = {
	id: number;
	name: string;
	genericName?: string | null;
	count: number;
	strips: number;
	stripSize: number;
	packCount?: number;
	stripsPerPack?: number;
	tabsPerStrip?: number;
	looseTablets?: number;
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
	packCount: string;
	stripsPerPack: string;
	tabsPerStrip: string;
	looseTablets: string;
	expiryDate: string;
	notes: string;
	intakeRemindersEnabled: boolean;
	slices: FormSlice[];
};

const defaultSlice = (): FormSlice => ({ usage: "1", every: "1", start: toInputValue(new Date().toISOString()) });

const defaultForm = (): FormState => ({ name: "", genericName: "", packCount: "1", stripsPerPack: "1", tabsPerStrip: "1", looseTablets: "0", expiryDate: "", notes: "", intakeRemindersEnabled: false, slices: [defaultSlice()] });

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
	const [meds, setMeds] = useState<Medication[]>([]);
	const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
	const [plannerLoading, setPlannerLoading] = useState(false);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [editingId, setEditingId] = useState<number | null>(null);
	const [form, setForm] = useState<FormState>(defaultForm());
	const [range, setRange] = useState<{ start: string; end: string }>({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });

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
		// Shoutrrr/ntfy settings
		shoutrrrEnabled: false,
		shoutrrrUrl: "",
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
				} else if (selectedMed) {
					setSelectedMed(null);
				}
			}
		};
		document.addEventListener("keydown", handleEscape);
		return () => document.removeEventListener("keydown", handleEscape);
	}, [selectedMed, showImageLightbox]);

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

	const schedule = useMemo(() => buildSchedulePreview(meds), [meds]);
	const totalTablets = useMemo(() => deriveTotal(form), [form]);
	const coverage = useMemo(() => calculateCoverage(meds, schedule.events), [meds, schedule.events]);
	const depletionByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c.depletionTime])), [coverage.all]);
	const groupedSchedule = useMemo(() => {
		type DoseInfo = { id: string; timeStr: string; when: number; usage: number };
		const days = new Map<string, { dateStr: string; meds: Map<string, { medName: string; total: number; doses: DoseInfo[]; lastWhen: number }> }>();
		schedule.events.slice(0, 200).forEach((event) => {
			const day = days.get(event.dateStr) ?? { dateStr: event.dateStr, meds: new Map() };
			const medEntry = day.meds.get(event.medName) ?? { medName: event.medName, total: 0, doses: [], lastWhen: event.when };
			medEntry.total += event.usage;
			medEntry.doses.push({ id: event.id, timeStr: event.timeStr, when: event.when, usage: event.usage });
			medEntry.lastWhen = Math.max(medEntry.lastWhen, event.when);
			day.meds.set(event.medName, medEntry);
			days.set(event.dateStr, day);
		});
		return Array.from(days.values()).map((d) => ({ dateStr: d.dateStr, meds: Array.from(d.meds.values()) }));
	}, [schedule.events]);

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
			packCount: String(med.packCount ?? 1),
			stripsPerPack: String(med.stripsPerPack ?? med.strips ?? 1),
			tabsPerStrip: String(med.tabsPerStrip ?? med.stripSize ?? 1),
			looseTablets: String(med.looseTablets ?? 0),
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
			packCount: Number(form.packCount) || 0,
			stripsPerPack: Math.max(1, Number(form.stripsPerPack) || 1),
			tabsPerStrip: Math.max(1, Number(form.tabsPerStrip) || 1),
			looseTablets: Math.max(0, Number(form.looseTablets) || 0),
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
	}

	function resetRange() {
		setRange({ start: toInputValue(todayIso()), end: toInputValue(plusDaysIso(3)) });
		setPlannerRows([]);
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
		"/dashboard": { eyebrow: "MedAssist · Overview", title: "Dashboard" },
		"/medications": { eyebrow: "MedAssist · Inventory", title: "Manage Medications" },
		"/planner": { eyebrow: "MedAssist · Planner", title: "Demand Calculator" },
		"/settings": { eyebrow: "MedAssist · Configuration", title: "Settings" },
	}[currentPath] || { eyebrow: "MedAssist · Overview", title: "Dashboard" };

	return (
		<main className="page">
			<header className="hero">
				<div className="hero-title">
					<img src="/favicon.svg" alt="MedAssist" className="hero-logo" />
					<div>
						<p className="eyebrow">{pageInfo.eyebrow}</p>
						<h1>{pageInfo.title}</h1>
					</div>
				</div>
				<div className="header-actions">
					<div className="tabs">
						<button className={currentPath === "/dashboard" || currentPath === "/" ? "pill primary" : "pill"} onClick={() => navigate("/dashboard")}>Dashboard</button>
						<button className={currentPath === "/medications" ? "pill primary" : "pill"} onClick={() => navigate("/medications")}>Medications</button>
						<button className={currentPath === "/planner" ? "pill primary" : "pill"} onClick={() => navigate("/planner")}>Planner</button>
					</div>
					<button className={`icon-btn ${currentPath === "/settings" ? "active" : ""}`} onClick={() => navigate("/settings")} title="Settings">⚙️</button>
					<button className="icon-btn" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
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
									Automatic reminders active — {getReminderStatusText(settings.reminderDaysBefore, coverage.low, settings.lastAutoEmailSent)}
								</span>
								{settings.emailEnabled && settings.notificationEmail && <span className="email-status-recipient">→ {settings.notificationEmail}</span>}
							</section>
						)}
						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>Reorder Reminder</h2>
									<span className="pill neutral">Stock watch</span>
								</div>
								{meds.length === 0 ? (
									<p className="muted">No medications configured yet.</p>
								) : coverage.low.length === 0 ? (
									<p className="success-text">All good, enough stock.</p>
								) : (
									<>
										<div className="table table-6">
											<div className="table-head">
												<span>Name</span>
												<span>Current pills</span>
												<span>Days left</span>
												<span>Status</span>
												<span>Runs out</span>
												<span>Auto-remind</span>
											</div>
											{coverage.low.map((row) => {
												const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
												const med = meds.find(m => m.name === row.name);
												return (
													<div key={row.name} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
														<span data-label="Name" className="cell-with-avatar"><MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />{row.name}{med?.notes && <span className="notes-icon" title="Has notes">📝</span>}</span>
														<span data-label="Pills" className={row.medsLeft <= 0 ? "danger-text" : ""}>{formatNumber(row.medsLeft)}</span>
														<span data-label="Days" className={status.className === "danger" ? "danger-text" : status.className === "warning" ? "warning-text" : ""}>{formatNumber(row.daysLeft)}</span>
														<span data-label="Status" className={`status-chip ${status.className}`}>{status.label}</span>
														<span data-label="Runs out">{row.depletionDate ?? "-"}</span>
														<span data-label="Auto-remind" className="next-reminder-date">{getNextReminderForMed(row, settings.reminderDaysBefore)}</span>
													</div>
												);
											})}
										</div>
										{(settings.emailEnabled || settings.shoutrrrEnabled) && (
											<div className="email-send-action">
												<button type="button" className="ghost" onClick={sendReminderEmail} disabled={sendingReminderEmail}>
													{sendingReminderEmail ? "Sending..." : "🔔 Send Reminder Now"}
												</button>
												{reminderEmailResult && (
													<span className={reminderEmailResult.success ? "success-text" : "danger-text"}>
														{reminderEmailResult.message}
													</span>
												)}
											</div>
										)}
									</>
								)}
							</article>
						</section>

						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>Medication Overview</h2>
									<span className="pill neutral">Stock</span>
								</div>
								<div className="table table-6">
									<div className="table-head">
										<span>Name</span>
										<span>Current pills</span>
										<span>Days left</span>
										<span>Runs out</span>
										<span>Expiry</span>
										<span>Status</span>
									</div>
									{coverage.all.map((row) => {
										const status = getStockStatus(row.daysLeft, row.medsLeft, settings);
										const med = meds.find(m => m.name === row.name);
										const expiryClass = getExpiryClass(med?.expiryDate);
										return (
											<div key={row.name} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
												<span data-label="Name" className="cell-with-avatar"><MedicationAvatar name={row.name} imageUrl={med?.imageUrl} />{row.name}{med?.notes && <span className="notes-icon" title="Has notes">📝</span>}</span>
												<span data-label="Pills" className={row.medsLeft <= 0 ? "danger-text" : ""}>{formatNumber(row.medsLeft)}</span>
												<span data-label="Days left" className={status.className === "danger" ? "danger-text" : status.className === "warning" ? "warning-text" : ""}>{formatNumber(row.daysLeft)}</span>
												<span data-label="Runs out">{row.depletionDate ?? "-"}</span>
												<span data-label="Expiry" className={expiryClass}>{med?.expiryDate ? new Date(med.expiryDate).toLocaleDateString([], { day: "2-digit", month: "short", year: "2-digit" }) : "-"}</span>
												<span data-label="Status" className={`status-chip ${status.className}`}>{status.label}</span>
											</div>
										);
									})}
								</div>
							</article>
						</section>

						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>Upcoming Schedules</h2>
									<span className="pill neutral">Next 10 days</span>
								</div>
								<div className="timeline">
									{groupedSchedule.map((day) => (
										<div key={day.dateStr} className="day-block">
											<div className="day-divider">{day.dateStr}</div>
											{day.meds.map((item) => {
												const depletionTime = depletionByMed[item.medName];
												const outOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
												const med = meds.find(m => m.name === item.medName);
												const allTaken = item.doses.every((d) => takenDoses.has(d.id));
												const takenCount = item.doses.filter((d) => takenDoses.has(d.id)).length;
												return (
													<div key={`${day.dateStr}-${item.medName}`} className={`time-row ${allTaken ? "taken" : ""}`}>
														<div className="time-main">
															<div className="med-name"><MedicationAvatar name={item.medName} imageUrl={med?.imageUrl} size="sm" />{item.medName}</div>
															<div className="tag-row">
																<span className="tag subtle">{item.total} pills total</span>
																<span className={`tag ${outOfStock ? "danger" : "success"}`}>
																	{outOfStock ? "⚠ No pills left" : "✓ Stock OK"}
																</span>
															</div>
														</div>
														<div className="doses-col">
															{item.doses.map((dose) => {
																const isTaken = takenDoses.has(dose.id);
																return (
																	<div key={dose.id} className={`dose-item ${isTaken ? "taken" : ""}`}>
																		<span className="dose-time">{dose.timeStr}</span>
																		<span className="dose-usage">{dose.usage} pill{dose.usage !== 1 ? "s" : ""}</span>
																		{isTaken ? (
																			<button className="dose-btn undo" onClick={() => undoDoseTaken(dose.id)} title="Undo">↩</button>
																		) : (
																			<button className="dose-btn take" onClick={() => markDoseTaken(dose.id)} title="Mark as taken">✓</button>
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
								<h2>Medication list</h2>
								<span className="pill neutral">{loading ? "Loading..." : `${meds.length} entries`}</span>
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
													<span>Packs: <strong>{med.packCount ?? 1}</strong></span>
													<span>Blisters per pack: <strong>{med.stripsPerPack ?? med.strips ?? 1}</strong></span>
													<span>Pills per blister: <strong>{med.tabsPerStrip ?? med.stripSize}</strong></span>
													<span>Loose: <strong>{med.looseTablets ?? 0}</strong></span>
												</div>
												<div className="med-total">Total: {med.count} pills</div>
											</div>
											<div className="med-actions">
												<button className="ghost" onClick={() => startEdit(med)}>Edit</button>
												<button className="ghost danger" onClick={() => deleteMed(med.id)}>Delete</button>
											</div>
										</div>
										<div className="slice-list">
											{med.slices.map((s, idx) => (
												<div key={`${med.id}-${idx}`} className="slice-row-simple">
													{s.usage} {s.usage === 1 ? "pill" : "pills"} · every {s.every} {s.every === 1 ? "day" : "days"} · from {formatDateTime(s.start)}
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</article>

						<article className="card form">
							<div className="card-head">
								<h2>{editingId ? "Edit entry" : "New entry"}</h2>
								<span className="pill">Packs + loose pills</span>
							</div>
							<form className="form-grid" onSubmit={saveMedication}>
								<label>
									Commercial Name
									<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ozempic" required />
								</label>
								<label>
									Generic Name
									<input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} placeholder="e.g. Semaglutide (optional)" />
								</label>
								<label>
									Packs
									<input type="number" min="0" value={form.packCount} onChange={(e) => handleValueChange("packCount", e.target.value)} />
								</label>
								<label>
									Blisters per pack
									<input type="number" min="1" value={form.stripsPerPack} onChange={(e) => handleValueChange("stripsPerPack", e.target.value)} />
								</label>
								<label>
									Pills per blister
									<input type="number" min="1" value={form.tabsPerStrip} onChange={(e) => handleValueChange("tabsPerStrip", e.target.value)} />
								</label>
								<label>
									Loose pills
									<input type="number" min="0" value={form.looseTablets} onChange={(e) => handleValueChange("looseTablets", e.target.value)} />
								</label>
								<label>
									Total (pills)
									<div className="static-value">{formatNumber(totalTablets)}</div>
								</label>
								<label>
									Expiry Date
									<input type="date" value={form.expiryDate} onChange={(e) => handleValueChange("expiryDate", e.target.value)} placeholder="optional" />
								</label>

								<label className="full">
									Notes
									<textarea 
										value={form.notes} 
										onChange={(e) => handleValueChange("notes", e.target.value)} 
										placeholder="e.g. Take with food, avoid alcohol... (optional)"
										rows={2}
										maxLength={500}
									/>
								</label>

								<div className="full slices">
									<div className="card-head">
										<h3>Intake schedule</h3>
										<div className="slices-actions">
											<label className="inline-checkbox" title="Receive a notification 15 minutes before each scheduled intake">
												<input 
													type="checkbox" 
													checked={form.intakeRemindersEnabled} 
													onChange={(e) => setForm(prev => ({ ...prev, intakeRemindersEnabled: e.target.checked }))}
												/>
												<span>🔔 Remind</span>
											</label>
											<button type="button" className="ghost" onClick={addSlice}>+ Intake</button>
										</div>
									</div>
									{form.slices.map((s, idx) => (
										<div key={idx} className="slice-row">
											<div className="slice-inputs">
												<label>
													Usage (pills)
													<input type="number" min="0" step="0.1" value={s.usage} onChange={(e) => setSliceValue(idx, "usage", e.target.value)} />
												</label>
												<label>
													Every (days)
													<input type="number" min="1" value={s.every} onChange={(e) => setSliceValue(idx, "every", e.target.value)} />
												</label>
												<label>
													Start (date/time)
													<input type="datetime-local" step="60" value={s.start} onChange={(e) => setSliceValue(idx, "start", e.target.value)} />
												</label>
											</div>
											{form.slices.length > 1 && (
												<button type="button" className="ghost" onClick={() => removeSlice(idx)}>Remove</button>
											)}
										</div>
									))}
								</div>

								{editingId && (
									<div className="full image-upload-section">
										<label className="setting-label">Medication Image</label>
										{(() => {
											const currentMed = meds.find(m => m.id === editingId);
											if (currentMed?.imageUrl) {
												return (
													<div className="image-preview">
														<img src={`/api/images/${currentMed.imageUrl}`} alt={currentMed.name} />
														<button type="button" className="ghost danger" onClick={() => deleteMedImage(editingId)}>Remove Image</button>
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
											Cancel
										</button>
									)}
									<button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
								</div>
							</form>
						</article>
					</section>
				} />

				<Route path="/planner" element={
					<section className="grid">
						<article className="card">
							<div className="card-head">
								<h2>Demand Calculator</h2>
								<span className="pill neutral">Plan your supply</span>
							</div>
							<form className="planner" onSubmit={runPlanner}>
								<label>
									From
									<input type="datetime-local" step="60" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} />
								</label>
								<label>
									Until
									<input type="datetime-local" step="60" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} />
								</label>
								<div className="planner-actions">
									<button type="button" className="ghost" onClick={resetRange}>Reset</button>
									<button type="submit" disabled={plannerLoading}>{plannerLoading ? "Calculating..." : "Calculate"}</button>
								</div>
							</form>
							{plannerRows.length > 0 && (
								<>
									<div className="table">
										<div className="table-head">
											<span>Medication</span>
											<span>Usage</span>
											<span>Blisters needed</span>
											<span>Available</span>
											<span>Status</span>
										</div>
										{plannerRows.map((row) => {
											const med = meds.find(m => m.name === row.medicationName);
											return (
												<div key={row.medicationId} className="table-row clickable" onClick={() => med && setSelectedMed(med)}>
													<span data-label="Medication" className="cell-with-avatar"><MedicationAvatar name={row.medicationName} imageUrl={med?.imageUrl} />{row.medicationName}</span>
													<span data-label="Usage"><strong>{row.plannerUsage}</strong> pills</span>
													<span data-label="Blisters">{row.stripsNeeded} × {row.stripSize}</span>
													<span data-label="Available">{row.stripsAvailable} blisters</span>
													<span data-label="Status" className={row.enough ? "status-chip success" : "status-chip danger"}>{row.enough ? "✓ Enough" : "⚠ Out of Stock"}</span>
												</div>
											);
										})}
									</div>
									{settings.emailEnabled && settings.notificationEmail && (
										<div className="planner-email-action">
											<button type="button" className="ghost" onClick={sendPlannerEmail} disabled={sendingPlannerEmail}>
												{sendingPlannerEmail ? "Sending..." : "📧 Send via Email"}
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
						<article className="card">
							<div className="card-head">
								<h2>Automatic Reminders</h2>
								<span className="pill neutral">Daily at 6:00 AM</span>
							</div>
							{settingsLoading ? (
								<p>Loading settings...</p>
							) : (
								<form className="settings-form" onSubmit={saveSettings}>
									<div className="channels-overview">
										<div className="channels-status">
											<button
												type="button"
												className={`channel-btn ${settings.emailEnabled ? "active" : ""}`}
												onClick={async () => {
													const newSettings = { ...settings, emailEnabled: !settings.emailEnabled };
													setSettings(newSettings);
													try {
														await fetch("/api/settings/notifications", {
															method: "PUT",
															headers: { "Content-Type": "application/json" },
															body: JSON.stringify(newSettings),
														});
													} catch (e) { console.error(e); }
												}}
											>
												<span className="channel-icon">📧</span>
												<span className="channel-name">Email</span>
												<span className={`channel-status ${settings.emailEnabled ? "on" : "off"}`}>
													{settings.emailEnabled ? "ON" : "OFF"}
												</span>
											</button>
											<button
												type="button"
												className={`channel-btn ${settings.shoutrrrEnabled ? "active" : ""}`}
												onClick={async () => {
													const newSettings = { ...settings, shoutrrrEnabled: !settings.shoutrrrEnabled };
													setSettings(newSettings);
													try {
														await fetch("/api/settings/notifications", {
															method: "PUT",
															headers: { "Content-Type": "application/json" },
															body: JSON.stringify(newSettings),
														});
													} catch (e) { console.error(e); }
												}}
											>
												<span className="channel-icon">🔔</span>
												<span className="channel-name">Push</span>
												<span className={`channel-status ${settings.shoutrrrEnabled ? "on" : "off"}`}>
													{settings.shoutrrrEnabled ? "ON" : "OFF"}
												</span>
											</button>
										</div>
										<div className="schedule-info">
											<div className="schedule-row">
												<span className="schedule-label">Next check</span>
												<span className="schedule-value">{settings.nextScheduledCheck ? new Date(settings.nextScheduledCheck).toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</span>
											</div>
											{settings.lastAutoEmailSent && (
												<div className="schedule-row">
													<span className="schedule-label">Last sent</span>
													<span className="schedule-value">{new Date(settings.lastAutoEmailSent).toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
												</div>
											)}
										</div>
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>📊 Stock Display</h3>
										</div>
										<div className="setting-group">
											<label>
												<span className="field-label">Low Stock (days)</span>
												<div className="input-with-tooltip">
													<input
														type="number"
														min="1"
														max="365"
														value={settings.lowStockDays}
														onChange={(e) => setSettings({ ...settings, lowStockDays: Number(e.target.value) || 30 })}
													/>
													<span className="info-tooltip" data-tooltip="Yellow warning color when supply is below this threshold. Only affects display, not reminders.">ⓘ</span>
												</div>
											</label>
											<label>
												<span className="field-label">High Stock (days)</span>
												<div className="input-with-tooltip">
													<input
														type="number"
														min="1"
														max="730"
														value={settings.highStockDays}
														onChange={(e) => setSettings({ ...settings, highStockDays: Number(e.target.value) || 180 })}
													/>
													<span className="info-tooltip" data-tooltip="Green with star when supply is above this threshold. Only affects display, not reminders.">ⓘ</span>
												</div>
											</label>
										</div>
									</div>

									<div className="setting-section">
										<div className="section-header">
											<h3>⚙️ Reminder Threshold</h3>
											<span className="info-tooltip" data-tooltip="Applies to both Email and Push notifications. When a medication's remaining supply falls below this threshold, you'll receive a notification.">ⓘ</span>
										</div>
										<div className="threshold-input">
											<label>
												<span className="threshold-label">Send reminder when supply drops below</span>
												<div className="threshold-field">
													<input
														type="number"
														min="1"
														max="90"
														value={settings.reminderDaysBefore}
														onChange={(e) => setSettings({ ...settings, reminderDaysBefore: Number(e.target.value) || 7 })}
													/>
													<span className="threshold-unit">days</span>
												</div>
											</label>
										</div>
										<div className="setting-row compact">
											<label className="setting-label">
												Repeat daily
												<span className="info-tooltip small" data-tooltip="When enabled, sends reminders every day while stock is low. Otherwise, only notifies once per medication until restocked.">ⓘ</span>
											</label>
											<label className="toggle-switch small">
												<input
													type="checkbox"
													checked={settings.repeatDailyReminders}
													onChange={(e) => setSettings({ ...settings, repeatDailyReminders: e.target.checked })}
												/>
												<span className="toggle-slider"></span>
											</label>
										</div>
									</div>

									{settings.emailEnabled && (
										<div className="setting-section">
											<div className="section-header">
												<h3>📧 Email Settings</h3>
											</div>
											<div className="setting-group">
												<label className="full">
													<span className="field-label">Recipient</span>
													<input
														type="email"
														value={settings.notificationEmail}
														onChange={(e) => setSettings({ ...settings, notificationEmail: e.target.value })}
														placeholder="your@email.com"
														pattern="[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$"
														required
														autoComplete="email"
													/>
												</label>
											</div>
											<div className="smtp-info">
												<span className="smtp-summary">
													SMTP: {settings.smtpHost || "Not configured"}:{settings.smtpPort}
													{settings.hasSmtpPassword && " ✓"}
												</span>
												<span className="info-tooltip small" data-tooltip={`Host: ${settings.smtpHost || "—"}\nPort: ${settings.smtpPort}\nFrom: ${settings.smtpFrom || "—"}\n\nConfigured via .env file`}>ⓘ</span>
											</div>
											<div className="setting-actions">
												<button type="button" className="ghost" onClick={testEmail} disabled={testingEmail || !settings.notificationEmail}>
													{testingEmail ? "Sending..." : "Test Email"}
												</button>
												{testEmailResult && (
													<span className={testEmailResult.success ? "success-text" : "danger-text"}>
														{testEmailResult.message}
													</span>
												)}
											</div>
										</div>
									)}

									{settings.shoutrrrEnabled && (
										<div className="setting-section">
											<div className="section-header">
												<h3>🔔 Push Settings</h3>
												<span className="info-tooltip" title="Supports ntfy, Discord, Telegram, Slack and other Shoutrrr-compatible services.">ⓘ</span>
											</div>
											<div className="setting-group">
												<label className="full">
													<span className="field-label">Notification URL</span>
													<div className="input-with-tooltip">
														<input
															type="url"
															value={settings.shoutrrrUrl}
															onChange={(e) => setSettings({ ...settings, shoutrrrUrl: e.target.value })}
															placeholder="https://ntfy.sh/your-topic"
															pattern="(https?|ntfy|discord|telegram|slack):\/\/.+"
														/>
														<span className="info-tooltip" data-tooltip="e.g. https://ntfy.sh/mytopic, discord://token@id">ⓘ</span>
													</div>
												</label>
											</div>
											<div className="setting-actions">
												<button type="button" className="ghost" onClick={testShoutrrr} disabled={testingShoutrrr || !settings.shoutrrrUrl}>
													{testingShoutrrr ? "Sending..." : "Test Push"}
												</button>
												{testShoutrrrResult && (
													<span className={testShoutrrrResult.success ? "success-text" : "danger-text"}>
														{testShoutrrrResult.message}
													</span>
												)}
											</div>
										</div>
									)}

									<div className="form-footer">
										<button type="submit" disabled={settingsSaving || (!settingsChanged && settingsSaved)}>
											{settingsSaving ? "Saving..." : settingsSaved && !settingsChanged ? "Saved ✓" : "Save Settings"}
										</button>
									</div>
								</form>
							)}
						</article>
					</section>
				} />
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
							</div>
						</div>

						<div className="med-detail-body">
							<div className="med-detail-section">
								<h3>Stock Information</h3>
								<div className="med-detail-grid">
									<div className="med-detail-item">
										<span className="med-detail-label">Total Pills</span>
										<span className="med-detail-value">{formatNumber(selectedMed.count)}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">Packs</span>
										<span className="med-detail-value">{selectedMed.packCount ?? 0}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">Blisters/Pack</span>
										<span className="med-detail-value">{selectedMed.stripsPerPack ?? 0}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">Pills/Blister</span>
										<span className="med-detail-value">{selectedMed.tabsPerStrip ?? 1}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">Loose Pills</span>
										<span className="med-detail-value">{selectedMed.looseTablets ?? 0}</span>
									</div>
									<div className="med-detail-item">
										<span className="med-detail-label">Expiry Date</span>
										<span className={`med-detail-value ${selectedMed.expiryDate && new Date(selectedMed.expiryDate) < new Date() ? 'danger-text' : ''}`}>
											{selectedMed.expiryDate ? new Date(selectedMed.expiryDate).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) : "—"}
										</span>
									</div>
								</div>
							</div>

							{selectedMed.slices.length > 0 && (
								<div className="med-detail-section">
									<h3>Intake Schedule</h3>
									<div className="med-detail-schedules">
										{selectedMed.slices.map((slice, idx) => (
											<div key={idx} className="med-schedule-item">
												<span className="med-schedule-usage">{slice.usage} pill{slice.usage !== 1 ? "s" : ""}</span>
												<span className="med-schedule-freq">every {slice.every} day{slice.every !== 1 ? "s" : ""}</span>
												<span className="med-schedule-time">at {new Date(slice.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
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
										<h3>Coverage Status</h3>
										<div className="med-detail-grid">
											<div className="med-detail-item">
												<span className="med-detail-label">Days Left</span>
												<span className="med-detail-value">{medCoverage.daysLeft !== null ? formatNumber(medCoverage.daysLeft) : "—"}</span>
											</div>
											<div className="med-detail-item">
												<span className="med-detail-label">Runs Out</span>
												<span className="med-detail-value">{medCoverage.depletionDate ?? "—"}</span>
											</div>
											<div className="med-detail-item full-width">
												<span className="med-detail-label">Status</span>
												<span className={`status-chip ${status.className}`}>{status.label}</span>
											</div>
										</div>
									</div>
								);
							})()}

							{selectedMed.notes && (
								<div className="med-detail-section">
									<h3>📝 Notes</h3>
									<div className="med-notes-content">
										{selectedMed.notes}
									</div>
								</div>
							)}
						</div>

						<div className="med-detail-footer">
							<button className="ghost" onClick={() => { setSelectedMed(null); setShowImageLightbox(false); navigate("/medications"); setEditingId(selectedMed.id); }}>
								Edit Medication
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

function formatDateTime(value: string) {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) return value;
	return d.toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function buildSchedulePreview(meds: Medication[]) {
	const events: Array<{ id: string; medName: string; timeStr: string; dateStr: string; usage: number; when: number }> = [];
	const now = new Date();
	const end = new Date();
	end.setDate(end.getDate() + 10);

	meds.forEach((med) => {
		med.slices.forEach((slice, idx) => {
			const start = new Date(slice.start);
			if (Number.isNaN(start.getTime())) return;
			for (let d = new Date(start); d <= end; d.setDate(d.getDate() + slice.every)) {
				if (d < now) continue;
				const whenMs = d.getTime();
				events.push({
					id: `${med.id}-${idx}-${whenMs}`,
					medName: med.name,
					usage: slice.usage,
					when: whenMs,
					timeStr: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
					dateStr: d.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }),
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

function getExpiryClass(expiryDate: string | null | undefined): string {
	if (!expiryDate) return "";
	const now = new Date();
	const expiry = new Date(expiryDate);
	const diffMs = expiry.getTime() - now.getTime();
	const diffDays = diffMs / (1000 * 60 * 60 * 24);
	
	if (diffDays <= 7) return "danger-text"; // 1 week or less (or expired)
	if (diffDays <= 30) return "warning-text"; // 1 month or less
	return "success-text"; // more than 1 month
}

function calculateCoverage(meds: Medication[], events: Array<{ medName: string; when: number }>) {
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
		const depletionDate = depletionMs !== null ? new Date(depletionMs).toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }) : null;
		const nextEvent = events.find((e) => e.medName === m.name);

		return {
			name: m.name,
			medsLeft: Number(medsLeft.toFixed(1)),
			daysLeft,
			depletionDate,
			depletionTime: depletionMs,
			nextDose: nextEvent ? new Date(nextEvent.when).toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null,
		};
	});

	const low = coverage.filter((c) => c.medsLeft <= 0 || (c.daysLeft !== null && c.daysLeft <= 3));
	return { low, all: coverage };
}

function getReminderStatusText(reminderDaysBefore: number, lowStock: Coverage[], lastSent: string | null): React.ReactNode {
	// Find the earliest medication that needs a reminder (based on reminderDaysBefore)
	const medsNeedingReminder = lowStock
		.filter((c) => c.depletionTime !== null && c.daysLeft !== null && c.daysLeft <= reminderDaysBefore)
		.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));

	const formatLastSent = (iso: string) => {
		const date = new Date(iso);
		return date.toLocaleDateString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
	};

	if (medsNeedingReminder.length > 0) {
		// There are medications that need reminders
		if (lastSent) {
			return (
				<>
					<strong className="warning-text">⚠ {medsNeedingReminder.length} med{medsNeedingReminder.length > 1 ? "s" : ""} need reorder</strong>
					{" · "}Last reminder: {formatLastSent(lastSent)}
				</>
			);
		}
		return <strong className="warning-text">⚠ {medsNeedingReminder.length} med{medsNeedingReminder.length > 1 ? "s" : ""} need reorder — waiting for first check</strong>;
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
					<span className="success-text">✓ All OK</span>
					{" · "}Next: <strong>{nextMed.name}</strong> in {daysUntilReminder} days
				</>
			);
		}
	}

	// No low stock medications at all
	if (lastSent) {
		return (
			<>
				<span className="success-text">✓ All stock OK</span>
				{" · "}Last reminder: {formatLastSent(lastSent)}
			</>
		);
	}
	return <span className="success-text">✓ All stock OK — no reminders needed</span>;
}

function getNextReminderForMed(med: Coverage, reminderDaysBefore: number): string {
	if (!med.depletionTime) return "—";
	
	const reminderTime = med.depletionTime - reminderDaysBefore * 86_400_000;
	const now = Date.now();
	
	if (reminderTime <= now) {
		return "Due now";
	}
	
	return new Date(reminderTime).toLocaleDateString([], {
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
		return { level: "out-of-stock", className: "danger", label: "Out of Stock" };
	}
	
	// No schedule set (no daysLeft calculation possible)
	if (daysLeft === null) {
		return { level: "normal", className: "success", label: "No Schedule" };
	}
	
	// High stock: > highStockDays (e.g. > 180 days)
	if (daysLeft > thresholds.highStockDays) {
		return { level: "high", className: "high", label: "★ High Stock" };
	}
	
	// Normal stock: between lowStockDays and highStockDays
	if (daysLeft >= thresholds.lowStockDays) {
		return { level: "normal", className: "success", label: "Normal" };
	}
	
	// Low stock: < lowStockDays (e.g. < 30 days)
	return { level: "low", className: "warning", label: "Low Stock" };
}

function MedicationAvatar({ name, imageUrl, size = "sm" }: { name: string; imageUrl?: string | null; size?: "sm" | "md" | "lg" }) {
	const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
	const sizeClass = `med-avatar med-avatar-${size}`;
	
	if (imageUrl) {
		return <img src={`/api/images/${imageUrl}`} alt={name} className={sizeClass} />;
	}
	return <div className={`${sizeClass} med-avatar-initials`}>{initials}</div>;
}
