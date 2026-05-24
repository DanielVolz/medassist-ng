import { useEffect, useRef } from "react";

/**
 * Push a history entry when a modal opens so the browser back button closes it.
 * On popstate (back), calls `onClose` to dismiss the modal.
 */
export function useModalHistory(isOpen: boolean, modalKey: string, onClose: () => void) {
	const pushedRef = useRef(false);

	useEffect(() => {
		if (isOpen) {
			window.history.pushState({ modal: modalKey }, "");
			pushedRef.current = true;
		} else if (pushedRef.current) {
			pushedRef.current = false;
		}
	}, [isOpen, modalKey]);

	useEffect(() => {
		if (!isOpen) return;

		const handlePopState = (event: PopStateEvent) => {
			if (pushedRef.current) {
				pushedRef.current = false;
				onClose();
				event.stopImmediatePropagation();
			}
		};

		window.addEventListener("popstate", handlePopState, { capture: true });
		return () => window.removeEventListener("popstate", handlePopState, true);
	}, [isOpen, onClose]);
}
