import type React from "react";
import { useTranslation } from "react-i18next";

type MedicationEditCoordinatorProps = {
	viewMode: "grid" | "form";
	editingId: number | null;
	readOnlyView: boolean;
	selectedMedicationName?: string;
	onBack: () => void;
	onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
	children: React.ReactNode;
};

export function MedicationEditCoordinator({
	viewMode,
	editingId,
	readOnlyView,
	selectedMedicationName,
	onBack,
	onSubmit,
	children,
}: MedicationEditCoordinatorProps) {
	const { t } = useTranslation();

	return (
		<aside className={`edit-sidebar desktop-only${viewMode === "form" ? " open" : ""}`}>
			<article className="card form">
				<div className="card-head">
					<div className="edit-header">
						<button type="button" className="ghost small btn-nav" onClick={onBack}>
							{"<-"} {t("common.back")}
						</button>
						{editingId ? (
							<h2>
								{readOnlyView ? t("form.viewEntry") : t("form.editEntry")}: {selectedMedicationName}
							</h2>
						) : (
							<h2>{t("form.newEntry")}</h2>
						)}
					</div>
				</div>
				<form
					className="form-grid"
					onSubmit={onSubmit}
					autoComplete="off"
					spellCheck={false}
					autoCorrect="off"
					autoCapitalize="off"
				>
					{children}
				</form>
			</article>
		</aside>
	);
}
