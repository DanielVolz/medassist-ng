// =============================================================================
// Lightbox Component - Full-screen image viewer
// =============================================================================

import { X } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useScrollLock } from "../hooks/useScrollLock";
import { AppButton } from "../ui/primitives/AppButton";
import classes from "./Lightbox.module.css";

export interface LightboxProps {
	src: string;
	alt: string;
	onClose: () => void;
}

export function Lightbox({ src, alt, onClose }: LightboxProps) {
	const { t } = useTranslation();

	useEscapeKey(true, onClose);
	useScrollLock(true);

	function handleOverlayClick(e: MouseEvent) {
		e.stopPropagation();
		if (e.target === e.currentTarget) {
			onClose();
		}
	}

	return (
		<div
			className={classes.overlay}
			onClick={handleOverlayClick}
			onKeyDown={(e) => {
				if (e.key !== "Escape") e.stopPropagation();
			}}
		>
			<div className={classes.container}>
				<AppButton
					aria-label={t("common.close")}
					className={classes.close}
					onClick={onClose}
					size="sm"
					tone="ghost"
					type="button"
				>
					<X size={18} aria-hidden="true" />
				</AppButton>
				<img
					src={src}
					alt={alt}
					className={classes.image}
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.key !== "Escape") e.stopPropagation();
					}}
				/>
			</div>
		</div>
	);
}
