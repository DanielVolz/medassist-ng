import { Alert, Group, List, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { ImportPreview } from "../context/AppContext";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import classes from "./ImportReviewModal.module.css";

interface ImportReviewModalProps {
	isOpen: boolean;
	importPreview: ImportPreview | null;
	formattedExportedAt: string;
	importing: boolean;
	exporting: boolean;
	onClose: () => void;
	onBackup: () => void;
	onConfirm: () => void;
}

export function ImportReviewModal({
	isOpen,
	importPreview,
	formattedExportedAt,
	importing,
	exporting,
	onClose,
	onBackup,
	onConfirm,
}: ImportReviewModalProps) {
	const { t } = useTranslation();
	const hasExistingData = importPreview?.warnings.replacesExistingData ?? false;
	const hasWarnings = Boolean(
		importPreview?.warnings.replacesExistingData ||
			importPreview?.warnings.regeneratesShareLinks ||
			importPreview?.warnings.containsImages ||
			importPreview?.warnings.containsSensitiveData
	);

	if (!isOpen || !importPreview) {
		return null;
	}

	return (
		<AppModal
			closeButtonProps={{ "aria-label": t("common.close") }}
			contentClassName={`${classes.modal} import-review-modal`}
			onClose={onClose}
			opened={isOpen}
			size="lg"
			title={t(hasExistingData ? "exportImport.confirmImport" : "exportImport.confirmImportEmpty")}
			withCloseButton
		>
			<Stack gap="md">
				<Text>{t(hasExistingData ? "exportImport.reviewDescription" : "exportImport.reviewDescriptionEmpty")}</Text>
				<SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
					<Paper withBorder radius={10} p="md" className={classes.summaryCard}>
						<Stack gap="xs">
							<div>
								<Text fw={700}>{t("exportImport.incomingData")}</Text>
								<Text c="dimmed" size="sm">
									{t("exportImport.summaryCounts", {
										medications: importPreview.incoming.medications,
										doses: importPreview.incoming.doseHistory,
										refills: importPreview.incoming.refillHistory,
										shares: importPreview.incoming.shareLinks,
									})}
								</Text>
							</div>
							<Stack gap={4} className={classes.meta}>
								<Text size="sm">{t("exportImport.formatVersion", { version: importPreview.version })}</Text>
								<Text size="sm">{t("exportImport.exportedAt", { date: formattedExportedAt })}</Text>
								{importPreview.incoming.hasSettings ? (
									<Text size="sm">{t("exportImport.settingsIncluded")}</Text>
								) : null}
								{importPreview.incoming.journalEntries > 0 && (
									<Text size="sm">
										{t("exportImport.journalEntries", { count: importPreview.incoming.journalEntries })}
									</Text>
								)}
								{importPreview.incoming.imageCount > 0 && (
									<Text size="sm">{t("exportImport.imageCount", { count: importPreview.incoming.imageCount })}</Text>
								)}
							</Stack>
						</Stack>
					</Paper>
					<Paper withBorder radius={10} p="md" className={classes.summaryCard}>
						<Stack gap="xs">
							<div>
								<Text fw={700}>{t("exportImport.currentData")}</Text>
								<Text c="dimmed" size="sm">
									{t("exportImport.summaryCounts", {
										medications: importPreview.current.medications,
										doses: importPreview.current.doseHistory,
										refills: importPreview.current.refillHistory,
										shares: importPreview.current.shareLinks,
									})}
								</Text>
							</div>
							{importPreview.current.hasSettings ? (
								<Text c="dimmed" size="sm">
									{t("exportImport.settingsConfigured")}
								</Text>
							) : null}
						</Stack>
					</Paper>
				</SimpleGrid>

				{hasWarnings ? (
					<Alert color="yellow" variant="light">
						<Stack gap="xs">
							<Text fw={700}>{t("exportImport.warningListTitle")}</Text>
							<List spacing={4}>
								{importPreview.warnings.replacesExistingData ? (
									<List.Item>{t("exportImport.warningReplaceData")}</List.Item>
								) : null}
								{importPreview.warnings.regeneratesShareLinks ? (
									<List.Item>{t("exportImport.warningShareLinks")}</List.Item>
								) : null}
								{importPreview.warnings.containsImages ? (
									<List.Item>{t("exportImport.warningImages")}</List.Item>
								) : null}
								{importPreview.warnings.containsSensitiveData ? (
									<List.Item>{t("exportImport.warningSensitive")}</List.Item>
								) : null}
							</List>
						</Stack>
					</Alert>
				) : null}

				{hasExistingData ? (
					<Alert color="yellow" variant="light">
						{t("exportImport.confirmImportWarning")}
					</Alert>
				) : (
					<Text c="dimmed">{t("exportImport.confirmImportEmptyMessage")}</Text>
				)}

				<Text c="dimmed" size="sm">
					{t("exportImport.backupHint")}
				</Text>

				<AppModalFooter>
					<AppButton type="button" tone="secondary" onClick={onClose} disabled={importing || exporting}>
						{t("exportImport.cancelButton")}
					</AppButton>
					<Group gap="sm">
						{hasExistingData ? (
							<AppButton type="button" tone="secondary" onClick={onBackup} disabled={exporting || importing}>
								{exporting ? t("exportImport.exporting") : t("exportImport.backupFirst")}
							</AppButton>
						) : null}
						<AppButton
							type="button"
							tone={hasExistingData ? "danger" : "primary"}
							onClick={onConfirm}
							disabled={importing}
						>
							{importing
								? t("exportImport.importing")
								: t(hasExistingData ? "exportImport.confirmButton" : "exportImport.confirmButtonEmpty")}
						</AppButton>
					</Group>
				</AppModalFooter>
			</Stack>
		</AppModal>
	);
}
