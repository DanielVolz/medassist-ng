import { useEffect } from "react";

/**
 * Close a modal/overlay when the user presses Escape.
 *
 * Registers a document-level `keydown` listener so it works regardless
 * of which element has focus. Every modal **must** use this hook —
 * relying on `onKeyDown` on overlay divs is unreliable because those
 * handlers only fire when the overlay itself (or a descendant) has focus.
 *
 * @param active  – whether the modal is currently open
 * @param onClose – callback to close the modal
 * @param options.capture – use capture phase (default: false).
 *   Set to `true` for nested sub-modals that must intercept Escape
 *   before a parent's handler fires.
 */
export function useEscapeKey(active: boolean, onClose: () => void, options?: { capture?: boolean }): void {
	const capture = options?.capture ?? false;

	useEffect(() => {
		if (!active) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			}
		};
		document.addEventListener("keydown", handleKeyDown, capture);
		return () => document.removeEventListener("keydown", handleKeyDown, capture);
	}, [active, onClose, capture]);
}
