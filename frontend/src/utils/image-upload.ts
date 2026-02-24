import type { TFunction } from "i18next";

export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Error codes returned by the backend image upload endpoints. */
const IMAGE_ERROR_CODE_MAP: Record<string, string> = {
	IMAGE_TOO_LARGE: "form.imageUploadErrors.tooLarge",
	INVALID_TYPE: "form.imageUploadErrors.invalidType",
	INVALID_IMAGE: "form.imageUploadErrors.invalidImage",
	NO_FILE: "form.imageUploadErrors.noFile",
	NETWORK_ERROR: "common.networkError",
};

/**
 * Maps a backend image-upload error code to a translated user-facing message.
 * Falls back to a generic error when the code is unknown.
 */
export function resolveImageUploadError(code: string, t: TFunction): string {
	const normalized = normalizeErrorCode(code);
	const key = IMAGE_ERROR_CODE_MAP[normalized];
	return key ? t(key) : t("form.imageUploadErrors.generic");
}

/** Browser network errors are not error codes — normalise them. */
function normalizeErrorCode(code: string): string {
	if (code === "Failed to fetch" || code.startsWith("NetworkError")) {
		return "NETWORK_ERROR";
	}
	return code;
}
