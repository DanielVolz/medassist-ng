import { Alert, Group, Stack, Text } from "@mantine/core";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../components/Auth";
import { DateTimeInput } from "../components/DateTimeInput";
import { MedicationAvatar } from "../components/MedicationAvatar";
import { useAppContext } from "../context";
import type { Medication, PlannerRow } from "../types";
import { getMedDisplayName, isAmountBasedPackageType, isLiquidContainerPackageType, isTubePackageType } from "../types";
import { SectionCard } from "../ui/components/SectionCard";
import { PageContainer } from "../ui/layout/PageContainer";
import { AppButton } from "../ui/primitives/AppButton";
import { AppCheckbox } from "../ui/primitives/AppCheckbox";
import { AppTextAction } from "../ui/primitives/AppTextAction";
import { DataTable, type DataTableColumn } from "../ui/primitives/DataTable";
import { StatusBadge } from "../ui/primitives/StatusBadge";
import { toInputValue } from "../utils/formatters";
import classes from "./PlannerPage.module.css";

type PlannerDisplayRow = PlannerRow & {
	displayName: string;
	medication?: Medication;
	remainingRefills: number | null;
};

function localDateAtStartOfDay(days = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(0, 0, 0, 0);
	return d;
}

function defaultPlannerRange(): { start: string; end: string } {
	return {
		start: toInputValue(localDateAtStartOfDay()),
		end: toInputValue(localDateAtStartOfDay(3)),
	};
}

