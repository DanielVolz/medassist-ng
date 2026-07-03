import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useModalHistory } from "../hooks/useModalHistory";
import type { Medication } from "../types";
import {
	getMedDisplayName,
	getMedTotal,
	getStockDisplayCapacity,
	isAmountBasedPackageType,
	isLiquidContainerPackageType,
	isTubePackageType,
} from "../types";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { formatDate, formatDateTime, toInputValue } from "../utils/formatters";
import { getIntakeMoodDisplay, INTAKE_MOODS, type IntakeMood } from "../utils/intake-mood";
import { getIntakeFrequencyText, getMedicationIntakes } from "../utils/intake-schedule";
import { mergePersonTags, personTagsMatch } from "../utils/person-tags";
import { useAuth } from "./Auth";
import { DateTimeInput } from "./DateTimeInput";
import { MedicationAvatar } from "./MedicationAvatar";
import classes from "./ReportModal.module.css";

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
		dosesSkipped: number;
		firstDoseAt: string | null;
		lastDoseAt: string | null;
		moodSummary?: Partial<Record<IntakeMood, number>>;
		journalEntries?: ReportJournalEntry[];
		refills: {
			packsAdded: number;
			loosePillsAdded?: number;
			quantityAdded: number;
			usedPrescription: boolean;
			refillDate: string;
		}[];
	}
>;

type ReportJournalEntry = {
	scheduledFor: string;
	takenAt: string | null;
	dismissed: boolean;
	takenSource: string;
	takenByPerson: string | null;
	mood: IntakeMood | null;
	note: string | null;
};

type ReportDateRange = {
	startDate: string;
	endDate: string;
};

type ReportPreview = {
	format: "txt" | "md";
	content: string;
};

function getDefaultDateRange(): ReportDateRange {
	const endDate = new Date();
	const startDate = new Date(endDate);
	startDate.setDate(startDate.getDate() - 30);
	return {
		startDate: toInputValue(startDate),
		endDate: toInputValue(endDate),
	};
}

