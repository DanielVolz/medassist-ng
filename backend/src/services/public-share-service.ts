import type { shareTokens } from "../db/schema.js";

type SharePermissions = {
	allowJournalNotes?: boolean | null;
	allowMarkTaken?: boolean | null;
};

export function getPublicShareLanguage(language: string | null | undefined): "en" | "de" {
	return language === "de" ? "de" : "en";
}

export function getPublicShareOwnerName(
	username: string | null | undefined,
	fallback: string | null = null
): string | null {
	return username ?? fallback;
}

export function getPublicSharePermissions(share: SharePermissions): {
	allowJournalNotes: boolean;
	allowMarkTaken: boolean;
} {
	return {
		allowJournalNotes: share.allowJournalNotes ?? false,
		allowMarkTaken: share.allowMarkTaken ?? true,
	};
}

export function getPublicShareContext(options: {
	share: Pick<typeof shareTokens.$inferSelect, "takenBy" | "scheduleDays" | "allowJournalNotes" | "allowMarkTaken">;
	ownerUsername: string | null | undefined;
	language: string | null | undefined;
}): {
	takenBy: string;
	sharedBy: string | null;
	language: "en" | "de";
	scheduleDays: number;
	allowJournalNotes: boolean;
	allowMarkTaken: boolean;
} {
	return {
		takenBy: options.share.takenBy,
		sharedBy: getPublicShareOwnerName(options.ownerUsername),
		language: getPublicShareLanguage(options.language),
		scheduleDays: options.share.scheduleDays,
		...getPublicSharePermissions(options.share),
	};
}
