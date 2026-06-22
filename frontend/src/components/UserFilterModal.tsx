/**
 * UserFilterModal - Shows medications for a specific person (takenBy filter)
 * Allows clicking through to medication details
 */
import { Avatar, Box, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { Coverage, IntakeUnit, Medication, StockThresholds } from "../types";
import { getMedDisplayName, getMedTotal, getStockDisplayCapacity } from "../types";
import { allowsPillFormSelection, isLiquidContainerPackageType, isTubePackageType } from "../types/package-profiles";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { StatusBadge, type StatusTone } from "../ui/primitives/StatusBadge";
import { formatNumber } from "../utils";
import { getSystemLocale } from "../utils/formatters";
import { getIntakeFrequencyText, getMedicationIntakes } from "../utils/intake-schedule";
import { getLiquidCountUnitLabel } from "../utils/intake-units";
import { personTagsMatch } from "../utils/person-tags";
import { getStockStatus } from "../utils/schedule";
import { MedicationAvatar } from "./MedicationAvatar";
import classes from "./UserFilterModal.module.css";

export interface UserFilterModalProps {
	selectedUser: string | null;
	meds: Medication[];
	coverage: { all: Coverage[] };
	settings: StockThresholds;
	onClose: () => void;
	onClearUser: () => void;
	onOpenMedDetail: (med: Medication) => void;
}

export function UserFilterModal({
	selectedUser,
	meds,
	coverage,
	settings,
	onClose,
	onClearUser,
	onOpenMedDetail,
}: UserFilterModalProps) {
	const { t, i18n } = useTranslation();

	const isLiquidMedication = (med: Medication): boolean => {
		const rawPackageType = med.packageType as unknown as string | null | undefined;
		return (
			isLiquidContainerPackageType(med.packageType) || rawPackageType === "liquid" || med.medicationForm === "liquid"
		);
	};

	const getDiscreteUnitLabel = (med: Medication, count: number): string => {
		if (med.packageType === "inhaler") return count === 1 ? t("common.puff") : t("common.puffs");
		if (med.packageType === "injection") return count === 1 ? t("common.injection") : t("common.injections");
		return count === 1 ? t("common.pill") : t("common.pills");
	};

	const formatIntakeUsageLabel = (med: Medication, usage: number, intakeUnit?: IntakeUnit | null): string => {
		if (isLiquidMedication(med)) {
			return `${formatNumber(usage)} ${getLiquidCountUnitLabel(intakeUnit, usage, t)}`;
		}
		if (isTubePackageType(med.packageType)) {
			return `${formatNumber(usage)} ${t("form.blisters.applications", { count: usage })}`;
		}
		return `${formatNumber(usage)} ${getDiscreteUnitLabel(med, usage)}`;
	};

	const formatStockSummaryLabel = (med: Medication, currentStock: number, packageSize: number): string => {
		if (isLiquidMedication(med)) {
			return `${formatNumber(currentStock)}/${formatNumber(packageSize)} ${t("form.packageAmountUnitMl")}`;
		}
		if (isTubePackageType(med.packageType)) {
			return `${formatNumber(currentStock)}/${formatNumber(packageSize)} ${t("form.packageAmountUnitG")}`;
		}
		return `${formatNumber(currentStock)}/${formatNumber(packageSize)} ${getDiscreteUnitLabel(med, packageSize)}`;
	};

	const getStatusTone = (className: string): StatusTone => {
		if (className === "danger") return "danger";
		if (className === "warning") return "warning";
		if (className === "success") return "success";
		return "info";
	};

	if (!selectedUser) return null;

	const userMeds = meds.filter(
		(medication) =>
			!medication.isObsolete && (medication.takenBy || []).some((person) => personTagsMatch(person, selectedUser))
	);

	return (
		<AppModal
			centered
			classNames={{
				body: classes.body,
				content: classes.modal,
				header: classes.modalHeader,
				title: classes.modalTitle,
			}}
			closeButtonProps={{ "aria-label": t("common.close") }}
			lockScroll={false}
			manageEscape={false}
			manageScrollLock={false}
			onClose={onClose}
			opened={!!selectedUser}
			size={500}
			title={t("modal.userMedications", { name: selectedUser })}
			withCloseButton
		>
			<Stack gap={0}>
				<Group className={classes.hero} gap="md" wrap="nowrap">
					<Avatar className={classes.userAvatar} data-testid="user-filter-avatar" radius="xl" size={50}>
						{selectedUser.charAt(0).toUpperCase()}
					</Avatar>
					<Text className={classes.heroTitle}>{t("modal.userMedications", { name: selectedUser })}</Text>
				</Group>

				<ScrollArea.Autosize className={classes.list} mah={400} type="auto">
					<Stack gap="xs">
						{userMeds.map((med) => {
							const medCoverage = coverage.all.find((c) => c.name === getMedDisplayName(med));
							// Fallback: if no coverage data (e.g. obsolete med), compute basic status from total pills
							const status = medCoverage
								? getStockStatus(medCoverage.daysLeft, medCoverage.medsLeft, settings, med.packageType)
								: getStockStatus(null, getMedTotal(med), settings, med.packageType);
							const packageSize = getStockDisplayCapacity(med);
							const currentStock = medCoverage ? medCoverage.medsLeft : getMedTotal(med);

							// Get intakes relevant to this person
							const personIntakes = getMedicationIntakes(med).filter(
								(intake) => intake.takenBy === null || personTagsMatch(intake.takenBy, selectedUser)
							);

							return (
								<Box
									key={med.id}
									className={classes.medicationItem}
									component="button"
									onClick={() => {
										onClearUser();
										onOpenMedDetail(med);
									}}
									type="button"
								>
									<MedicationAvatar name={getMedDisplayName(med)} imageUrl={med.imageUrl} size="sm" />
									<Stack className={classes.medicationInfo} gap={2}>
										<Text className={classes.medicationName}>{getMedDisplayName(med)}</Text>
										{med.name && med.genericName ? (
											<Text className={classes.medicationGeneric}>{med.genericName}</Text>
										) : null}
										{personIntakes.length > 0 ? (
											<Stack className={classes.intakeList} gap={2}>
												{personIntakes.map((intake) => {
													const timeStr = new Date(intake.start).toLocaleTimeString(getSystemLocale(i18n.language), {
														hour: "2-digit",
														minute: "2-digit",
													});
													const intakeKey = `${intake.start}-${intake.usage}-${intake.every}-${intake.scheduleMode ?? "interval"}-${(intake.weekdays ?? []).join("")}-${intake.takenBy ?? ""}`;
													const intakeUnit = "intakeUnit" in intake ? intake.intakeUnit : undefined;
													return (
														<Text key={intakeKey} className={classes.intakeItem}>
															{formatIntakeUsageLabel(med, intake.usage, intakeUnit)}
															{allowsPillFormSelection(med.packageType) &&
																med.pillWeightMg != null &&
																` (${intake.usage * med.pillWeightMg} ${med.doseUnit ?? "mg"})`}{" "}
															{getIntakeFrequencyText(intake, t)} {t("modal.at")} {timeStr}
														</Text>
													);
												})}
											</Stack>
										) : null}
									</Stack>
									<Stack align="flex-start" className={classes.medicationStats} gap={4}>
										<Text className={classes.stockSummary}>
											{formatStockSummaryLabel(med, currentStock, packageSize)}
										</Text>
										{status ? (
											<StatusBadge tone={getStatusTone(status.className)}>{t(status.label)}</StatusBadge>
										) : null}
									</Stack>
								</Box>
							);
						})}
						{userMeds.length === 0 ? (
							<Text className={classes.empty}>{t("modal.noMedsForUser", { name: selectedUser })}</Text>
						) : null}
					</Stack>
				</ScrollArea.Autosize>

				<AppModalFooter>
					<AppButton onClick={onClose} tone="secondary">
						{t("common.close")}
					</AppButton>
				</AppModalFooter>
			</Stack>
		</AppModal>
	);
}
