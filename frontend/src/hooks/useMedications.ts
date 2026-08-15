import { useCallback, useState } from "react";
import { useAuth } from "../components/Auth";
import type { Medication } from "../types";
import { log } from "../utils/logger";

export interface UseMedicationsReturn {
	meds: Medication[];
	setMeds: React.Dispatch<React.SetStateAction<Medication[]>>;
	loading: boolean;
	saving: boolean;
	setSaving: React.Dispatch<React.SetStateAction<boolean>>;
	uploadingImage: boolean;
	clearMedicationsState: () => void;
	loadMeds: (options?: { silent?: boolean }) => Promise<void>;
	deleteMed: (id: number, editingId: number | null, resetForm: () => void) => Promise<void>;
	uploadMedImage: (medId: number, file: File) => Promise<void>;
	deleteMedImage: (medId: number) => Promise<void>;
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function useMedications(): UseMedicationsReturn {
	const { authFetch } = useAuth();
	const [meds, setMeds] = useState<Medication[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [uploadingImage, setUploadingImage] = useState(false);

	const clearMedicationsState = useCallback(() => {
		setMeds([]);
		setLoading(false);
		setSaving(false);
		setUploadingImage(false);
	}, []);

	const loadMeds = useCallback(
		async ({ silent = false }: { silent?: boolean } = {}) => {
			if (!silent) setLoading(true);

			try {
				const res = await authFetch("/api/medications?includeObsolete=true");
				if (!res.ok) {
					throw new Error(`HTTP ${res.status}`);
				}

				const data = await res.json();
				setMeds(Array.isArray(data) ? data : []);
			} catch (error: unknown) {
				log.warn("[useMedications] load medications failed", { error: getErrorMessage(error) });
				if (!silent) setMeds([]);
			} finally {
				if (!silent) setLoading(false);
			}
		},
		[authFetch]
	);

	const deleteMed = useCallback(
		async (id: number, editingId: number | null, resetForm: () => void) => {
			try {
				const response = await authFetch(`/api/medications/${id}`, { method: "DELETE" });
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
			} catch (error) {
				log.warn("[useMedications] delete medication failed", { medicationId: id, error: getErrorMessage(error) });
			}
			if (editingId === id) resetForm();
			loadMeds();
		},
		[authFetch, loadMeds]
	);

	const uploadMedImage = useCallback(
		async (medId: number, file: File) => {
			setUploadingImage(true);
			const formData = new FormData();
			formData.append("file", file);

			try {
				const res = await authFetch(`/api/medications/${medId}/image`, {
					method: "POST",
					body: formData,
				});
				if (!res.ok) {
					let code = "UNKNOWN";
					try {
						const errorBody = (await res.json()) as { code?: string };
						if (typeof errorBody?.code === "string" && errorBody.code.trim().length > 0) {
							code = errorBody.code;
						}
					} catch {
						// Keep fallback code when backend response has no JSON body.
					}
					throw new Error(code);
				}

				loadMeds();
			} catch (error) {
				if (error instanceof Error) {
					// Network failures (fetch itself throws) produce browser-specific messages.
					// Normalise to NETWORK_ERROR code so the UI can map to a translated string.
					if (error.message === "Failed to fetch" || error.message.startsWith("NetworkError")) {
						throw new Error("NETWORK_ERROR");
					}
					throw error;
				}
				throw new Error("UNKNOWN");
			} finally {
				setUploadingImage(false);
			}
		},
		[authFetch, loadMeds]
	);

	const deleteMedImage = useCallback(
		async (medId: number) => {
			try {
				const response = await authFetch(`/api/medications/${medId}/image`, { method: "DELETE" });
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
			} catch (error) {
				log.warn("[useMedications] delete medication image failed", {
					medicationId: medId,
					error: getErrorMessage(error),
				});
			}
			loadMeds();
		},
		[authFetch, loadMeds]
	);

	return {
		meds,
		setMeds,
		loading,
		saving,
		setSaving,
		uploadingImage,
		clearMedicationsState,
		loadMeds,
		deleteMed,
		uploadMedImage,
		deleteMedImage,
	};
}
