import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useScrollLock } from "../hooks/useScrollLock";
import type { Medication } from "../types";
import { getMedDisplayName, getPackageSize } from "../types";
import { MedicationAvatar } from "./MedicationAvatar";

type ReportFormat = "txt" | "md" | "pdf";

interface ReportModalProps {
	isOpen: boolean;
	onClose: () => void;
	medications: Medication[];
}

type ReportData = Record<
	number,
	{
		dosesTaken: number;
		automaticDosesTaken: number;
		dosesDismissed: number;
		firstDoseAt: string | null;
		lastDoseAt: string | null;
		refills: { packsAdded: number; loosePillsAdded: number; usedPrescription: boolean; refillDate: string }[];
	}
>;

export function ReportModal({ isOpen, onClose, medications }: ReportModalProps) {
	const { t } = useTranslation();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [format, setFormat] = useState<ReportFormat>("pdf");
	const [generating, setGenerating] = useState(false);
	const [takenByFilter, setTakenByFilter] = useState<Set<string>>(new Set());

	useScrollLock(isOpen);
	useEscapeKey(isOpen, onClose);

	// Collect all unique "taken by" people across all medications
	const allPeople = useMemo(() => {
		const people = new Set<string>();
		for (const med of medications) {
			if (med.takenBy) {
				for (const p of med.takenBy) people.add(p);
			}
		}
		return Array.from(people).sort();
	}, [medications]);

	// Filtered medications based on takenBy filter
	const filteredMeds = useMemo(() => {
		if (takenByFilter.size === 0) return medications;
		return medications.filter((m) => m.takenBy?.some((p) => takenByFilter.has(p)));
	}, [medications, takenByFilter]);

	const activeMeds = useMemo(() => filteredMeds.filter((m) => !m.isObsolete), [filteredMeds]);
	const obsoleteMeds = useMemo(() => filteredMeds.filter((m) => m.isObsolete), [filteredMeds]);

	const togglePerson = useCallback((person: string) => {
		setTakenByFilter((prev) => {
			const next = new Set(prev);
			if (next.has(person)) next.delete(person);
			else next.add(person);
			return next;
		});
	}, []);

	const selectAllPeople = useCallback(() => {
		setTakenByFilter(new Set());
	}, []);

	// Reset selection when modal opens or filter changes
	useEffect(() => {
		if (isOpen) {
			setSelectedIds(new Set(filteredMeds.map((m) => m.id)));
		}
	}, [isOpen, filteredMeds]);

	// Reset everything when modal opens
	useEffect(() => {
		if (isOpen) {
			setTakenByFilter(new Set());
			setFormat("pdf");
			setGenerating(false);
		}
	}, [isOpen]);

	const toggleMed = useCallback((id: number) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	const selectAll = useCallback(() => {
		setSelectedIds(new Set(filteredMeds.map((m) => m.id)));
	}, [filteredMeds]);

	const deselectAll = useCallback(() => {
		setSelectedIds(new Set());
	}, []);

	const selectedMeds = useMemo(() => filteredMeds.filter((m) => selectedIds.has(m.id)), [filteredMeds, selectedIds]);

	async function handleGenerate() {
		if (selectedIds.size === 0) return;
		setGenerating(true);

		try {
			// Fetch report data from backend
			const res = await fetch("/api/medications/report-data", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ medicationIds: Array.from(selectedIds) }),
				credentials: "include",
			});
			if (!res.ok) throw new Error("Failed to fetch report data");
			const reportData = (await res.json()) as ReportData;

			if (format === "pdf") {
				const imageMap = await fetchMedImages(selectedMeds);
				const filterArr = takenByFilter.size > 0 ? Array.from(takenByFilter) : null;
				openPrintView(selectedMeds, reportData, t, imageMap, filterArr);
			} else {
				const filterArr = takenByFilter.size > 0 ? Array.from(takenByFilter) : null;
				const content = generateTextReport(selectedMeds, reportData, format, t, filterArr);
				downloadFile(content, format);
			}
			onClose();
		} catch {
			// Stay open on error so user can retry
		} finally {
			setGenerating(false);
		}
	}

	if (!isOpen) return null;

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key !== "Escape") e.stopPropagation();
			}}
		>
			<div
				className="modal-content report-modal"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<button className="modal-close" onClick={onClose}>
					×
				</button>
				<h2 className="report-modal-title">{t("report.title")}</h2>
				<p className="report-modal-desc">{t("report.description")}</p>

				{/* Person filter */}
				{allPeople.length > 1 && (
					<div className="report-person-filter">
						<h4>{t("report.filterByPerson")}</h4>
						<div className="report-format-options">
							<label className={`report-format-option${takenByFilter.size === 0 ? " selected" : ""}`}>
								<input type="checkbox" checked={takenByFilter.size === 0} onChange={selectAllPeople} />
								<span>{t("report.allPeople")}</span>
							</label>
							{allPeople.map((person) => (
								<label key={person} className={`report-format-option${takenByFilter.has(person) ? " selected" : ""}`}>
									<input type="checkbox" checked={takenByFilter.has(person)} onChange={() => togglePerson(person)} />
									<span>{person}</span>
								</label>
							))}
						</div>
					</div>
				)}

				{/* Medication selection */}
				<div className="report-selection">
					<div className="report-selection-header">
						<button
							type="button"
							className="ghost small"
							onClick={selectedIds.size === filteredMeds.length ? deselectAll : selectAll}
						>
							{selectedIds.size === filteredMeds.length ? t("report.deselectAll") : t("report.selectAll")}
						</button>
						<span className="report-selection-count">
							{selectedIds.size} / {filteredMeds.length}
						</span>
					</div>

					{activeMeds.length > 0 && (
						<div className="report-group">
							<h4 className="report-group-title">{t("report.activeMeds")}</h4>
							<div className="report-med-list">
								{activeMeds.map((med) => (
									<label key={med.id} className="report-med-item">
										<input type="checkbox" checked={selectedIds.has(med.id)} onChange={() => toggleMed(med.id)} />
										<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="sm" />
										<span className="report-med-name">
											{getMedDisplayName(med)}
											{med.name && med.genericName && <span className="report-med-generic"> ({med.genericName})</span>}
										</span>
									</label>
								))}
							</div>
						</div>
					)}

					{obsoleteMeds.length > 0 && (
						<div className="report-group">
							<h4 className="report-group-title">{t("report.obsoleteMeds")}</h4>
							<div className="report-med-list">
								{obsoleteMeds.map((med) => (
									<label key={med.id} className="report-med-item">
										<input type="checkbox" checked={selectedIds.has(med.id)} onChange={() => toggleMed(med.id)} />
										<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="sm" />
										<span className="report-med-name obsolete-name">
											{getMedDisplayName(med)}
											{med.name && med.genericName && <span className="report-med-generic"> ({med.genericName})</span>}
										</span>
									</label>
								))}
							</div>
						</div>
					)}
				</div>

				{/* Format selection */}
				<div className="report-format">
					<h4>{t("report.format")}</h4>
					<div className="report-format-options">
						<label className={`report-format-option${format === "pdf" ? " selected" : ""}`}>
							<input
								type="radio"
								name="format"
								value="pdf"
								checked={format === "pdf"}
								onChange={() => setFormat("pdf")}
							/>
							<span>{t("report.formatPdf")}</span>
						</label>
						<label className={`report-format-option${format === "txt" ? " selected" : ""}`}>
							<input
								type="radio"
								name="format"
								value="txt"
								checked={format === "txt"}
								onChange={() => setFormat("txt")}
							/>
							<span>{t("report.formatTxt")}</span>
						</label>
						<label className={`report-format-option${format === "md" ? " selected" : ""}`}>
							<input type="radio" name="format" value="md" checked={format === "md"} onChange={() => setFormat("md")} />
							<span>{t("report.formatMd")}</span>
						</label>
					</div>
				</div>

				{/* Actions */}
				<div className="report-actions">
					<button type="button" className="ghost" onClick={onClose}>
						{t("common.close")}
					</button>
					<button
						type="button"
						className="primary"
						onClick={handleGenerate}
						disabled={selectedIds.size === 0 || generating}
					>
						{generating ? t("report.generating") : t("report.generate")}
					</button>
				</div>
			</div>
		</div>
	);
}

