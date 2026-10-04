import { useTranslation } from "react-i18next";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { UserProfile } from "./Auth";
import classes from "./ProfileModal.module.css";

interface ProfileModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
	const { t } = useTranslation();
	// ESC is handled by the global handler in App.tsx to avoid double history.back()

	if (!isOpen) return null;

	return (
		<AppModal
			centered
			classNames={{
				body: classes.body,
				content: classes.modal,
				header: classes.header,
				title: classes.title,
			}}
			closeButtonProps={{ "aria-label": t("common.close") }}
			lockScroll={false}
			manageEscape={false}
			manageScrollLock={false}
			onClose={onClose}
			opened={isOpen}
			size={420}
			title={t("auth.profile")}
			withCloseButton
		>
			<UserProfile onClose={onClose} showFooter={false} />
			<AppModalFooter>
				<AppButton type="button" tone="secondary" onClick={onClose}>
					{t("common.close", "Close")}
				</AppButton>
			</AppModalFooter>
		</AppModal>
	);
}
