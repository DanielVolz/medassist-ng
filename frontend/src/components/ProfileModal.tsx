import { UserProfile } from "./Auth";
import { ModalFrame } from "./ModalFrame";

interface ProfileModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
	// ESC is handled by the global handler in App.tsx to avoid double history.back()

	if (!isOpen) return null;

	return (
		<ModalFrame contentClassName="profile-modal" onClose={onClose}>
			<UserProfile onClose={onClose} />
		</ModalFrame>
	);
}
