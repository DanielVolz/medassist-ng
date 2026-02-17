// =============================================================================
// Lightbox Component - Full-screen image viewer
// =============================================================================

import type { MouseEvent } from "react";

export interface LightboxProps {
	src: string;
	alt: string;
	onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
	function handleOverlayClick(e: MouseEvent) {
		e.stopPropagation();
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	return (
		<div
			className="lightbox-overlay"
			onClick={handleOverlayClick}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
		>
			<div className="lightbox-container">
				<button className="lightbox-close" onClick={onClose}>
					×
				</button>
				<img
					src={src}
					alt={alt}
					className="lightbox-image"
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => e.stopPropagation()}
				/>
			</div>
		</div>
	);
}
