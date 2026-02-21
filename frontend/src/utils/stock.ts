import type { Medication } from "../types";

export type BlisterStockSplit = {
	fullBlisters: number;
	openBlisterPills: number;
	loosePills: number;
};

/**
 * Split current blister stock into sealed full blisters, open blister pills,
 * and loose pills using the configured loose-tablets baseline.
 */
export function splitCurrentBlisterStock(
	currentPills: number,
	pillsPerBlister: number,
	configuredLooseTablets: number
): BlisterStockSplit {
	if (pillsPerBlister <= 0 || pillsPerBlister === 1) {
		return { fullBlisters: 0, openBlisterPills: 0, loosePills: Math.max(0, currentPills) };
	}

	const safeCurrent = Math.max(0, currentPills);
	const loosePills = Math.min(safeCurrent, Math.max(0, configuredLooseTablets));
	const sealedPills = Math.max(0, safeCurrent - loosePills);

	return {
		fullBlisters: Math.floor(sealedPills / pillsPerBlister),
		openBlisterPills: sealedPills % pillsPerBlister,
		loosePills,
	};
}

/**
 * Convenience helper when medication object already contains stock fields.
 */
export function getBlisterStockFromMedication(med: Medication): BlisterStockSplit {
	const total =
		(med.packageType === "bottle"
			? med.looseTablets + (med.stockAdjustment ?? 0)
			: med.packCount * med.blistersPerPack * med.pillsPerBlister + med.looseTablets + (med.stockAdjustment ?? 0)) ?? 0;

	return splitCurrentBlisterStock(total, med.pillsPerBlister, med.looseTablets);
}
