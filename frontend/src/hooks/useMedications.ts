import { useCallback, useState } from "react";
import type { Medication } from "../types";

export interface UseMedicationsReturn {
	meds: Medication[];
	setMeds: React.Dispatch<React.SetStateAction<Medication[]>>;
	loading: boolean;
	saving: boolean;
	setSaving: React.Dispatch<React.SetStateAction<boolean>>;
	uploadingImage: boolean;
	loadMeds: () => void;
	deleteMed: (id: number, editingId: number | null, resetForm: () => void) => Promise<void>;
	uploadMedImage: (medId: number, file: File) => Promise<void>;
	deleteMedImage: (medId: number) => Promise<void>;
}

export function useMedications(): UseMedicationsReturn {
	const [meds, setMeds] = useState<Medication[]>([]);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);
	const [uploadingImage, setUploadingImage] = useState(false);

	const loadMeds = useCallback(() => {
		setLoading(true);
		fetch("/api/medications?includeObsolete=true", { credentials: "include" })
			.then((res) => res.json())
			.then((data) => setMeds(Array.isArray(data) ? data : []))
			.catch(() => setMeds([]))
			.finally(() => setLoading(false));
	}, []);

	const deleteMed = useCallback(
		async (id: number, editingId: number | null, resetForm: () => void) => {
			await fetch(`/api/medications/${id}`, { method: "DELETE", credentials: "include" }).catch(() => null);
			if (editingId === id) resetForm();
			loadMeds();
		},
		[loadMeds]
	);

	const uploadMedImage = useCallback(
		async (medId: number, file: File) => {
			setUploadingImage(true);
			const formData = new FormData();
			formData.append("file", file);

			try {
				const res = await fetch(`/api/medications/${medId}/image`, {
					method: "POST",
					body: formData,
					credentials: "include",
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
		[loadMeds]
	);

	const deleteMedImage = useCallback(
		async (medId: number) => {
			await fetch(`/api/medications/${medId}/image`, { method: "DELETE", credentials: "include" }).catch(() => null);
			loadMeds();
		},
		[loadMeds]
	);

	return {
		meds,
		setMeds,
		loading,
		saving,
		setSaving,
		uploadingImage,
		loadMeds,
		deleteMed,
		uploadMedImage,
		deleteMedImage,
	};
}