export function ReportModal({ isOpen, onClose, medications }: ReportModalProps) {
	const { t } = useTranslation();
	const { authFetch } = useAuth();
	const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	const [format, setFormat] = useState<ReportFormat>("pdf");
	const [generating, setGenerating] = useState(false);
	const [takenByFilter, setTakenByFilter] = useState<Set<string>>(new Set());
	const [dateRange, setDateRange] = useState<ReportDateRange>(() => getDefaultDateRange());
	const [preview, setPreview] = useState<ReportPreview | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	useModalHistory(isOpen, "report", onClose);

	// Collect all unique "taken by" people across all medications
	const allPeople = useMemo(() => {
		return mergePersonTags(medications.flatMap((medication) => medication.takenBy || []));
	}, [medications]);

	// Filtered medications based on takenBy filter
	const filteredMeds = useMemo(() => {
		if (takenByFilter.size === 0) return medications;
		return medications.filter((medication) =>
			medication.takenBy?.some((person) =>
				Array.from(takenByFilter).some((filterValue) => personTagsMatch(person, filterValue))
			)
		);
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
			setDateRange(getDefaultDateRange());
			setPreview(null);
			setErrorMessage(null);
		}
	}, [isOpen]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: preview should reset when any report input changes while the modal is open
	useEffect(() => {
		if (!isOpen) {
			return;
		}

		setPreview(null);
		setErrorMessage(null);
	}, [isOpen, selectedIds, takenByFilter, format, dateRange.startDate, dateRange.endDate]);

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
	const getOptionClassName = (selected: boolean) =>
		selected ? `${classes.formatOption} ${classes.selected}` : classes.formatOption;
	let generateButtonLabel = t("report.generate");
	if (generating) {
		generateButtonLabel = t("report.generating");
	} else if (preview) {
		generateButtonLabel = t("report.regenerate");
	}

	async function handleGenerate() {
		if (selectedIds.size === 0) return;
		const startDate = new Date(dateRange.startDate);
		const endDate = new Date(dateRange.endDate);
		if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
			setErrorMessage(t("report.invalidDateRange"));
			return;
		}

		setGenerating(true);
		setErrorMessage(null);

		try {
			const resolvedDateRange = {
				startDate: startDate.toISOString(),
				endDate: endDate.toISOString(),
			};
			const filterArr = takenByFilter.size > 0 ? Array.from(takenByFilter) : null;

			// Fetch report data from backend
			const res = await authFetch("/api/medications/report-data", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					medicationIds: Array.from(selectedIds),
					startDate: resolvedDateRange.startDate,
					endDate: resolvedDateRange.endDate,
					takenByFilter: takenByFilter.size > 0 ? Array.from(takenByFilter) : undefined,
				}),
			});
			if (!res.ok) throw new Error("Failed to fetch report data");
			const reportData = (await res.json()) as ReportData;

			if (format === "pdf") {
				const imageMap = await fetchMedImages(selectedMeds, authFetch);
				openPrintView(selectedMeds, reportData, t, imageMap, filterArr, resolvedDateRange);
				setPreview(null);
				setErrorMessage(null);
				onClose();
			} else {
				const content = generateTextReport(selectedMeds, reportData, format, t, filterArr, resolvedDateRange);
				setPreview({ format, content });
			}
		} catch {
			// Stay open on error so user can retry
			setErrorMessage(t("report.error"));
		} finally {
			setGenerating(false);
		}
	}

	if (!isOpen) return null;

	return (
		<AppModal
			classNames={{
				body: classes.modalBody,
				header: classes.modalHeader,
				title: classes.modalTitle,
			}}
			contentClassName={classes.modal}
			onClose={onClose}
			opened={isOpen}
			closeButtonProps={{ "aria-label": t("common.close") }}
			size={520}
			title={t("report.title")}
			withCloseButton
		>
			<p className={classes.description}>{t("report.description")}</p>

			<div className={classes.range}>
				<h4>{t("report.dateRange")}</h4>
				<div className={classes.rangeGrid}>
					<div className={classes.rangeField}>
						<span>{t("report.from")}</span>
						<DateTimeInput
							step="60"
							value={dateRange.startDate}
							onChange={(e) => setDateRange((prev) => ({ ...prev, startDate: e.target.value }))}
						/>
					</div>
					<div className={classes.rangeField}>
						<span>{t("report.until")}</span>
						<DateTimeInput
							step="60"
							value={dateRange.endDate}
							onChange={(e) => setDateRange((prev) => ({ ...prev, endDate: e.target.value }))}
						/>
					</div>
				</div>
			</div>

			{/* Person filter */}
			{allPeople.length > 1 && (
				<div className={classes.personFilter}>
					<h4>{t("report.filterByPerson")}</h4>
					<div className={`${classes.formatOptions} ${classes.personOptions}`}>
						<label className={getOptionClassName(takenByFilter.size === 0)}>
							<input
								type="checkbox"
								className={classes.hiddenOptionInput}
								checked={takenByFilter.size === 0}
								onChange={selectAllPeople}
							/>
							<span>{t("report.allPeople")}</span>
						</label>
						{allPeople.map((person) => (
							<label key={person} className={getOptionClassName(takenByFilter.has(person))}>
								<input
									type="checkbox"
									className={classes.hiddenOptionInput}
									checked={takenByFilter.has(person)}
									onChange={() => togglePerson(person)}
								/>
								<span>{person}</span>
							</label>
						))}
					</div>
				</div>
			)}

			{/* Medication selection */}
			<div className={classes.selection}>
				<div className={classes.selectionHeader}>
					<AppButton
						type="button"
						size="xs"
						tone="ghost"
						onClick={selectedIds.size === filteredMeds.length ? deselectAll : selectAll}
					>
						{selectedIds.size === filteredMeds.length ? t("report.deselectAll") : t("report.selectAll")}
					</AppButton>
					<span className={classes.selectionCount}>
						{selectedIds.size} / {filteredMeds.length}
					</span>
				</div>

				{activeMeds.length > 0 && (
					<div className={classes.group}>
						<h4 className={classes.groupTitle}>{t("report.activeMeds")}</h4>
						<div className={classes.medList}>
							{activeMeds.map((med) => (
								<label key={med.id} className={classes.medItem}>
									<input type="checkbox" checked={selectedIds.has(med.id)} onChange={() => toggleMed(med.id)} />
									<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="sm" />
									<span className={classes.medName}>
										{getMedDisplayName(med)}
										{med.name && med.genericName && <span className={classes.medGeneric}> ({med.genericName})</span>}
									</span>
								</label>
							))}
						</div>
					</div>
				)}

				{obsoleteMeds.length > 0 && (
					<div className={classes.group}>
						<h4 className={classes.groupTitle}>{t("report.obsoleteMeds")}</h4>
						<div className={classes.medList}>
							{obsoleteMeds.map((med) => (
								<label key={med.id} className={classes.medItem}>
									<input type="checkbox" checked={selectedIds.has(med.id)} onChange={() => toggleMed(med.id)} />
									<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="sm" />
									<span className={`${classes.medName} ${classes.obsoleteName}`}>
										{getMedDisplayName(med)}
										{med.name && med.genericName && <span className={classes.medGeneric}> ({med.genericName})</span>}
									</span>
								</label>
							))}
						</div>
					</div>
				)}
			</div>

			{/* Format selection */}
			<div className={classes.format}>
				<h4>{t("report.format")}</h4>
				<div className={classes.formatOptions}>
					<label className={getOptionClassName(format === "pdf")}>
						<input
							type="radio"
							name="format"
							value="pdf"
							checked={format === "pdf"}
							onChange={() => setFormat("pdf")}
						/>
						<span>{t("report.formatPdf")}</span>
					</label>
					<label className={getOptionClassName(format === "txt")}>
						<input
							type="radio"
							name="format"
							value="txt"
							checked={format === "txt"}
							onChange={() => setFormat("txt")}
						/>
						<span>{t("report.formatTxt")}</span>
					</label>
					<label className={getOptionClassName(format === "md")}>
						<input type="radio" name="format" value="md" checked={format === "md"} onChange={() => setFormat("md")} />
						<span>{t("report.formatMd")}</span>
					</label>
				</div>
			</div>

			{errorMessage && <p className={classes.error}>{errorMessage}</p>}

			{preview && (
				<div className={classes.preview} data-testid="report-preview">
					<div className={classes.previewHeader}>
						<h4>{t("report.preview")}</h4>
						<AppButton
							type="button"
							size="xs"
							tone="ghost"
							onClick={() => downloadFile(preview.content, preview.format)}
						>
							{t("report.download")}
						</AppButton>
					</div>
					<p className={classes.previewDesc}>{t("report.previewDescription")}</p>
					<pre className={classes.previewContent} data-testid="report-preview-content">
						{preview.content}
					</pre>
				</div>
			)}

			{/* Actions */}
			<AppModalFooter>
				<AppButton type="button" tone="secondary" onClick={onClose}>
					{t("common.close")}
				</AppButton>
				<AppButton
					type="button"
					tone="primary"
					onClick={handleGenerate}
					disabled={selectedIds.size === 0 || generating}
				>
					{generateButtonLabel}
				</AppButton>
			</AppModalFooter>
		</AppModal>
	);
}

