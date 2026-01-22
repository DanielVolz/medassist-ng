// =============================================================================
// Lightbox Component - Full-screen image viewer
// =============================================================================

import { MouseEvent } from "react";

export interface LightboxProps {
	src: string;
	alt: string;
	onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
	function handleOverlayClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	return (
		<div className="lightbox-overlay" onClick={handleOverlayClick}>
			<button className="lightbox-close" onClick={onClose}>
				×
			</button>
			<img src={src} alt={alt} className="lightbox-image" onClick={(e) => e.stopPropagation()} />
		</div>
	);
}
