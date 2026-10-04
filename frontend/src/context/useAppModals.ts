import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModalHistory } from "../hooks/useModalHistory";
import type { useRefill } from "../hooks/useRefill";
import type { Medication } from "../types";

type AppModalsOptions = {
	meds: Medication[];
	refill: Pick<ReturnType<typeof useRefill>, "setRefillHistoryExpanded" | "loadRefillHistory">;
};

/** App-owned modal state; browser navigation is owned exclusively by useModalHistory. */
export function useAppModals({ meds, refill }: AppModalsOptions) {
	const [selectedMed, setSelectedMed] = useState<Medication | null>(null);
	const selectedMedIdRef = useRef<number | null>(null);
	useEffect(() => {
		selectedMedIdRef.current = selectedMed?.id ?? null;
	}, [selectedMed]);
	const [showImageLightbox, setShowImageLightbox] = useState(false);
	const [scheduleLightboxImage, setScheduleLightboxImage] = useState<string | null>(null);
	const [selectedUser, setSelectedUser] = useState<string | null>(null);
	const dismissMedDetail = useCallback(() => {
		selectedMedIdRef.current = null;
		setSelectedMed(null);
	}, []);
	const dismissImageLightbox = useCallback(() => setShowImageLightbox(false), []);
	const dismissScheduleLightbox = useCallback(() => setScheduleLightboxImage(null), []);
	const dismissUserFilter = useCallback(() => setSelectedUser(null), []);
	const medDetailHistoryState = useMemo(() => (selectedMed ? { medId: selectedMed.id } : undefined), [selectedMed]);
	const userFilterHistoryState = useMemo(() => (selectedUser ? { person: selectedUser } : undefined), [selectedUser]);
	const { closeModal: closeMedDetail } = useModalHistory(Boolean(selectedMed), "medDetail", dismissMedDetail, {
		state: medDetailHistoryState,
		minOpenMs: 320,
	});
	const { closeModal: closeImageLightbox } = useModalHistory(showImageLightbox, "imageLightbox", dismissImageLightbox, {
		minOpenMs: 320,
	});
	const { closeModal: closeScheduleLightbox } = useModalHistory(
		Boolean(scheduleLightboxImage),
		"scheduleLightbox",
		dismissScheduleLightbox,
		{ minOpenMs: 320 }
	);
	const { closeModal: closeUserFilter } = useModalHistory(Boolean(selectedUser), "userFilter", dismissUserFilter, {
		state: userFilterHistoryState,
	});

	const resetModalState = useCallback(() => {
		selectedMedIdRef.current = null;
		setSelectedMed(null);
		setShowImageLightbox(false);
		setScheduleLightboxImage(null);
		setSelectedUser(null);
	}, []);

	// Keep the open detail current after refill/stock updates without reopening it.
	useEffect(() => {
		if (!selectedMed) return;
		const updated = meds.find((med) => med.id === selectedMed.id);
		if (
			updated &&
			(updated.packCount !== selectedMed.packCount ||
				updated.looseTablets !== selectedMed.looseTablets ||
				updated.updatedAt !== selectedMed.updatedAt)
		) {
			setSelectedMed(updated);
		}
	}, [meds, selectedMed]);

	const openMedDetail = useCallback(
		(med: Medication) => {
			if (selectedMedIdRef.current === med.id) return;
			selectedMedIdRef.current = med.id;
			setSelectedMed(med);
			refill.setRefillHistoryExpanded(false);
			refill.loadRefillHistory(med.id);
		},
		[refill]
	);
	const openImageLightbox = useCallback(() => {
		if (showImageLightbox) return;
		setShowImageLightbox(true);
	}, [showImageLightbox]);
	const openScheduleLightbox = useCallback(
		(imageUrl: string) => {
			if (scheduleLightboxImage) return;
			setScheduleLightboxImage(imageUrl);
		},
		[scheduleLightboxImage]
	);
	const openUserFilter = useCallback(
		(person: string) => {
			if (selectedUser === person) return;
			setSelectedUser(person);
		},
		[selectedUser]
	);

	return {
		selectedMed,
		setSelectedMed,
		showImageLightbox,
		setShowImageLightbox,
		scheduleLightboxImage,
		setScheduleLightboxImage,
		selectedUser,
		setSelectedUser,
		openMedDetail,
		closeMedDetail,
		openImageLightbox,
		closeImageLightbox,
		openScheduleLightbox,
		closeScheduleLightbox,
		openUserFilter,
		closeUserFilter,
		resetModalState,
	};
}
