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
	count: number;
	strips: number;
	stripSize: number;
	packCount?: number;
	stripsPerPack?: number;
	tabsPerStrip?: number;
	looseTablets?: number;
	slices: Slice[];
	updatedAt: string | number | null;
};

type PlannerRow = {
	medicationId: number;
	medicationName: string;
	plannerUsage: number;
	stripSize: number;
	stripsNeeded: number;
	stripsAvailable: number;
	enough: boolean;
};

type FormSlice = { usage: string; every: string; start: string };

type FormState = {
	name: string;
	packCount: string;
	stripsPerPack: string;
	tabsPerStrip: string;
	looseTablets: string;
	slices: FormSlice[];
};

const defaultSlice = (): FormSlice => ({ usage: "1", every: "1", start: toInputValue(new Date().toISOString()) });

const defaultForm = (): FormState => ({ name: "", packCount: "1", stripsPerPack: "1", tabsPerStrip: "1", looseTablets: "0", slices: [defaultSlice()] });

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
		smtpHost: "",
		smtpPort: 587,
		smtpUser: "",
		smtpPass: "",
		smtpFrom: "",
		smtpSecure: false,
		hasSmtpPassword: false,
	});
	const [savedSettings, setSavedSettings] = useState(settings);
	const [settingsLoading, setSettingsLoading] = useState(false);
	const [settingsSaving, setSettingsSaving] = useState(false);
	const [settingsSaved, setSettingsSaved] = useState(false);
	const [testingEmail, setTestingEmail] = useState(false);
	const [testEmailResult, setTestEmailResult] = useState<{ success: boolean; message: string } | null>(null);

	// Check if settings have changed
	const settingsChanged = settings.emailEnabled !== savedSettings.emailEnabled ||
		settings.notificationEmail !== savedSettings.notificationEmail ||
		settings.reminderDaysBefore !== savedSettings.reminderDaysBefore;

	const schedule = useMemo(() => buildSchedulePreview(meds), [meds]);
	const totalTablets = useMemo(() => deriveTotal(form), [form]);
	const coverage = useMemo(() => calculateCoverage(meds, schedule.events), [meds, schedule.events]);
	const depletionByMed = useMemo(() => Object.fromEntries(coverage.all.map((c) => [c.name, c.depletionTime])), [coverage.all]);
	const groupedSchedule = useMemo(() => {
		const days = new Map<string, { dateStr: string; meds: Map<string, { medName: string; total: number; times: string[]; lastWhen: number }> }>();
		schedule.events.slice(0, 30).forEach((event) => {
			const day = days.get(event.dateStr) ?? { dateStr: event.dateStr, meds: new Map() };
			const medEntry = day.meds.get(event.medName) ?? { medName: event.medName, total: 0, times: [], lastWhen: event.when };
			medEntry.total += event.usage;
			medEntry.times.push(event.timeStr);
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
		setSettingsSaving(true);
		setTestEmailResult(null);
		
		const payload = {
			emailEnabled: settings.emailEnabled,
			notificationEmail: settings.notificationEmail,
			reminderDaysBefore: settings.reminderDaysBefore,
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

	async function deleteMed(id: number) {
		await fetch(`/api/medications/${id}`, { method: "DELETE" }).catch(() => null);
		if (editingId === id) resetForm();
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
			packCount: String(med.packCount ?? 1),
			stripsPerPack: String(med.stripsPerPack ?? med.strips ?? 1),
			tabsPerStrip: String(med.tabsPerStrip ?? med.stripSize ?? 1),
			looseTablets: String(med.looseTablets ?? 0),
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
			packCount: Number(form.packCount) || 0,
			stripsPerPack: Math.max(1, Number(form.stripsPerPack) || 1),
			tabsPerStrip: Math.max(1, Number(form.tabsPerStrip) || 1),
			looseTablets: Math.max(0, Number(form.looseTablets) || 0),
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

	return (
		<main className="page">
			<header className="hero">
				<div>
					<p className="eyebrow">Medassist · Planner</p>
					<h1>Manage medication plans</h1>
				</div>
				<div className="header-actions">
					<div className="tabs">
						<button className={currentPath === "/dashboard" || currentPath === "/" ? "pill primary" : "pill"} onClick={() => navigate("/dashboard")}>Dashboard</button>
						<button className={currentPath === "/medications" ? "pill primary" : "pill"} onClick={() => navigate("/medications")}>Medications</button>
						<button className={currentPath === "/planner" ? "pill primary" : "pill"} onClick={() => navigate("/planner")}>Planner</button>
						<button className={currentPath === "/settings" ? "pill primary" : "pill"} onClick={() => navigate("/settings")}>⚙️</button>
					</div>
					<button className="theme-toggle" onClick={toggleTheme} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
						{theme === "dark" ? "☀️" : "🌙"}
					</button>
				</div>
			</header>

			<Routes>
				<Route path="/" element={<Navigate to="/dashboard" replace />} />
				<Route path="/dashboard" element={
					<>
						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>Reorder Reminder</h2>
									<span className="pill neutral">Stock watch</span>
								</div>
								{coverage.low.length === 0 ? (
									<p className="success-text">All good, enough stock.</p>
								) : (
									<div className="table">
										<div className="table-head">
											<span>Name</span>
											<span>Current pills</span>
											<span>Days left</span>
											<span>Runs out</span>
											<span>Next dose</span>
										</div>
										{coverage.low.map((row) => (
											<div key={row.name} className="table-row">
												<span>{row.name}</span>
												<span className={row.medsLeft <= 0 ? "danger-text" : ""}>{formatNumber(row.medsLeft)}</span>
												<span className={row.daysLeft !== null && row.daysLeft <= 0 ? "danger-text" : ""}>{formatNumber(row.daysLeft)}</span>
												<span>{row.depletionDate ?? "-"}</span>
												<span>{row.nextDose ?? "-"}</span>
											</div>
										))}
									</div>
								)}
							</article>
						</section>

						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>Medication Overview</h2>
									<span className="pill neutral">Stock</span>
								</div>
								<div className="table table-4">
									<div className="table-head">
										<span>Name</span>
										<span>Current pills</span>
										<span>Days left</span>
										<span>Runs out</span>
									</div>
									{coverage.all.map((row) => (
										<div key={row.name} className="table-row">
											<span>{row.name}</span>
											<span className={row.medsLeft <= 0 ? "danger-text" : ""}>{formatNumber(row.medsLeft)}</span>
											<span>{formatNumber(row.daysLeft)}</span>
											<span>{row.depletionDate ?? "-"}</span>
										</div>
									))}
								</div>
							</article>
						</section>

						<section className="grid">
							<article className="card">
								<div className="card-head">
									<h2>Upcoming Schedules</h2>
									<span className="pill neutral">Next 10</span>
								</div>
								<div className="timeline">
									{groupedSchedule.map((day) => (
										<div key={day.dateStr} className="day-block">
											<div className="day-divider">{day.dateStr}</div>
											{day.meds.map((item) => {
												const depletionTime = depletionByMed[item.medName];
												const outOfStock = typeof depletionTime === "number" && item.lastWhen > depletionTime;
												return (
													<div key={`${day.dateStr}-${item.medName}`} className="time-row">
														<div className="time-main">
															<div className="med-name">{item.medName}</div>
															<div className="tag-row">
																<span className="tag subtle">{item.total} pills total</span>
																<span className={`tag ${outOfStock ? "danger" : "success"}`}>
																	{outOfStock ? "⚠ No pills left" : "✓ Stock OK"}
																</span>
															</div>
														</div>
														<div className="time-col">
															<div className="time-chip times-chip">{item.times.join(" · ")}</div>
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
												<div className="med-name">{med.name}</div>
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
									Name
									<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="z.B. Lisinopril" required />
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

								<div className="full slices">
									<div className="card-head">
										<h3>Intake schedule</h3>
										<button type="button" className="ghost" onClick={addSlice}>+ Intake</button>
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
								<div className="table">
									<div className="table-head">
										<span>Medication</span>
										<span>Usage</span>
										<span>Blisters needed</span>
										<span>Available</span>
										<span>Status</span>
									</div>
									{plannerRows.map((row) => (
										<div key={row.medicationId} className="table-row">
											<span>{row.medicationName}</span>
											<span><strong>{row.plannerUsage}</strong> pills</span>
											<span>{row.stripsNeeded} × {row.stripSize}</span>
											<span>{row.stripsAvailable}</span>
											<span className={row.enough ? "status-chip success" : "status-chip danger"}>{row.enough ? "Enough" : "Low"}</span>
										</div>
									))}
								</div>
							)}
						</article>
					</section>
				} />

				<Route path="/settings" element={
					<section className="grid">
						<article className="card">
							<div className="card-head">
								<h2>Email Notifications</h2>
								<span className="pill neutral">Reminder settings</span>
							</div>
							{settingsLoading ? (
								<p>Loading settings...</p>
							) : (
								<form className="settings-form" onSubmit={saveSettings}>
									<div className="setting-row">
										<div className="setting-info">
											<label className="setting-label">Enable Email Reminders</label>
											<p className="setting-desc">Get notified when medication is running low</p>
										</div>
										<label className="toggle-switch">
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
												<label>
													Notification Email
													<input
														type="email"
														value={settings.notificationEmail}
														onChange={(e) => setSettings({ ...settings, notificationEmail: e.target.value })}
														placeholder="your@email.com"
													/>
												</label>
												<label>
													Remind me (days before)
													<input
														type="number"
														min="1"
														max="30"
														value={settings.reminderDaysBefore}
														onChange={(e) => setSettings({ ...settings, reminderDaysBefore: Number(e.target.value) || 7 })}
													/>
												</label>
											</div>

											<div className="setting-section">
												<h3>SMTP Configuration</h3>
												<p className="setting-hint">Diese Einstellungen werden in der <code>.env</code> Datei konfiguriert.</p>
												<div className="smtp-readonly">
													<div className="smtp-field">
														<span className="smtp-label">Host</span>
														<span className="smtp-value">{settings.smtpHost || "—"}</span>
													</div>
													<div className="smtp-field">
														<span className="smtp-label">Port</span>
														<span className="smtp-value">{settings.smtpPort}</span>
													</div>
													<div className="smtp-field">
														<span className="smtp-label">User</span>
														<span className="smtp-value">{settings.smtpUser || "—"}</span>
													</div>
													<div className="smtp-field">
														<span className="smtp-label">Password</span>
														<span className="smtp-value">{settings.hasSmtpPassword ? "••••••••" : "—"}</span>
													</div>
													<div className="smtp-field">
														<span className="smtp-label">From</span>
														<span className="smtp-value">{settings.smtpFrom || "—"}</span>
													</div>
													<div className="smtp-field">
														<span className="smtp-label">SSL/TLS</span>
														<span className="smtp-value">{settings.smtpSecure ? "Ja" : "Nein"}</span>
													</div>
												</div>
											</div>

											<div className="setting-actions">
												<button type="button" className="ghost" onClick={testEmail} disabled={testingEmail || !settings.notificationEmail}>
													{testingEmail ? "Sending..." : "Send Test Email"}
												</button>
												{testEmailResult && (
													<span className={testEmailResult.success ? "success-text" : "danger-text"}>
														{testEmailResult.message}
													</span>
												)}
											</div>
										</>
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
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toInputValue(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 16);
	const iso = date.toISOString();
	return iso.slice(0, 16);
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
	end.setDate(end.getDate() + 3);

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