// ─── Report generation helpers ───

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function fmtDate(iso: string | null | undefined): string {
	if (!iso) return "-";
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (!m) return "-";
	return `${m[3]}.${m[2]}.${m[1]}`;
}

function fmtDateTime(iso: string | null | undefined): string {
	if (!iso) return "-";
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
	if (!m) return `${fmtDate(iso)}`;
	return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
}

function generateTextReport(
	meds: Medication[],
	reportData: ReportData,
	fmt: "txt" | "md",
	t: TFn,
	personFilter: string[] | null
): string {
	const lines: string[] = [];
	const sep = fmt === "md" ? "---" : "═".repeat(60);
	const h1 = (s: string) => (fmt === "md" ? `# ${s}` : s);
	const h2 = (s: string) => (fmt === "md" ? `## ${s}` : s);
	const h3 = (s: string) => (fmt === "md" ? `### ${s}` : `  ${s}`);
	const bold = (s: string) => (fmt === "md" ? `**${s}**` : s);
	const item = (label: string, value: string) => (fmt === "md" ? `- ${bold(label)}: ${value}` : `  ${label}: ${value}`);

	lines.push(h1(t("report.docTitle")));
	lines.push(`${t("report.docGenerated")}: ${fmtDate(new Date().toISOString())}`);
	lines.push("");

	for (const med of meds) {
		lines.push(sep);
		lines.push("");
		const title = med.isObsolete ? `${getMedDisplayName(med)} (${t("report.docStatusObsolete")})` : getMedDisplayName(med);
		lines.push(h2(title));
		lines.push("");

		// General
		lines.push(h3(t("report.docGeneral")));
		if (med.name) lines.push(item(t("report.docCommercialName"), med.name));
		if (med.genericName) lines.push(item(t("report.docGenericName"), med.genericName));
		if (med.takenBy?.length) lines.push(item(t("report.docTakenBy"), med.takenBy.join(", ")));
		lines.push(
			item(t("report.docStatus"), med.isObsolete ? t("report.docStatusObsolete") : t("report.docStatusActive"))
		);
		if (med.medicationStartDate) lines.push(item(t("report.docStartDate"), fmtDate(med.medicationStartDate)));
		if (med.isObsolete && med.obsoleteAt) lines.push(item(t("report.docObsoleteSince"), fmtDate(med.obsoleteAt)));
		lines.push("");

		// Package / Stock
		lines.push(h3(t("report.docPackage")));
		lines.push(
			item(t("report.docPackageType"), med.packageType === "bottle" ? t("report.docBottle") : t("report.docBlister"))
		);
		if (med.packageType === "blister") {
			lines.push(item(t("report.docPacks"), String(med.packCount)));
			lines.push(item(t("report.docBlistersPerPack"), String(med.blistersPerPack)));
			lines.push(item(t("report.docPillsPerBlister"), String(med.pillsPerBlister)));
			if (med.looseTablets > 0) lines.push(item(t("report.docLoosePills"), String(med.looseTablets)));
		} else {
			lines.push(item(t("report.docTotalCapacity"), String(med.totalPills ?? med.looseTablets)));
		}
		lines.push(item(t("report.docCurrentStock"), `${getPackageSize(med)} ${t("common.pills")}`));
		if (med.pillWeightMg) lines.push(item(t("report.docDosePerPill"), `${med.pillWeightMg} ${med.doseUnit ?? "mg"}`));
		if (med.expiryDate) lines.push(item(t("report.docExpiryDate"), fmtDate(med.expiryDate)));
		if (med.notes) lines.push(item(t("report.docNotes"), med.notes));
		lines.push("");

		// Intake Schedule
		const allIntakes = med.intakes ?? med.blisters;
		const intakes = personFilter
			? allIntakes?.filter((i) => "takenBy" in i && personFilter.includes(i.takenBy as string))
			: allIntakes;
		if (intakes?.length) {
			lines.push(h3(t("report.docIntakeSchedule")));
			for (const intake of intakes) {
				let entry = `${intake.usage} ${intake.usage === 1 ? t("common.pill") : t("common.pills")}`;
				entry += ` ${intake.every === 1 ? t("common.daily") : t("common.everyNDays", { count: intake.every })}`;
				entry += ` ${t("form.blisters.from")} ${fmtDateTime(intake.start)}`;
				if ("takenBy" in intake && intake.takenBy)
					entry += ` (${t("report.docIntakeTakenBy", { person: intake.takenBy })})`;
				if ("intakeRemindersEnabled" in intake && intake.intakeRemindersEnabled) entry += ` 🔔`;
				lines.push(fmt === "md" ? `- ${entry}` : `  • ${entry}`);
			}
			lines.push("");
		}

		// Prescription
		if (med.prescriptionEnabled) {
			lines.push(h3(t("report.docPrescription")));
			lines.push(item(t("report.docAuthorizedRefills"), String(med.prescriptionAuthorizedRefills ?? 0)));
			lines.push(item(t("report.docRemainingRefills"), String(med.prescriptionRemainingRefills ?? 0)));
			if (med.prescriptionExpiryDate)
				lines.push(item(t("report.docPrescriptionExpiry"), fmtDate(med.prescriptionExpiryDate)));
			lines.push("");
		}

		// Dose tracking data
		const data = reportData[med.id];
		if (data) {
			lines.push(h3(t("report.docIntakeHistory")));
			if (data.dosesTaken > 0 || data.dosesDismissed > 0) {
				lines.push(item(t("report.docDosesTaken"), String(data.dosesTaken)));
				if (data.automaticDosesTaken > 0) {
					lines.push(item(`🤖 ${t("report.docDosesTakenAutomatic")}`, String(data.automaticDosesTaken)));
				}
				if (data.dosesDismissed > 0) lines.push(item(t("report.docDosesDismissed"), String(data.dosesDismissed)));
				if (data.firstDoseAt) lines.push(item(t("report.docFirstDose"), fmtDate(data.firstDoseAt)));
				if (data.lastDoseAt) lines.push(item(t("report.docLastDose"), fmtDate(data.lastDoseAt)));
			} else {
				lines.push(fmt === "md" ? `- ${t("report.docNoDoses")}` : `  ${t("report.docNoDoses")}`);
			}
			lines.push("");

			// Refill history
			if (data.refills.length > 0) {
				lines.push(h3(t("report.docRefillHistory")));
				for (const r of data.refills) {
					let entry = `${fmtDate(r.refillDate)}: +${r.packsAdded} ${t("report.docPacks")}, +${r.loosePillsAdded} ${t("common.pills")}`;
					if (r.usedPrescription) entry += ` ${t("report.docRefillPrescription")}`;
					lines.push(fmt === "md" ? `- ${entry}` : `  • ${entry}`);
				}
				lines.push("");
			}
		}
	}

	lines.push(sep);
	return lines.join("\n");
}

