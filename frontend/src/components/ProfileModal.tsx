import { useTranslation } from 'react-i18next';
import { UserProfile } from './Auth';

interface ProfileModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
	const { t } = useTranslation();

	if (!isOpen) return null;

	return (
		<div className="modal-overlay" onClick={onClose}>
			<div className="modal-content profile-modal" onClick={(e) => e.stopPropagation()}>
				<button className="modal-close" onClick={onClose}>×</button>
				<UserProfile onClose={onClose} />
			</div>
		</div>
	);
}
