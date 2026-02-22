import { useEscapeKey } from "../hooks/useEscapeKey";
import { UserProfile } from "./Auth";

interface ProfileModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
	useEscapeKey(isOpen, onClose);

	if (!isOpen) return null;

	return (
		<div
			className="modal-overlay"
			onClick={onClose}
			onKeyDown={(e) => {
				if (e.key !== "Escape") e.stopPropagation();
			}}
		>
			<div
				className="modal-content profile-modal"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<button className="modal-close" onClick={onClose}>
					×
				</button>
				<UserProfile onClose={onClose} />
			</div>
		</div>
	);
}
