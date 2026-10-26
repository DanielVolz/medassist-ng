// =============================================================================
// ConfirmModal Component - Simple confirmation dialog
// =============================================================================

import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";

export interface ConfirmModalProps {
	opened?: boolean;
	title: string;
	message: string | ReactNode;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	isLoading?: boolean;
	confirmVariant?: "primary" | "danger" | "success" | "warning";
	overlayClassName?: string;
	captureEscape?: boolean;
	onExitTransitionEnd?: () => void;
}

export function ConfirmModal({
	opened = true,
	title,
	message,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
	isLoading = false,
	confirmVariant = "primary",
	overlayClassName,
	captureEscape = false,
	onExitTransitionEnd,
}: ConfirmModalProps) {
	const { t } = useTranslation();
	useEscapeKey(captureEscape, onCancel, { capture: true });
	return (
		<AppModal
			closeButtonProps={{ "aria-label": t("common.close"), disabled: captureEscape && isLoading }}
			closeOnEscape={false}
			manageEscape={!captureEscape}
			onClose={onCancel}
			opened={opened}
			onExitTransitionEnd={onExitTransitionEnd}
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
