// =============================================================================
// ConfirmModal Component - Simple confirmation dialog
// =============================================================================

import { type ReactNode, useEffect } from "react";

export interface ConfirmModalProps {
	title: string;
	message: string | ReactNode;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	isLoading?: boolean;
	confirmVariant?: "primary" | "danger" | "success";
	overlayClassName?: string;
}

export function ConfirmModal({
	title,
	message,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
	isLoading = false,
	confirmVariant = "primary",
	overlayClassName,
}: ConfirmModalProps) {
	// Close on Escape key
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onCancel();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onCancel]);

	return (
		<div
			className={`modal-overlay${overlayClassName ? ` ${overlayClassName}` : ""}`}
			onClick={onCancel}
			onKeyDown={(e) => {
				if (e.key === "Escape") onCancel();
			}}
		>
			<div
				className="modal-content"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				style={{ maxWidth: "450px" }}
			>
				<button className="modal-close" onClick={onCancel}>
					×
				</button>
				<h2 style={{ marginBottom: "16px", paddingRight: "2rem" }}>{title}</h2>
				<div style={{ marginBottom: "24px" }}>{typeof message === "string" ? <p>{message}</p> : message}</div>
				<div className="modal-footer" style={{ padding: "1rem 0 0 0", borderTop: "none", justifyContent: "flex-end" }}>
					<button type="button" className="ghost" onClick={onCancel} disabled={isLoading}>
						{cancelLabel}
					</button>
					<button type="button" className={confirmVariant} onClick={onConfirm} disabled={isLoading}>
						{confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
}
