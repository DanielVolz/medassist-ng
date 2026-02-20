// =============================================================================
// Lightbox Component - Full-screen image viewer
// =============================================================================

import type { MouseEvent } from "react";
import { useEffect } from "react";

export interface LightboxProps {
	src: string;
	alt: string;
	onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	function handleOverlayClick(e: MouseEvent) {
		e.stopPropagation();
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	return (
		<div className="lightbox-overlay" onClick={handleOverlayClick}>
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
