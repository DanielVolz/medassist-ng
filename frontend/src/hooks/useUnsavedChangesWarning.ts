import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export interface UseUnsavedChangesWarningReturn {
	/** Whether there are unsaved changes */
	hasUnsavedChanges: boolean;
}

/**
 * Hook that warns users when trying to close the browser/tab with unsaved changes.
 * For in-app navigation, use manual confirmation checks in your components.
 */
export function useUnsavedChangesWarning(hasUnsavedChanges: boolean): UseUnsavedChangesWarningReturn {
	const { t } = useTranslation();

	// Handle browser refresh/close
	useEffect(() => {
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (hasUnsavedChanges) {
				e.preventDefault();
				// Modern browsers ignore custom messages, but we still need to set returnValue
				e.returnValue = t("common.unsavedChanges.message");
				return e.returnValue;
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [hasUnsavedChanges, t]);

	return { hasUnsavedChanges };
}