function downloadFile(content: string, format: "txt" | "md") {
	const mimeType = format === "md" ? "text/markdown" : "text/plain";
	const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	const dateStr = new Date().toISOString().slice(0, 10);
	a.href = url;
	a.download = `medassist-report-${dateStr}.${format}`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}

type ImageMap = Record<number, string>;

async function fetchMedImages(meds: Medication[]): Promise<ImageMap> {
	const map: ImageMap = {};
	const fetches = meds
		.filter((m) => m.imageUrl)
		.map(async (m) => {
			try {
				const res = await fetch(`/api/images/${m.imageUrl}`, { credentials: "include" });
				if (!res.ok) return;
				const blob = await res.blob();
				const dataUrl = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result as string);
					reader.readAsDataURL(blob);
				});
				map[m.id] = dataUrl;
			} catch {
				// Skip image on error
			}
		});
	await Promise.all(fetches);
	return map;
}

function openPrintView(
	meds: Medication[],
	reportData: ReportData,
	t: TFn,
	imageMap: ImageMap,
	personFilter: string[] | null
) {
	const w = window.open("", "_blank");
	if (!w) return;

	const html = buildPrintHtml(meds, reportData, t, imageMap, personFilter);
	w.document.write(html);
	w.document.close();
	w.onload = () => setTimeout(() => w.print(), 300);
}

