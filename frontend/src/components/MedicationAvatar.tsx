// =============================================================================
// MedicationAvatar Component
// =============================================================================

import { useEffect, useRef, useState } from "react";

export type MedicationAvatarProps = {
	name: string;
	imageUrl?: string | null;
	size?: "sm" | "md" | "lg";
};

export function MedicationAvatar({ name, imageUrl, size = "sm" }: MedicationAvatarProps) {
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
	const sizeClass = `med-avatar med-avatar-${size}`;

	if (imageUrl) {
		const normalizedImageUrl = imageUrl.toLowerCase();
		const shouldUseThumbFirst = normalizedImageUrl.endsWith(".webp");
		const extIndex = imageUrl.lastIndexOf(".");
		const baseName = extIndex > 0 ? imageUrl.slice(0, extIndex) : imageUrl;
		const thumbSrc = `/api/images/${baseName}-thumb.webp`;
		const fullSrc = `/api/images/${imageUrl}`;
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
	return <div className={`${sizeClass} med-avatar-initials`}>{initials}</div>;
}
