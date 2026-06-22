import { ArrowLeft } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "../../ui/components/SectionCard";
import { AppButton } from "../../ui/primitives/AppButton";
import classes from "./MedicationEditCoordinator.module.css";

type MedicationEditCoordinatorProps = {
	viewMode: "grid" | "form";
	editingId: number | null;
	readOnlyView: boolean;
	selectedMedicationName?: string;
	onBack: () => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	children: React.ReactNode;
	toolbar?: React.ReactNode;
	actions?: React.ReactNode;
};

export function MedicationEditCoordinator({
	viewMode,
	editingId,
	readOnlyView,
	selectedMedicationName,
	onBack,
	onSubmit,
	children,
	toolbar,
	actions,
}: MedicationEditCoordinatorProps) {
	const { t } = useTranslation();
	const title = editingId ? (
		<>
			{readOnlyView ? t("form.viewEntry") : t("form.editEntry")}: {selectedMedicationName}
		</>
	) : (
		t("form.newEntry")
	);

	return (
		<aside
			className={[classes.sidebar, viewMode === "form" ? classes.sidebarOpen : ""].filter(Boolean).join(" ")}
			data-open={viewMode === "form" ? "true" : "false"}
		>
			<SectionCard padding="md" className={classes.editorShell} contentClassName={classes.cardContent}>
				<div className={classes.header}>
					<AppButton
						type="button"
						className={classes.backButton}
						tone="secondary"
						leftSection={<ArrowLeft size={16} aria-hidden="true" />}
						onClick={onBack}
					>
						{t("common.back")}
					</AppButton>
					<h2>{title}</h2>
				</div>
				{toolbar ? <div className={classes.toolbar}>{toolbar}</div> : null}
				<form
					className={classes.form}
					onSubmit={onSubmit}
					autoComplete="off"
					spellCheck={false}
					autoCorrect="off"
					autoCapitalize="off"
				>
					<div className={classes.formBody}>{children}</div>
					{actions ? <div className={classes.formActions}>{actions}</div> : null}
				</form>
			</SectionCard>
		</aside>
	);
}
