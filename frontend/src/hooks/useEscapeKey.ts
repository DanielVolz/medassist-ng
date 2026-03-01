import { useEffect, useRef } from "react";

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
	const activeRef = useRef(active);
	const onCloseRef = useRef(onClose);

	// Keep refs in sync without re-registering the listener
	activeRef.current = active;
	onCloseRef.current = onClose;

	useEffect(() => {
		if (!active) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape" && activeRef.current) {
				if (capture) {
					// In nested modals, consume Escape so parent/global handlers
					// do not process the same key press again.
					e.preventDefault();
					e.stopPropagation();
				}
				onCloseRef.current();
			}
		};
		document.addEventListener("keydown", handleKeyDown, capture);
		return () => document.removeEventListener("keydown", handleKeyDown, capture);
	}, [active, capture]);
}