// ─── Report generation helpers ───

type TFn = (key: string, opts?: Record<string, unknown>) => string;

function getAmountBasedUnitText(med: Medication, value: number, t: TFn): string {
	if (isLiquidContainerPackageType(med.packageType) || med.medicationForm === "liquid") {
		return t("form.packageAmountUnitMl");
	}
	return t("form.blisters.applications", { count: Math.abs(value) });
}

function getDiscreteUnitText(med: Medication, value: number, t: TFn): string {
	if (med.packageType === "inhaler") return value === 1 ? t("common.puff") : t("common.puffs");
	if (med.packageType === "injection") return value === 1 ? t("common.injection") : t("common.injections");
	return value === 1 ? t("common.pill") : t("common.pills");
}

function getUsageText(med: Medication, usage: number, t: TFn): string {
	if (isTubePackageType(med.packageType) || isLiquidContainerPackageType(med.packageType)) {
		return `${usage} ${getAmountBasedUnitText(med, usage, t)}`;
	}
	return `${usage} ${getDiscreteUnitText(med, usage, t)}`;
}

function getTotalCapacityLabel(med: Medication, t: TFn): string {
	if (isTubePackageType(med.packageType) || isLiquidContainerPackageType(med.packageType)) {
		return t("form.totalAmountLabel", { unit: getAmountBasedUnitText(med, getStockDisplayCapacity(med), t) });
	}
	return t("report.docTotalCapacity");
}

