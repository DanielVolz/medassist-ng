import { Stack, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { AppButton } from "../primitives/AppButton";
import { AppModal, AppModalFooter } from "./AppModal";

interface ConfirmActionModalProps {
	opened: boolean;
	title: string;
	message: ReactNode;
	confirmLabel: string;
	cancelLabel: string;
	onConfirm: () => void;
	onCancel: () => void;
	confirmTone?: "primary" | "danger";
}

export function ConfirmActionModal({
	opened,
	title,
	message,
	confirmLabel,
	cancelLabel,
	onConfirm,
	onCancel,
	confirmTone = "primary",
}: ConfirmActionModalProps) {
	return (
		<AppModal onClose={onCancel} opened={opened} title={title}>
			<Stack gap="lg">
				{typeof message === "string" ? <Text>{message}</Text> : message}
				<AppModalFooter>
					<AppButton tone="ghost" type="button" onClick={onCancel}>
						{cancelLabel}
					</AppButton>
					<AppButton tone={confirmTone} type="button" onClick={onConfirm}>
						{confirmLabel}
					</AppButton>
				</AppModalFooter>
			</Stack>
		</AppModal>
	);
}
