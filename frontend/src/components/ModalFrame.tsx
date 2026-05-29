import type { KeyboardEvent, ReactNode } from "react";

interface ModalFrameProps {
	children: ReactNode;
	contentClassName: string;
	onClose: () => void;
	closeButton?: ReactNode;
}

function containNonEscapeKeys(event: KeyboardEvent) {
	if (event.key !== "Escape") event.stopPropagation();
}

export function ModalFrame({ children, contentClassName, onClose, closeButton }: ModalFrameProps) {
	return (
		<div className="modal-overlay" onClick={onClose} onKeyDown={containNonEscapeKeys}>
			<div
				className={`modal-content ${contentClassName}`}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={containNonEscapeKeys}
			>
				{closeButton ?? (
					<button type="button" className="modal-close" onClick={onClose}>
						×
					</button>
				)}
				{children}
			</div>
		</div>
	);
}
