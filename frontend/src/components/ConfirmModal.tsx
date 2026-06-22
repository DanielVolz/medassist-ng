// =============================================================================
// ConfirmModal Component - Simple confirmation dialog
// =============================================================================

import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";

export interface ConfirmModalProps {
	title: string;
	message: string | ReactNode;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	isLoading?: boolean;
	confirmVariant?: "primary" | "danger" | "success" | "warning";
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
	return (
		<AppModal
			closeButtonProps={{ "aria-label": "Close" }}
			onClose={onCancel}
			opened
			rootClassName={overlayClassName}
			size="sm"
			title={title}
			withCloseButton
		>
			<Stack gap="lg">
				{typeof message === "string" ? <Text>{message}</Text> : message}
				<AppModalFooter>
					<AppButton
						type="button"
						tone="secondary"
						onClick={onCancel}
						disabled={isLoading}
						data-testid="confirm-modal-cancel"
					>
						{cancelLabel}
					</AppButton>
					<AppButton
						type="button"
						tone={confirmVariant}
						onClick={onConfirm}
						disabled={isLoading}
						data-confirm-variant={confirmVariant}
						data-testid="confirm-modal-confirm"
					>
						{confirmLabel}
					</AppButton>
				</AppModalFooter>
			</Stack>
		</AppModal>
	);
}
