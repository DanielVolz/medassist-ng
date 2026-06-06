import { useCallback, useEffect, useRef } from "react";

type ModalHistoryOptions = {
	state?: Record<string, unknown>;
	minOpenMs?: number;
};

type ModalHistoryController = {
	closeModal: () => void;
};

const modalStack: symbol[] = [];

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
		window.history.back();
	}, [isOpen, options.minOpenMs]);

	useEffect(() => {
		if (!isOpen) return;

		const handlePopState = (event: PopStateEvent) => {
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
