// =============================================================================
// MedicationAvatar Component
// =============================================================================

export type MedicationAvatarProps = {
	name: string;
	imageUrl?: string | null;
	size?: "sm" | "md" | "lg";
};

export function MedicationAvatar({ name, imageUrl, size = "sm" }: MedicationAvatarProps) {
	const initials =
		name
			.split(" ")
			.map((w) => w[0])
			.join("")
			.toUpperCase()
			.slice(0, 2) || "?";
	const sizeClass = `med-avatar med-avatar-${size}`;

	if (imageUrl) {
		return <img src={`/api/images/${imageUrl}`} alt={name} className={sizeClass} />;
	}
	return <div className={`${sizeClass} med-avatar-initials`}>{initials}</div>;
}