function getCurrentStockText(med: Medication, t: TFn): string {
	if (isTubePackageType(med.packageType) || isLiquidContainerPackageType(med.packageType)) {
		return `${getMedTotal(med)} ${getAmountBasedUnitText(med, getMedTotal(med), t)}`;
	}
	return `${getMedTotal(med)} ${getDiscreteUnitText(med, getMedTotal(med), t)}`;
}

function getReportPackageTypeLabel(med: Medication, t: TFn): string {
	if (isTubePackageType(med.packageType)) return t("report.docTube");
	if (isLiquidContainerPackageType(med.packageType)) return t("form.packageTypeLiquidContainer");
	if (med.packageType === "inhaler") return t("form.packageTypeInhaler");
	if (med.packageType === "injection") return t("form.packageTypeInjection");
	if (isAmountBasedPackageType(med.packageType)) return t("report.docBottle");
	return t("report.docBlister");
}

function getMoodSummaryItems(summary: Partial<Record<IntakeMood, number>> | undefined, t: TFn): string[] {
	return INTAKE_MOODS.map((mood) => {
		const count = summary?.[mood] ?? 0;
		return count > 0 ? `${getIntakeMoodDisplay(mood, t)}: ${count}` : null;
	}).filter((item): item is string => item !== null);
}

function formatJournalReportEntry(entry: ReportJournalEntry, t: TFn): string {
	const mood = entry.mood ? getIntakeMoodDisplay(entry.mood, t) : t("report.docJournalNoMood");
	const status = entry.dismissed ? t("report.docJournalStatusSkipped") : t("report.docJournalStatusTaken");
	const parts = [
		`${t("report.docJournalScheduledFor")}: ${formatDateTime(entry.scheduledFor)}`,
		`${t("report.docJournalTakenAt")}: ${entry.takenAt ? formatDateTime(entry.takenAt) : "-"}`,
		`${t("report.docStatus")}: ${status}`,
		`${t("report.docJournalMood")}: ${mood}`,
	];
	if (entry.takenByPerson) {
		parts.push(`${t("report.docTakenBy")}: ${entry.takenByPerson}`);
	}
	if (entry.note) {
		parts.push(`${t("report.docJournalNote")}: ${entry.note}`);
	}
	return parts.join("; ");
}

