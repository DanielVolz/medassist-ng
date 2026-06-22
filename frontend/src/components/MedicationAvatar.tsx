// =============================================================================
// MedicationAvatar Component
// =============================================================================

import { useEffect, useRef, useState } from "react";
import classes from "./MedicationAvatar.module.css";

export type MedicationAvatarProps = {
	name: string;
	imageUrl?: string | null;
	size?: "sm" | "md" | "lg";
	imageSrcResolver?: (filename: string) => string;
};

export function MedicationAvatar({ name, imageUrl, size = "sm", imageSrcResolver }: MedicationAvatarProps) {
	const [thumbFailed, setThumbFailed] = useState(false);
	const previousImageUrlRef = useRef(imageUrl);

	useEffect(() => {
		if (previousImageUrlRef.current === imageUrl) return;
		previousImageUrlRef.current = imageUrl;
		setThumbFailed(false);
	}, [imageUrl]);

	const initials =
		name
			.split(" ")
			.map((w) => w[0])
			.join("")
			.toUpperCase()
			.slice(0, 2) || "?";
	const sizeClass = [classes.avatar, classes[size], "med-avatar", `med-avatar-${size}`].join(" ");

	if (imageUrl) {
		const normalizedImageUrl = imageUrl.toLowerCase();
		const shouldUseThumbFirst = normalizedImageUrl.endsWith(".webp");
		const extIndex = imageUrl.lastIndexOf(".");
		const baseName = extIndex > 0 ? imageUrl.slice(0, extIndex) : imageUrl;
		const resolveImageSrc = imageSrcResolver ?? ((filename: string) => `/api/images/${encodeURIComponent(filename)}`);
		const thumbSrc = resolveImageSrc(`${baseName}-thumb.webp`);
		const fullSrc = resolveImageSrc(imageUrl);
		const resolvedSrc = shouldUseThumbFirst && !thumbFailed ? thumbSrc : fullSrc;

		return (
			<img
				src={resolvedSrc}
				alt={name}
				className={sizeClass}
				loading="lazy"
				decoding="async"
				onError={() => {
					if (shouldUseThumbFirst && !thumbFailed) setThumbFailed(true);
				}}
			/>
		);
	}
	return <div className={`${sizeClass} ${classes.initials} med-avatar-initials`}>{initials}</div>;
}
