import type React from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { log } from "../utils/logger";
import { useFeedback } from "./FeedbackContext";

export type ImportPreview = {
	version: string;
	exportedAt: string;
	includeSensitiveData: boolean;
	incoming: {
		medications: number;
		doseHistory: number;
		refillHistory: number;
		shareLinks: number;
		journalEntries: number;
		imageCount: number;
		hasSettings: boolean;
	};
	current: {
		medications: number;
		doseHistory: number;
		refillHistory: number;
		shareLinks: number;
		hasSettings: boolean;
	};
	warnings: {
		replacesExistingData: boolean;
		regeneratesShareLinks: boolean;
		containsImages: boolean;
		containsSensitiveData: boolean;
	};
};

export type ImportResult = {
	medications: number;
	doses: number;
	refills: number;
	shares: number;
};

type UseImportExportOptions = {
	onImportComplete: () => void;
};

export function useImportExport({ onImportComplete }: UseImportExportOptions) {
	const { user, authFetch } = useAuth();
	const { showFeedback } = useFeedback();
	const { t } = useTranslation();

	const [exporting, setExporting] = useState(false);
	const [importing, setImporting] = useState(false);
	const [showExportModal, setShowExportModal] = useState(false);
	const [showImportConfirm, setShowImportConfirm] = useState(false);
	const [pendingImportData, setPendingImportData] = useState<unknown>(null);
	const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
	const [importResult, setImportResult] = useState<ImportResult | null>(null);

	const resetImportExportState = useCallback(() => {
		setShowExportModal(false);
		setShowImportConfirm(false);
		setPendingImportData(null);
		setImportPreview(null);
		setImportResult(null);
		setExporting(false);
		setImporting(false);
	}, []);

	const handleExport = useCallback(
		async (includeImages: boolean = true, includeSensitive: boolean = false) => {
			setExporting(true);
			try {
				const res = await authFetch(`/api/export?includeSensitive=${includeSensitive}&includeImages=${includeImages}`);
				if (!res.ok) throw new Error("Export failed");
				const data = await res.json();

				const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				const now = new Date();
				const dateStr = now.toISOString().replace(/[-:]/g, "").replace(/T/, "-").slice(0, 13);
				const userPart = user?.username ? `-${user.username}` : "";
				a.href = url;
				a.download = `${t("exportImport.downloadFilename")}${userPart}-${dateStr}.json`;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			} catch (err) {
				log.error("Export error:", err);
			}
			setExporting(false);
		},
		[authFetch, t, user?.username]
	);

	const handleImportFileSelect = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = async (event) => {
				try {
					const data = JSON.parse(event.target?.result as string);
					if (!data.version || !data.exportedAt) {
						setPendingImportData(null);
						setImportPreview(null);
						showFeedback({ message: t("exportImport.invalidFile"), tone: "error" });
						return;
					}

					const res = await authFetch("/api/import/preview", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(data),
					});

					const text = await res.text();
					let previewResponse: { error?: string; preview?: ImportPreview } = {};
					try {
						previewResponse = text ? JSON.parse(text) : {};
					} catch {
						log.error("Import preview response parse error:", text);
						showFeedback({
							message: `${t("exportImport.importError")}: Server returned invalid response`,
							tone: "error",
						});
						return;
					}

					if (!res.ok || !previewResponse.preview) {
						setPendingImportData(null);
						setImportPreview(null);
						if (previewResponse.error === "Invalid import data format") {
							showFeedback({ message: t("exportImport.invalidFile"), tone: "error" });
							return;
						}
						showFeedback({
							message: `${t("exportImport.importError")}: ${previewResponse.error || `HTTP ${res.status}`}`,
							tone: "error",
						});
						return;
					}

					setImportResult(null);
					setPendingImportData(data);
					setImportPreview(previewResponse.preview);
					setShowImportConfirm(true);
				} catch {
					setPendingImportData(null);
					setImportPreview(null);
					showFeedback({ message: t("exportImport.invalidFile"), tone: "error" });
				}
			};
			reader.readAsText(file);
			e.target.value = "";
		},
		[authFetch, showFeedback, t]
	);

	const handleImportConfirm = useCallback(async () => {
		if (!pendingImportData) return;
		setImporting(true);
		setShowImportConfirm(false);

		try {
			const res = await authFetch("/api/import", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(pendingImportData),
			});

			const text = await res.text();
			let data: {
				error?: string;
				message?: string;
				imported?:
					| {
							medications?: number;
							doseHistory?: number;
							refillHistory?: number;
							shareLinks?: number;
					  }
					| number;
			} = {};
			try {
				data = text ? JSON.parse(text) : {};
			} catch {
				log.error("Import response parse error:", text);
				showFeedback({
					message: `${t("exportImport.importError")}: Server returned invalid response`,
					tone: "error",
				});
				return;
			}

			if (!res.ok) {
				showFeedback({
					message: `${t("exportImport.importError")}: ${data.error || `HTTP ${res.status}`}`,
					tone: "error",
				});
				return;
			}

			const importedCounts = typeof data.imported === "object" && data.imported !== null ? data.imported : null;
			setImportResult({
				medications: importedCounts?.medications || 0,
				doses: importedCounts?.doseHistory || 0,
				refills: importedCounts?.refillHistory || 0,
				shares: importedCounts?.shareLinks || 0,
			});
			onImportComplete();
		} catch (err) {
			log.error("Import error:", err);
			showFeedback({ message: t("exportImport.importError"), tone: "error" });
		} finally {
			setPendingImportData(null);
			setImportPreview(null);
			setImporting(false);
		}
	}, [authFetch, onImportComplete, pendingImportData, showFeedback, t]);

	return useMemo(
		() => ({
			exporting,
			importing,
			showExportModal,
			setShowExportModal,
			showImportConfirm,
			setShowImportConfirm,
			pendingImportData,
			setPendingImportData,
			importPreview,
			setImportPreview,
			importResult,
			setImportResult,
			handleExport,
			handleImportFileSelect,
			handleImportConfirm,
			resetImportExportState,
		}),
		[
			exporting,
			importing,
			showExportModal,
			showImportConfirm,
			pendingImportData,
			importPreview,
			importResult,
			handleExport,
			handleImportFileSelect,
			handleImportConfirm,
			resetImportExportState,
		]
	);
}