function generateTextReport(
	meds: Medication[],
	reportData: ReportData,
	fmt: "txt" | "md",
	t: TFn,
	personFilter: string[] | null,
	dateRange: { startDate: string; endDate: string }
): string {
	const lines: string[] = [];
	const sep = fmt === "md" ? "---" : "═".repeat(60);
	const h1 = (s: string) => (fmt === "md" ? `# ${s}` : s);
	const h2 = (s: string) => (fmt === "md" ? `## ${s}` : s);
	const h3 = (s: string) => (fmt === "md" ? `### ${s}` : `  ${s}`);
	const bold = (s: string) => (fmt === "md" ? `**${s}**` : s);
	const item = (label: string, value: string) => (fmt === "md" ? `- ${bold(label)}: ${value}` : `  ${label}: ${value}`);

	lines.push(h1(t("report.docTitle")));
	lines.push(`${t("report.docGenerated")}: ${formatDate(new Date().toISOString())}`);
	lines.push(`${t("report.docRange")}: ${formatDateTime(dateRange.startDate)} - ${formatDateTime(dateRange.endDate)}`);
	lines.push("");

	for (const med of meds) {
		lines.push(sep);
		lines.push("");
		const title = med.isObsolete
			? `${getMedDisplayName(med)} (${t("report.docStatusObsolete")})`
			: getMedDisplayName(med);
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
		if (med.medicationStartDate) lines.push(item(t("report.docStartDate"), formatDate(med.medicationStartDate)));
		if (med.isObsolete && med.obsoleteAt) lines.push(item(t("report.docObsoleteSince"), formatDate(med.obsoleteAt)));
		lines.push("");

		// Package / Stock
		lines.push(h3(t("report.docPackage")));
		lines.push(item(t("report.docPackageType"), getReportPackageTypeLabel(med, t)));
		if (!isAmountBasedPackageType(med.packageType)) {
			lines.push(item(t("report.docPacks"), String(med.packCount)));
			lines.push(item(t("report.docBlistersPerPack"), String(med.blistersPerPack)));
			lines.push(item(t("report.docPillsPerBlister"), String(med.pillsPerBlister)));
			if (med.looseTablets > 0) lines.push(item(t("report.docLoosePills"), String(med.looseTablets)));
		} else {
			lines.push(item(getTotalCapacityLabel(med, t), String(getStockDisplayCapacity(med))));
		}
		lines.push(item(t("report.docCurrentStock"), getCurrentStockText(med, t)));
		if (!isTubePackageType(med.packageType) && !isLiquidContainerPackageType(med.packageType) && med.pillWeightMg)
			lines.push(item(t("report.docDosePerPill"), `${med.pillWeightMg} ${med.doseUnit ?? "mg"}`));
		if (med.expiryDate) lines.push(item(t("report.docExpiryDate"), formatDate(med.expiryDate)));
		if (med.notes) lines.push(item(t("report.docNotes"), med.notes));
		lines.push("");

		// Intake Schedule
		const allIntakes = getMedicationIntakes(med);
		const intakes = personFilter
			? allIntakes?.filter((intake) => intake.takenBy && personFilter.includes(intake.takenBy))
			: allIntakes;
		if (intakes?.length) {
			lines.push(h3(t("report.docIntakeSchedule")));
			for (const intake of intakes) {
				let entry = getUsageText(med, intake.usage, t);
				entry += ` ${getIntakeFrequencyText(intake, t)}`;
				entry += ` ${t("form.blisters.from")} ${formatDateTime(intake.start)}`;
				if (intake.takenBy) entry += ` (${t("report.docIntakeTakenBy", { person: intake.takenBy })})`;
				if (intake.intakeRemindersEnabled) entry += ` 🔔`;
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
				lines.push(item(t("report.docPrescriptionExpiry"), formatDate(med.prescriptionExpiryDate)));
			lines.push("");
		}

		// Dose tracking data
		const data = reportData[med.id];
		if (data) {
			lines.push(h3(t("report.docIntakeHistory")));
			if (data.dosesTaken > 0 || data.dosesSkipped > 0) {
				lines.push(item(t("report.docDosesTaken"), String(data.dosesTaken)));
				if (data.automaticDosesTaken > 0) {
					lines.push(item(`🤖 ${t("report.docDosesTakenAutomatic")}`, String(data.automaticDosesTaken)));
				}
				if (data.dosesSkipped > 0) lines.push(item(t("report.docDosesSkipped"), String(data.dosesSkipped)));
				if (data.firstDoseAt) lines.push(item(t("report.docFirstDose"), formatDate(data.firstDoseAt)));
				if (data.lastDoseAt) lines.push(item(t("report.docLastDose"), formatDate(data.lastDoseAt)));
			} else {
				lines.push(fmt === "md" ? `- ${t("report.docNoDoses")}` : `  ${t("report.docNoDoses")}`);
			}
			lines.push("");

			const moodSummaryItems = getMoodSummaryItems(data.moodSummary, t);
			const journalEntries = data.journalEntries ?? [];
			if (moodSummaryItems.length > 0 || journalEntries.length > 0) {
				lines.push(h3(t("report.docJournal")));
				if (moodSummaryItems.length > 0) {
					lines.push(item(t("report.docJournalMoodSummary"), moodSummaryItems.join(", ")));
				}
				if (journalEntries.length > 0) {
					lines.push(
						fmt === "md" ? `- ${bold(t("report.docJournalEntries"))}:` : `  ${t("report.docJournalEntries")}:`
					);
					for (const entry of journalEntries) {
						lines.push(
							fmt === "md" ? `  - ${formatJournalReportEntry(entry, t)}` : `    • ${formatJournalReportEntry(entry, t)}`
						);
					}
				} else {
					lines.push(fmt === "md" ? `- ${t("report.docJournalNoEntries")}` : `  ${t("report.docJournalNoEntries")}`);
				}
				lines.push("");
			}

			// Refill history
			if (data.refills.length > 0) {
				lines.push(h3(t("report.docRefillHistory")));
				for (const r of data.refills) {
					let entry = `${formatDate(r.refillDate)}: +${r.packsAdded} ${t("report.docPacks")}, +${r.quantityAdded} ${
						isTubePackageType(med.packageType) || isLiquidContainerPackageType(med.packageType)
							? getAmountBasedUnitText(med, r.quantityAdded, t)
							: getDiscreteUnitText(med, r.quantityAdded, t)
					}`;
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

async function fetchMedImages(meds: Medication[], authFetch: typeof fetch): Promise<ImageMap> {
	const map: ImageMap = {};
	const fetches = meds
		.filter((m) => m.imageUrl)
		.map(async (m) => {
			try {
				const res = await authFetch(`/api/images/${m.imageUrl}`);
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
	personFilter: string[] | null,
	dateRange: { startDate: string; endDate: string }
) {
	const w = window.open("", "_blank");
	if (!w) return;

	const html = buildPrintHtml(meds, reportData, t, imageMap, personFilter, dateRange);
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
	personFilter: string[] | null,
	dateRange: { startDate: string; endDate: string }
): string {
	const sections: string[] = [];

	for (const med of meds) {
		const data = reportData[med.id];
		const intakes = getMedicationIntakes(med);
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
				`<tr><td class="label">${escHtml(t("report.docStartDate"))}</td><td>${formatDate(med.medicationStartDate)}</td></tr>`
			);
		if (med.isObsolete && med.obsoleteAt)
			generalRows.push(
				`<tr><td class="label">${escHtml(t("report.docObsoleteSince"))}</td><td>${formatDate(med.obsoleteAt)}</td></tr>`
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
		s += `<tr><td class="label">${escHtml(t("report.docPackageType"))}</td><td>${escHtml(getReportPackageTypeLabel(med, t))}</td></tr>`;
		if (!isAmountBasedPackageType(med.packageType)) {
			s += `<tr><td class="label">${escHtml(t("report.docPacks"))}</td><td>${med.packCount}</td></tr>`;
			s += `<tr><td class="label">${escHtml(t("report.docBlistersPerPack"))}</td><td>${med.blistersPerPack}</td></tr>`;
			s += `<tr><td class="label">${escHtml(t("report.docPillsPerBlister"))}</td><td>${med.pillsPerBlister}</td></tr>`;
			if (med.looseTablets > 0)
				s += `<tr><td class="label">${escHtml(t("report.docLoosePills"))}</td><td>${med.looseTablets}</td></tr>`;
		} else {
			s += `<tr><td class="label">${escHtml(getTotalCapacityLabel(med, t))}</td><td>${getStockDisplayCapacity(med)}</td></tr>`;
		}
		s += `<tr><td class="label">${escHtml(t("report.docCurrentStock"))}</td><td>${escHtml(getCurrentStockText(med, t))}</td></tr>`;
		if (!isTubePackageType(med.packageType) && !isLiquidContainerPackageType(med.packageType) && med.pillWeightMg)
			s += `<tr><td class="label">${escHtml(t("report.docDosePerPill"))}</td><td>${med.pillWeightMg} ${escHtml(med.doseUnit ?? "mg")}</td></tr>`;
		if (med.expiryDate)
			s += `<tr><td class="label">${escHtml(t("report.docExpiryDate"))}</td><td>${formatDate(med.expiryDate)}</td></tr>`;
		if (med.notes)
			s += `<tr><td class="label">${escHtml(t("report.docNotes"))}</td><td>${escHtml(med.notes)}</td></tr>`;
		s += `</tbody></table>`;

		// Intake Schedule
		const allPrintIntakes = intakes;
		const filteredPrintIntakes = personFilter
			? allPrintIntakes?.filter((intake) => intake.takenBy && personFilter.includes(intake.takenBy))
			: allPrintIntakes;
		if (filteredPrintIntakes?.length) {
			s += `<h3>${escHtml(t("report.docIntakeSchedule"))}</h3>`;
			s += `<ul>`;
			for (const intake of filteredPrintIntakes) {
				let entry = escHtml(getUsageText(med, intake.usage, t));
				entry += ` ${escHtml(getIntakeFrequencyText(intake, t))}`;
				entry += ` ${escHtml(t("form.blisters.from"))} ${formatDateTime(intake.start)}`;
				if (intake.takenBy) entry += ` <em>(${escHtml(t("report.docIntakeTakenBy", { person: intake.takenBy }))})</em>`;
				if (intake.intakeRemindersEnabled) entry += ` 🔔`;
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
				s += `<tr><td class="label">${escHtml(t("report.docPrescriptionExpiry"))}</td><td>${formatDate(med.prescriptionExpiryDate)}</td></tr>`;
			s += `</tbody></table>`;
		}

		// Intake history
		if (data) {
			s += `<h3>${escHtml(t("report.docIntakeHistory"))}</h3>`;
			if (data.dosesTaken > 0 || data.dosesSkipped > 0) {
				s += `<table><tbody>`;
				s += `<tr><td class="label">${escHtml(t("report.docDosesTaken"))}</td><td>${data.dosesTaken}</td></tr>`;
				if (data.automaticDosesTaken > 0) {
					s += `<tr><td class="label">${escHtml(`🤖 ${t("report.docDosesTakenAutomatic")}`)}</td><td>${data.automaticDosesTaken}</td></tr>`;
				}
				if (data.dosesSkipped > 0)
					s += `<tr><td class="label">${escHtml(t("report.docDosesSkipped"))}</td><td>${data.dosesSkipped}</td></tr>`;
				if (data.firstDoseAt)
					s += `<tr><td class="label">${escHtml(t("report.docFirstDose"))}</td><td>${formatDate(data.firstDoseAt)}</td></tr>`;
				if (data.lastDoseAt)
					s += `<tr><td class="label">${escHtml(t("report.docLastDose"))}</td><td>${formatDate(data.lastDoseAt)}</td></tr>`;
				s += `</tbody></table>`;
			} else {
				s += `<p class="no-data">${escHtml(t("report.docNoDoses"))}</p>`;
			}

			const moodSummaryItems = getMoodSummaryItems(data.moodSummary, t);
			const journalEntries = data.journalEntries ?? [];
			if (moodSummaryItems.length > 0 || journalEntries.length > 0) {
				s += `<h3>${escHtml(t("report.docJournal"))}</h3>`;
				if (moodSummaryItems.length > 0) {
					s += `<table><tbody><tr><td class="label">${escHtml(t("report.docJournalMoodSummary"))}</td><td>${escHtml(moodSummaryItems.join(", "))}</td></tr></tbody></table>`;
				}
				if (journalEntries.length > 0) {
					s += `<ul>`;
					for (const entry of journalEntries) {
						s += `<li>${escHtml(formatJournalReportEntry(entry, t))}</li>`;
					}
					s += `</ul>`;
				} else {
					s += `<p class="no-data">${escHtml(t("report.docJournalNoEntries"))}</p>`;
				}
			}

			// Refill history
			if (data.refills.length > 0) {
				s += `<h3>${escHtml(t("report.docRefillHistory"))}</h3>`;
				s += `<ul>`;
				for (const r of data.refills) {
					let entry = `${formatDate(r.refillDate)}: +${r.packsAdded} ${escHtml(t("report.docPacks"))}, +${r.quantityAdded} ${escHtml(
						isTubePackageType(med.packageType) || isLiquidContainerPackageType(med.packageType)
							? getAmountBasedUnitText(med, r.quantityAdded, t)
							: getDiscreteUnitText(med, r.quantityAdded, t)
					)}`;
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
<p class="subtitle">${escHtml(t("report.docGenerated"))}: ${formatDate(new Date().toISOString())}</p>
<p class="subtitle">${escHtml(t("report.docRange"))}: ${formatDateTime(dateRange.startDate)} - ${formatDateTime(dateRange.endDate)}</p>
${sections.join("\n")}
</body>
</html>`;
}

export default ReportModal;
