import { Alert, Stack, Text, UnstyledButton } from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { AppCheckbox } from "../ui/primitives/AppCheckbox";
import classes from "./ExportModal.module.css";

interface ExportModalProps {
	isOpen: boolean;
	onClose: () => void;
	onExport: (includeImages: boolean, includeSensitive: boolean) => void;
	exporting: boolean;
}

export default function ExportModal({ isOpen, onClose, onExport, exporting }: ExportModalProps) {
	const { t } = useTranslation();
	const [includeSensitive, setIncludeSensitive] = useState(false);

	useEffect(() => {
		if (!isOpen) {
			setIncludeSensitive(false);
		}
	}, [isOpen]);

	if (!isOpen) return null;

	const handleExport = (includeImages: boolean) => {
		if (exporting) return;
		onClose();
		onExport(includeImages, includeSensitive);
	};

	return (
		<AppModal
			closeButtonProps={{ "aria-label": t("common.close") }}
			onClose={onClose}
			opened={isOpen}
			size="sm"
			title={t("exportImport.exportOptions")}
			withCloseButton
		>
			<Stack gap="md">
				<Stack gap="sm">
					<UnstyledButton
						className={classes.option}
						data-testid="export-option-with-images"
						disabled={exporting}
						onClick={() => handleExport(true)}
						type="button"
					>
						<Stack gap={4}>
							<Text fw={700}>{t("exportImport.exportWithImages")}</Text>
							<Text c="dimmed" size="sm">
								{t("exportImport.exportWithImagesDesc")}
							</Text>
						</Stack>
					</UnstyledButton>
					<UnstyledButton
						className={classes.option}
						data-testid="export-option-data-only"
						disabled={exporting}
						onClick={() => handleExport(false)}
						type="button"
					>
						<Stack gap={4}>
							<Text fw={700}>{t("exportImport.exportDataOnly")}</Text>
							<Text c="dimmed" size="sm">
								{t("exportImport.exportDataOnlyDesc")}
							</Text>
						</Stack>
					</UnstyledButton>
				</Stack>
				<Stack className={classes.sensitivePanel} gap="sm">
					<AppCheckbox
						aria-describedby={includeSensitive ? "sensitive-export-warning" : undefined}
						checked={includeSensitive}
						data-testid="sensitive-export-toggle"
						disabled={exporting}
						label={t("exportImport.includeSensitive")}
						onChange={setIncludeSensitive}
					/>
					{includeSensitive ? (
						<Alert color="yellow" id="sensitive-export-warning" variant="light">
							{t("exportImport.sensitiveWarning")}
						</Alert>
					) : null}
				</Stack>
				<AppModalFooter>
					<AppButton type="button" tone="secondary" onClick={onClose}>
						{t("common.close")}
					</AppButton>
				</AppModalFooter>
			</Stack>
		</AppModal>
	);
}