function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildPrintHtml(
	meds: Medication[],
	reportData: ReportData,
	t: TFn,
	imageMap: ImageMap,
	personFilter: string[] | null
): string {
	const sections: string[] = [];

	for (const med of meds) {
		const data = reportData[med.id];
		const intakes = med.intakes ?? med.blisters;
		const displayName = getMedDisplayName(med);
		const title = med.isObsolete
			? `${escHtml(displayName)} <span class="obsolete-badge">${escHtml(t("report.docStatusObsolete"))}</span>`
			: escHtml(displayName);

		let s = `<div class="med-section">`;
		const imgDataUrl = imageMap[med.id];

		// Title with generic name subtitle
		s += `<h2>${title}</h2>`;
		if (med.name && med.genericName) s += `<p class="generic-subtitle">${escHtml(med.genericName)}</p>`;

		// Build general info table rows
		const generalRows: string[] = [];
		if (med.name)
			generalRows.push(
				`<tr><td class="label">${escHtml(t("report.docCommercialName"))}</td><td>${escHtml(med.name)}</td></tr>`
			);
		if (med.genericName)
			generalRows.push(
				`<tr><td class="label">${escHtml(t("report.docGenericName"))}</td><td>${escHtml(med.genericName)}</td></tr>`
			);
		if (med.takenBy?.length)
			generalRows.push(
				`<tr><td class="label">${escHtml(t("report.docTakenBy"))}</td><td>${escHtml(med.takenBy.join(", "))}</td></tr>`
			);
		generalRows.push(
			`<tr><td class="label">${escHtml(t("report.docStatus"))}</td><td>${escHtml(med.isObsolete ? t("report.docStatusObsolete") : t("report.docStatusActive"))}</td></tr>`
		);
		if (med.medicationStartDate)
			generalRows.push(
				`<tr><td class="label">${escHtml(t("report.docStartDate"))}</td><td>${fmtDate(med.medicationStartDate)}</td></tr>`
			);
		if (med.isObsolete && med.obsoleteAt)
			generalRows.push(
				`<tr><td class="label">${escHtml(t("report.docObsoleteSince"))}</td><td>${fmtDate(med.obsoleteAt)}</td></tr>`
			);
		const generalTable = `<h3>${escHtml(t("report.docGeneral"))}</h3><table><tbody>${generalRows.join("")}</tbody></table>`;

		if (imgDataUrl) {
			s += `<div class="med-overview"><img class="med-img" src="${imgDataUrl}" alt="${escHtml(displayName)}" /><div class="med-overview-info">${generalTable}</div></div>`;
		} else {
			s += generalTable;
		}

		// Package / Stock
		s += `<h3>${escHtml(t("report.docPackage"))}</h3>`;
		s += `<table><tbody>`;
		s += `<tr><td class="label">${escHtml(t("report.docPackageType"))}</td><td>${escHtml(med.packageType === "bottle" ? t("report.docBottle") : t("report.docBlister"))}</td></tr>`;
		if (med.packageType === "blister") {
			s += `<tr><td class="label">${escHtml(t("report.docPacks"))}</td><td>${med.packCount}</td></tr>`;
			s += `<tr><td class="label">${escHtml(t("report.docBlistersPerPack"))}</td><td>${med.blistersPerPack}</td></tr>`;
			s += `<tr><td class="label">${escHtml(t("report.docPillsPerBlister"))}</td><td>${med.pillsPerBlister}</td></tr>`;
			if (med.looseTablets > 0)
				s += `<tr><td class="label">${escHtml(t("report.docLoosePills"))}</td><td>${med.looseTablets}</td></tr>`;
		} else {
			s += `<tr><td class="label">${escHtml(t("report.docTotalCapacity"))}</td><td>${med.totalPills ?? med.looseTablets}</td></tr>`;
		}
		s += `<tr><td class="label">${escHtml(t("report.docCurrentStock"))}</td><td>${getPackageSize(med)} ${escHtml(t("common.pills"))}</td></tr>`;
		if (med.pillWeightMg)
			s += `<tr><td class="label">${escHtml(t("report.docDosePerPill"))}</td><td>${med.pillWeightMg} ${escHtml(med.doseUnit ?? "mg")}</td></tr>`;
		if (med.expiryDate)
			s += `<tr><td class="label">${escHtml(t("report.docExpiryDate"))}</td><td>${fmtDate(med.expiryDate)}</td></tr>`;
		if (med.notes)
			s += `<tr><td class="label">${escHtml(t("report.docNotes"))}</td><td>${escHtml(med.notes)}</td></tr>`;
		s += `</tbody></table>`;

		// Intake Schedule
		const allPrintIntakes = intakes;
		const filteredPrintIntakes = personFilter
			? allPrintIntakes?.filter((i) => "takenBy" in i && personFilter.includes(i.takenBy as string))
			: allPrintIntakes;
		if (filteredPrintIntakes?.length) {
			s += `<h3>${escHtml(t("report.docIntakeSchedule"))}</h3>`;
			s += `<ul>`;
			for (const intake of filteredPrintIntakes) {
				let entry = `${intake.usage} ${escHtml(intake.usage === 1 ? t("common.pill") : t("common.pills"))}`;
				entry += ` ${escHtml(intake.every === 1 ? t("common.daily") : t("common.everyNDays", { count: intake.every }))}`;
				entry += ` ${escHtml(t("form.blisters.from"))} ${fmtDateTime(intake.start)}`;
				if ("takenBy" in intake && intake.takenBy)
					entry += ` <em>(${escHtml(t("report.docIntakeTakenBy", { person: intake.takenBy }))})</em>`;
				if ("intakeRemindersEnabled" in intake && intake.intakeRemindersEnabled) entry += ` 🔔`;
				s += `<li>${entry}</li>`;
			}
			s += `</ul>`;
		}

		// Prescription
		if (med.prescriptionEnabled) {
			s += `<h3>${escHtml(t("report.docPrescription"))}</h3>`;
			s += `<table><tbody>`;
			s += `<tr><td class="label">${escHtml(t("report.docAuthorizedRefills"))}</td><td>${med.prescriptionAuthorizedRefills ?? 0}</td></tr>`;
			s += `<tr><td class="label">${escHtml(t("report.docRemainingRefills"))}</td><td>${med.prescriptionRemainingRefills ?? 0}</td></tr>`;
			if (med.prescriptionExpiryDate)
				s += `<tr><td class="label">${escHtml(t("report.docPrescriptionExpiry"))}</td><td>${fmtDate(med.prescriptionExpiryDate)}</td></tr>`;
			s += `</tbody></table>`;
		}

		// Intake history
		if (data) {
			s += `<h3>${escHtml(t("report.docIntakeHistory"))}</h3>`;
			if (data.dosesTaken > 0 || data.dosesDismissed > 0) {
				s += `<table><tbody>`;
				s += `<tr><td class="label">${escHtml(t("report.docDosesTaken"))}</td><td>${data.dosesTaken}</td></tr>`;
				if (data.automaticDosesTaken > 0) {
					s += `<tr><td class="label">${escHtml(`🤖 ${t("report.docDosesTakenAutomatic")}`)}</td><td>${data.automaticDosesTaken}</td></tr>`;
				}
				if (data.dosesDismissed > 0)
					s += `<tr><td class="label">${escHtml(t("report.docDosesDismissed"))}</td><td>${data.dosesDismissed}</td></tr>`;
				if (data.firstDoseAt)
					s += `<tr><td class="label">${escHtml(t("report.docFirstDose"))}</td><td>${fmtDate(data.firstDoseAt)}</td></tr>`;
				if (data.lastDoseAt)
					s += `<tr><td class="label">${escHtml(t("report.docLastDose"))}</td><td>${fmtDate(data.lastDoseAt)}</td></tr>`;
				s += `</tbody></table>`;
			} else {
				s += `<p class="no-data">${escHtml(t("report.docNoDoses"))}</p>`;
			}

			// Refill history
			if (data.refills.length > 0) {
				s += `<h3>${escHtml(t("report.docRefillHistory"))}</h3>`;
				s += `<ul>`;
				for (const r of data.refills) {
					let entry = `${fmtDate(r.refillDate)}: +${r.packsAdded} ${escHtml(t("report.docPacks"))}, +${r.loosePillsAdded} ${escHtml(t("common.pills"))}`;
					if (r.usedPrescription) entry += ` <em>${escHtml(t("report.docRefillPrescription"))}</em>`;
					s += `<li>${entry}</li>`;
				}
				s += `</ul>`;
			}
		}

		s += `</div>`;
		sections.push(s);
	}

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escHtml(t("report.docTitle"))}</title>
<style>
  @media print {
    body { margin: 0; padding: 1rem; }
    .no-print { display: none !important; }
    .med-section:last-child { margin-bottom: 0; padding-bottom: 0; }
  }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color: #1e293b;
    max-width: 800px;
    margin: 0 auto;
    padding: 2rem;
    line-height: 1.5;
  }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .subtitle { color: #64748b; margin-bottom: 1rem; }
  .med-section { margin-bottom: 1.5rem; padding-bottom: 1rem; }
  .med-section:last-child { }
  h2 { font-size: 1.25rem; color: #0f172a; margin: 0; }
  .generic-subtitle { margin: 0.1rem 0 0.5rem; font-size: 0.9rem; font-style: italic; color: #64748b; }
  h2 + .med-overview { margin-top: 0.5rem; }
  .med-overview { display: flex; gap: 1.25rem; align-items: flex-start; }
  .med-overview-info { flex: 1; min-width: 0; }
  .med-overview-info h3 { margin-top: 0; }
  .med-img { width: 220px; height: 220px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
  h3 { font-size: 0.9rem; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin: 1rem 0 0.5rem; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 0.5rem; }
  td { padding: 0.25rem 0.5rem; }
  td.label { font-weight: 500; color: #475569; width: 40%; }
  ul { margin: 0.25rem 0; padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  .obsolete-badge { font-size: 0.75rem; background: #fef3c7; color: #92400e; padding: 0.125rem 0.5rem; border-radius: 4px; vertical-align: middle; }
  .no-data { color: #94a3b8; font-style: italic; }
  .print-hint { text-align: center; padding: 1rem; background: #f0f9ff; border-radius: 8px; color: #0369a1; margin-bottom: 1.5rem; }
</style>
</head>
<body>
<div class="no-print print-hint">${escHtml(t("report.docPrintInstruction"))}</div>
<h1>${escHtml(t("report.docTitle"))}</h1>
<p class="subtitle">${escHtml(t("report.docGenerated"))}: ${fmtDate(new Date().toISOString())}</p>
${sections.join("\n")}
</body>
</html>`;
}

export default ReportModal;
