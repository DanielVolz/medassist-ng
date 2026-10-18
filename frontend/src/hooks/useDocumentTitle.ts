import { useEffect } from "react";
import { useTranslation } from "react-i18next";

/**
 * WCAG 2.1 Level A (2.4.2 Page Titled): Set document title dynamically per route.
 *
 * Screen readers announce the page title on navigation, and browser tabs show
 * distinct titles for each page, making it easier to identify pages.
 *
 * @param titleKey - i18n key for the page title (e.g., "nav.dashboard")
 *
 * @example
 * ```tsx
 * export function DashboardPage() {
 *   useDocumentTitle('nav.dashboard');  // → "Dashboard - MedAssist"
 *   return <div>...</div>;
 * }
 * ```
 */
export function useDocumentTitle(titleKey: string) {
	const { t } = useTranslation();

	useEffect(() => {
		const pageTitle = t(titleKey);
		document.title = `${pageTitle} - MedAssist`;

		// Cleanup: Reset to base title on unmount
		return () => {
			document.title = "MedAssist";
		};
	}, [titleKey, t]);
}
