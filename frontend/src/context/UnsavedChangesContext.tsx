import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "../components/ConfirmModal";

interface UnsavedChangesContextValue {
	/** Whether there are unsaved changes anywhere in the app */
	hasUnsavedChanges: boolean;
	/** Register that a component has unsaved changes */
	setHasUnsavedChanges: (value: boolean) => void;
	/** Check and confirm navigation - returns a promise that resolves to true if navigation should proceed */
	confirmNavigation: () => Promise<boolean>;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
	const { t } = useTranslation();
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [showConfirmModal, setShowConfirmModal] = useState(false);
	const [pendingResolve, setPendingResolve] = useState<((value: boolean) => void) | null>(null);

	const confirmNavigation = useCallback((): Promise<boolean> => {
		if (!hasUnsavedChanges) {
			return Promise.resolve(true);
		}

		return new Promise((resolve) => {
			setPendingResolve(() => resolve);
			setShowConfirmModal(true);
		});
	}, [hasUnsavedChanges]);

	const handleConfirm = useCallback(() => {
		setShowConfirmModal(false);
		if (pendingResolve) {
			pendingResolve(true);
			setPendingResolve(null);
		}
	}, [pendingResolve]);

	const handleCancel = useCallback(() => {
		setShowConfirmModal(false);
		if (pendingResolve) {
			pendingResolve(false);
			setPendingResolve(null);
		}
	}, [pendingResolve]);

	return (
		<UnsavedChangesContext.Provider value={{ hasUnsavedChanges, setHasUnsavedChanges, confirmNavigation }}>
			{children}
			{showConfirmModal && (
				<ConfirmModal
					title={t("common.unsavedChanges.title", "Unsaved Changes")}
					message={t("common.unsavedChanges.message")}
					confirmLabel={t("common.unsavedChanges.leave", "Leave")}
					cancelLabel={t("common.unsavedChanges.stay", "Stay")}
					onConfirm={handleConfirm}
					onCancel={handleCancel}
					confirmVariant="danger"
				/>
			)}
		</UnsavedChangesContext.Provider>
	);
}

export function useUnsavedChanges() {
	const context = useContext(UnsavedChangesContext);
	if (!context) {
		throw new Error("useUnsavedChanges must be used within UnsavedChangesProvider");
	}
	return context;
}
