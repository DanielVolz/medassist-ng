import { useCallback, useEffect, useRef } from "react";

type ModalHistoryOptions = {
	state?: Record<string, unknown>;
	minOpenMs?: number;
};

type ModalHistoryController = {
	closeModal: () => void;
};

const modalStack: symbol[] = [];

// Programmatic closeModal() pops its own history entry via history.back().
// The resulting popstate must NOT be claimed by the next modal on the stack
// (e.g. closing a nested refill modal must not also close the underlying
// medication detail modal). Mark such pops so handlers can swallow them.
let pendingProgrammaticPops = 0;
let pendingProgrammaticPopsExpiry = 0;

function markProgrammaticPop() {
	pendingProgrammaticPops += 1;
	pendingProgrammaticPopsExpiry = Date.now() + 1000;
}

function consumeProgrammaticPop(): boolean {
	if (pendingProgrammaticPops > 0) {
		if (Date.now() <= pendingProgrammaticPopsExpiry) {
			pendingProgrammaticPops -= 1;
			return true;
		}
		pendingProgrammaticPops = 0;
	}
	return false;
}

// A new history push means any still-pending programmatic pop marker is stale
// (its popstate would have arrived before another modal could open).
function clearPendingProgrammaticPops() {
	pendingProgrammaticPops = 0;
}

function removeFromStack(id: symbol) {
	const index = modalStack.lastIndexOf(id);
	if (index >= 0) {
		modalStack.splice(index, 1);
	}
}

function isTopModal(id: symbol) {
	return modalStack[modalStack.length - 1] === id;
}

/**
 * Push a history entry when a modal opens so the browser back button closes it.
 * On popstate (back), calls `onClose` to dismiss the modal.
 */
export function useModalHistory(
	isOpen: boolean,
	modalKey: string,
	onClose: () => void,
	options: ModalHistoryOptions = {}
): ModalHistoryController {
	const pushedRef = useRef(false);
	const openedAtRef = useRef(0);
	const idRef = useRef(Symbol(modalKey));
	const onCloseRef = useRef(onClose);
	const stateRef = useRef(options.state);

	onCloseRef.current = onClose;
	stateRef.current = options.state;

	useEffect(() => {
		if (isOpen) {
			if (!pushedRef.current) {
				clearPendingProgrammaticPops();
				window.history.pushState({ modal: modalKey, ...stateRef.current }, "");
				pushedRef.current = true;
				openedAtRef.current = Date.now();
				modalStack.push(idRef.current);
			}

			return () => {
				removeFromStack(idRef.current);
			};
		}

		pushedRef.current = false;
		removeFromStack(idRef.current);
	}, [isOpen, modalKey]);

	const closeModal = useCallback(() => {
		if (!isOpen || !pushedRef.current) return;
		if (options.minOpenMs && Date.now() - openedAtRef.current < options.minOpenMs) return;

		pushedRef.current = false;
		removeFromStack(idRef.current);
		onCloseRef.current();
		// Pop this modal's own history entry without letting the resulting
		// popstate close the next modal on the stack.
		markProgrammaticPop();
		window.history.back();
	}, [isOpen, options.minOpenMs]);

	useEffect(() => {
		if (!isOpen) return;

		const handlePopState = (event: PopStateEvent) => {
			// Swallow popstates produced by closeModal(); they are already handled.
			if (consumeProgrammaticPop()) {
				event.stopImmediatePropagation();
				return;
			}
			if (!pushedRef.current || !isTopModal(idRef.current)) return;

			pushedRef.current = false;
			removeFromStack(idRef.current);
			onCloseRef.current();
			event.stopImmediatePropagation();
		};

		window.addEventListener("popstate", handlePopState, { capture: true });
		return () => window.removeEventListener("popstate", handlePopState, true);
	}, [isOpen]);

	return { closeModal };
}