// Convert datetime-local value to ISO string
function toIsoString(value: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDate(value: string): Date | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

// Helper for user-specific localStorage keys
function userStorageKey(userId: number | undefined, key: string): string {
	return userId ? `user_${userId}_${key}` : key;
}

export function PlannerPage() {
	const { t } = useTranslation();
	const { user, authFetch } = useAuth();
	const { meds, settings, openMedDetail } = useAppContext();

	// Local state for planner
	const [plannerRows, setPlannerRows] = useState<PlannerRow[]>([]);
	const [plannerLoading, setPlannerLoading] = useState(false);
	const [range, setRange] = useState<{ start: string; end: string }>(() => defaultPlannerRange());
	const [includeUntilStart, setIncludeUntilStart] = useState(false);
	const [sendingPlannerEmail, setSendingPlannerEmail] = useState(false);
	const [plannerEmailResult, setPlannerEmailResult] = useState<{ success: boolean; message: string } | null>(null);
	const [plannerError, setPlannerError] = useState<string | null>(null);
	const [hasCalculated, setHasCalculated] = useState(false);

	// Load user-specific planner data when user changes
	useEffect(() => {
		if (typeof window !== "undefined" && user?.id) {
			const savedRows = localStorage.getItem(userStorageKey(user.id, "plannerRows"));
			const savedRange = localStorage.getItem(userStorageKey(user.id, "plannerRange"));
			const savedIncludeUntilStart = localStorage.getItem(userStorageKey(user.id, "plannerIncludeUntilStart"));

			if (savedRows) {
				try {
					setPlannerRows(JSON.parse(savedRows));
				} catch {
					setPlannerRows([]);
				}
			} else {
				setPlannerRows([]);
			}

			if (savedRange) {
				try {
					setRange(JSON.parse(savedRange));
				} catch {
					/* keep default */
				}
			} else {
				setRange(defaultPlannerRange());
			}

			if (savedIncludeUntilStart) {
				setIncludeUntilStart(savedIncludeUntilStart === "true");
			} else {
				setIncludeUntilStart(false);
			}
		} else {
			setPlannerRows([]);
			setRange(defaultPlannerRange());
			setIncludeUntilStart(false);
		}
	}, [user?.id]);

	async function runPlanner(e: FormEvent) {
		e.preventDefault();
		const start = toDate(range.start);
		const end = toDate(range.end);
		const startDate = toIsoString(range.start);
		const endDate = toIsoString(range.end);
		setPlannerError(null);
		setPlannerEmailResult(null);
		setHasCalculated(false);
		if (!start || !end || !startDate || !endDate || end <= start) {
			setPlannerRows([]);
			setPlannerError(t("planner.errors.invalidDateRange"));
			setHasCalculated(true);
			return;
		}

		setPlannerLoading(true);
		try {
			const body = { startDate, endDate, includeUntilStart };
			const res = await authFetch("/api/medications/usage", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) {
				const message =
					data && typeof data === "object" && "error" in data && typeof data.error === "string"
						? data.error
						: t("planner.errors.calculateFailed");
				throw new Error(message);
			}
			if (!Array.isArray(data)) {
				throw new Error(t("planner.errors.calculateFailed"));
			}
			const rows = data as PlannerRow[];
			setPlannerRows(rows);
			setHasCalculated(true);
			if (user?.id) {
				localStorage.setItem(userStorageKey(user.id, "plannerRange"), JSON.stringify(range));
				localStorage.setItem(userStorageKey(user.id, "plannerRows"), JSON.stringify(rows));
				localStorage.setItem(userStorageKey(user.id, "plannerIncludeUntilStart"), String(includeUntilStart));
			}
		} catch (error) {
			setPlannerRows([]);
			setPlannerError(error instanceof Error && error.message ? error.message : t("planner.errors.calculateFailed"));
			setHasCalculated(true);
		} finally {
			setPlannerLoading(false);
		}
	}

	function resetRange() {
		setRange(defaultPlannerRange());
		setIncludeUntilStart(false);
		setPlannerRows([]);
		setPlannerError(null);
		setPlannerEmailResult(null);
		setHasCalculated(false);
		if (user?.id) {
			localStorage.removeItem(userStorageKey(user.id, "plannerRange"));
			localStorage.removeItem(userStorageKey(user.id, "plannerRows"));
			localStorage.removeItem(userStorageKey(user.id, "plannerIncludeUntilStart"));
		}
	}

	const canSendNotification =
		(settings.emailEnabled && settings.notificationEmail) || (settings.shoutrrrEnabled && settings.shoutrrrUrl);

	const getDiscreteUnitLabel = (packageType: string | undefined, count: number): string => {
		if (packageType === "inhaler") return count === 1 ? t("common.puff") : t("common.puffs");
		if (packageType === "injection") return count === 1 ? t("common.injection") : t("common.injections");
		return count === 1 ? t("common.pill") : t("common.pills");
	};

	const getUsageUnitLabel = (medicationId: number, count: number): string => {
		const med = meds.find((m) => m.id === medicationId);
		if (isLiquidContainerPackageType(med?.packageType)) {
			return t("form.packageAmountUnitMl");
		}
		if (isTubePackageType(med?.packageType)) {
			return med?.medicationForm === "liquid"
				? t("form.packageAmountUnitMl")
				: t("form.blisters.applications", { count: Math.abs(count) });
		}
		return getDiscreteUnitLabel(med?.packageType, count);
	};

	const getAvailableLabel = (medicationId: number, loosePills: number): string => {
		const med = meds.find((m) => m.id === medicationId);
		const roundedLoose = Math.round(loosePills * 10) / 10;
		if (isLiquidContainerPackageType(med?.packageType)) {
			return `${roundedLoose} ${t("form.packageAmountUnitMl")}`;
		}
		if (isTubePackageType(med?.packageType)) {
			const unit =
				med?.medicationForm === "liquid"
					? t("form.packageAmountUnitMl")
					: t("form.blisters.applications", { count: Math.abs(roundedLoose) });
			return `${roundedLoose} ${unit}`;
		}
		return `${roundedLoose} ${getDiscreteUnitLabel(med?.packageType, roundedLoose)}`;
	};

	async function sendPlannerNotification() {
		if (!canSendNotification || plannerRows.length === 0) return;
		const start = toDate(range.start);
		const end = toDate(range.end);
		const startDate = toIsoString(range.start);
		const endDate = toIsoString(range.end);
		if (!start || !end || !startDate || !endDate || end <= start) {
			setPlannerEmailResult({ success: false, message: t("planner.errors.invalidDateRange") });
			return;
		}

		setSendingPlannerEmail(true);
		setPlannerEmailResult(null);

		try {
			const res = await authFetch("/api/planner/send-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: settings.notificationEmail,
					startDate,
					endDate,
					includeUntilStart,
					rows: plannerRows,
				}),
			});
			const data = await res.json().catch(() => null);
			if (res.ok) {
				setPlannerEmailResult({
					success: true,
					message: data && typeof data.message === "string" ? data.message : t("common.sent"),
				});
			} else {
				setPlannerEmailResult({
					success: false,
					message: data && typeof data.error === "string" ? data.error : t("common.sendFailed"),
				});
			}
		} catch {
			setPlannerEmailResult({ success: false, message: t("common.networkError") });
		}
		setSendingPlannerEmail(false);
	}

	const plannerDisplayRows: PlannerDisplayRow[] = plannerRows.map((row) => {
		const medication =
			meds.find((med) => med.id === row.medicationId) ||
			meds.find((med) => getMedDisplayName(med) === row.medicationName);
		const displayName = medication ? getMedDisplayName(medication) : row.medicationName;
		const remainingRefills = medication?.prescriptionEnabled ? (medication.prescriptionRemainingRefills ?? 0) : null;

		return {
			...row,
			displayName,
			medication,
			remainingRefills,
		};
	});

	function getAvailableContent(row: PlannerDisplayRow): ReactNode {
		if (isAmountBasedPackageType(row.packageType)) {
			return getAvailableLabel(row.medicationId, row.loosePills);
		}

		const roundedLoose = Math.round(row.loosePills * 10) / 10;
		if (row.loosePills <= 0) {
			return `${row.fullBlisters} ${t("common.blisters")}`;
		}

		const looseUnit = roundedLoose === 1 ? t("common.pill") : t("common.pills");
		return `${row.fullBlisters} ${t("common.blisters")} + ${roundedLoose} ${looseUnit}`;
	}

	const plannerColumns = [
		{
			key: "medication",
			header: t("planner.table.medication"),
			render: (row) => {
				const medication = row.medication;

				return (
					<Group gap="sm" wrap="nowrap" className={classes.medicationCell}>
						<MedicationAvatar name={row.displayName} imageUrl={medication?.imageUrl} />
						{medication ? (
							<AppTextAction
								className={classes.medicationNameLink}
								fontWeight={600}
								onClick={() => openMedDetail(medication)}
								textAlign="left"
							>
								{row.displayName}
							</AppTextAction>
						) : (
							<Text fw={600}>{row.displayName}</Text>
						)}
					</Group>
				);
			},
		},
		{
			key: "usage",
			header: t("planner.table.usage"),
			render: (row) => (
				<Text className={classes.metric}>
					<strong>{row.plannerUsage}</strong> {getUsageUnitLabel(row.medicationId, row.plannerUsage)}
				</Text>
			),
		},
		{
			key: "blistersNeeded",
			header: t("planner.table.blistersNeeded"),
			render: (row) => (isAmountBasedPackageType(row.packageType) ? "–" : `${row.blistersNeeded} × ${row.blisterSize}`),
		},
		{
			key: "prescriptionRefills",
			header: t("planner.table.prescriptionRefills"),
			render: (row) => row.remainingRefills ?? "–",
		},
		{
			key: "available",
			header: t("planner.table.available"),
			render: (row) => <Text className={classes.availableValue}>{getAvailableContent(row)}</Text>,
		},
		{
			key: "status",
			header: t("table.status"),
			render: (row) => (
				<StatusBadge tone={row.enough ? "success" : "danger"}>
					{row.enough ? t("status.enough") : t("status.outOfStock")}
				</StatusBadge>
			),
		},
	] satisfies DataTableColumn<PlannerDisplayRow>[];

	return (
		<PageContainer data-testid="planner-page">
			<SectionCard title={t("planner.title")} data-testid="planner-form-card">
				<form className={[classes.form, "planner"].join(" ")} data-testid="planner-form" onSubmit={runPlanner}>
					<div className={classes.rangeGrid}>
						<label className={classes.dateField} htmlFor="planner-start-date">
							<span>{t("planner.from")}</span>
							<DateTimeInput
								id="planner-start-date"
								step="60"
								value={range.start}
								onChange={(e) => setRange({ ...range, start: e.target.value })}
							/>
						</label>
						<label className={classes.dateField} htmlFor="planner-end-date">
							<span>{t("planner.until")}</span>
							<DateTimeInput
								id="planner-end-date"
								step="60"
								value={range.end}
								onChange={(e) => setRange({ ...range, end: e.target.value })}
							/>
						</label>
					</div>
					<AppCheckbox
						checked={includeUntilStart}
						data-testid="planner-include-until-start"
						label={t("planner.includeUntilStart")}
						onChange={setIncludeUntilStart}
						tooltip={t("planner.includeUntilStartTooltip")}
					/>
					<Group
						className={[classes.actions, "planner-actions"].join(" ")}
						justify="flex-end"
						gap="sm"
						data-testid="planner-actions"
					>
						<AppButton type="button" tone="secondary" onClick={resetRange}>
							{t("common.reset")}
						</AppButton>
						<AppButton type="submit" loading={plannerLoading}>
							{plannerLoading ? t("planner.calculating") : t("planner.calculate")}
						</AppButton>
					</Group>
				</form>
				{plannerError ? (
					<Alert className={classes.feedback} color="red" role="alert" variant="light">
						{plannerError}
					</Alert>
				) : null}
				{hasCalculated && !plannerError && plannerRows.length === 0 ? (
					<Alert className={classes.feedback} color="blue" variant="light">
						{t("planner.noResults")}
					</Alert>
				) : null}
				{plannerDisplayRows.length > 0 ? (
					<Stack className={classes.results} gap="md">
						<DataTable
							columns={plannerColumns}
							data-testid="planner-results-table"
							rows={plannerDisplayRows}
							rowKey={(row) => row.medicationId}
							getRowProps={() => ({
								"data-testid": "planner-result-row",
							})}
						/>
						{canSendNotification ? (
							<Group className={classes.emailAction} justify="flex-end" align="center" gap="sm">
								<AppButton
									type="button"
									tone="secondary"
									onClick={sendPlannerNotification}
									loading={sendingPlannerEmail}
								>
									{sendingPlannerEmail ? t("common.sending") : t("planner.sendNotification")}
								</AppButton>
								{plannerEmailResult ? (
									<Text c={plannerEmailResult.success ? "green" : "red"} fw={600}>
										{plannerEmailResult.message}
									</Text>
								) : null}
							</Group>
						) : null}
					</Stack>
				) : null}
			</SectionCard>
		</PageContainer>
	);
}
