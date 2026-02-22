import { useEffect, useRef } from "react";

/**
 * Lock background scrolling when a modal/overlay is visible.
 *
 * Uses the `position: fixed` technique to prevent scroll on iOS Safari
 * and other browsers where `overflow: hidden` alone is insufficient.
 * Saves and restores the scroll position on cleanup so users don't
 * lose their place.
 *
 * Supports nesting: a scroll-lock counter prevents premature unlock
 * when multiple modals stack (e.g. MedDetail → RefillModal).
 */

let lockCount = 0;
let savedScrollY = 0;

export function useScrollLock(active: boolean): void {
	const wasActive = useRef(false);

	useEffect(() => {
		if (active && !wasActive.current) {
			wasActive.current = true;
			const html = document.documentElement;
			const body = document.body;

			if (lockCount === 0) {
				savedScrollY = window.scrollY;
				html.classList.add("modal-open");
				html.style.overflow = "hidden";
				html.style.overscrollBehavior = "none";
				body.classList.add("modal-open");
				body.style.overflow = "hidden";
				body.style.position = "fixed";
				body.style.top = `-${savedScrollY}px`;
				body.style.left = "0";
				body.style.right = "0";
				body.style.width = "100%";
				body.style.overscrollBehavior = "none";
			}
			lockCount++;
		}

		if (!active && wasActive.current) {
			wasActive.current = false;
			lockCount--;
			if (lockCount <= 0) {
				lockCount = 0;
				unlock();
			}
		}

		return () => {
			if (wasActive.current) {
				wasActive.current = false;
				lockCount--;
				if (lockCount <= 0) {
					lockCount = 0;
					unlock();
				}
			}
		};
	}, [active]);
}

function unlock(): void {
	const html = document.documentElement;
	const body = document.body;
	html.classList.remove("modal-open");
	html.style.overflow = "";
	html.style.overscrollBehavior = "";
	body.classList.remove("modal-open");
	body.style.overflow = "";
	body.style.position = "";
	body.style.top = "";
	body.style.left = "";
	body.style.right = "";
	body.style.width = "";
	body.style.overscrollBehavior = "";
	window.scrollTo(0, savedScrollY);
}
