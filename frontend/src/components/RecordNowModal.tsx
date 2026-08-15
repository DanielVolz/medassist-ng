import { Alert, Group, Stack, Text } from "@mantine/core";
import { getAsNeededQuantityProfile, normalizeAsNeededQuantityMilli } from "@medassist/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AsNeededIntakeRequestError } from "../hooks/useAsNeededIntakes";
import type { AsNeededIntakeMutationResponse, Medication } from "../types";
import { getMedDisplayName } from "../types";
import { AppModal, AppModalFooter } from "../ui/modal/AppModal";
import { AppButton } from "../ui/primitives/AppButton";
import { AppSelect } from "../ui/primitives/AppSelect";
import { getNumericLocale, withFormattingTimezone } from "../utils/formatters";
import { FormNumberStepper } from "./FormNumberStepper";
import { MedicationAvatar } from "./MedicationAvatar";

type RecordNowModalProps = {
	medication: Medication | null;
	onClose: () => void;
	onRecord: (input: {
		medicationId: number;
		quantity: number;
		person: string | null;
		idempotencyKey: string;
	}) => Promise<AsNeededIntakeMutationResponse>;
};

function getErrorKey(code: string): string {
	if (code === "NETWORK_ERROR") return "asNeeded.errors.network";
	if (code === "INSUFFICIENT_STOCK") return "asNeeded.errors.insufficientStock";
	if (code === "STOCK_UNRESOLVABLE") return "asNeeded.errors.stockUnresolvable";
	if (code === "MEDICATION_NOT_ELIGIBLE") return "asNeeded.errors.notEligible";
	if (code === "INVALID_PERSON") return "asNeeded.errors.invalidPerson";
	if (code === "INVALID_QUANTITY") return "asNeeded.errors.invalidQuantity";
	if (code === "TOO_MANY_NEW_INTAKES") return "asNeeded.errors.rateLimited";
	if (code === "IDEMPOTENCY_KEY_REUSED") return "asNeeded.errors.intentConflict";
	if (code === "READ_ONLY" || code === "API_KEY_SCOPE_FORBIDDEN") return "asNeeded.errors.readOnly";
	return "asNeeded.errors.generic";
}

function formatQuantity(value: number): string {
	return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatTrustedDateTime(value: string): string {
	return new Date(value).toLocaleString(
		getNumericLocale(),
		withFormattingTimezone({ year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
	);
}

export function RecordNowModal({ medication, onClose, onRecord }: RecordNowModalProps) {
	const { t } = useTranslation();
	const profile = useMemo(() => getAsNeededQuantityProfile(medication ?? {}), [medication]);
	const [quantity, setQuantity] = useState(String(profile.defaultQuantity));
	const [person, setPerson] = useState("");
	const [idempotencyKey, setIdempotencyKey] = useState("");
	const [pending, setPending] = useState(false);
	const [attempted, setAttempted] = useState(false);
	const [error, setError] = useState<{ code: string; retryAfterSeconds: number | null } | null>(null);
	const [result, setResult] = useState<AsNeededIntakeMutationResponse | null>(null);
	const feedbackRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!medication) return;
		const nextProfile = getAsNeededQuantityProfile(medication);
		setQuantity(String(nextProfile.defaultQuantity));
		setPerson("");
		setIdempotencyKey(crypto.randomUUID());
		setPending(false);
		setAttempted(false);
		setError(null);
		setResult(null);
	}, [medication]);

	useEffect(() => {
		if (error || result) feedbackRef.current?.focus();
	}, [error, result]);

	if (!medication) return null;

	const numericQuantity = Number.parseFloat(quantity);
	const quantityIsValid = normalizeAsNeededQuantityMilli(numericQuantity, profile) !== null;
	const unitLabel = t(`asNeeded.units.${profile.unit}`, { count: numericQuantity });
	const locked = pending || attempted;
	let submitLabel = t("asNeeded.record.confirm");
	if (pending) {
		submitLabel = t("asNeeded.record.saving");
	} else if (error) {
		submitLabel = t("common.retry");
	}

	const close = () => {
		if (!pending) onClose();
	};

	const submit = async () => {
		if (pending || result || !quantityIsValid || !idempotencyKey) return;
		setPending(true);
		setAttempted(true);
		setError(null);
		try {
			setResult(
				await onRecord({
					medicationId: medication.id,
					quantity: numericQuantity,
					person: person || null,
					idempotencyKey,
				})
			);
		} catch (requestError) {
			if (requestError instanceof AsNeededIntakeRequestError) {
				setError({ code: requestError.code, retryAfterSeconds: requestError.retryAfterSeconds });
			} else {
				setError({ code: "UNKNOWN_ERROR", retryAfterSeconds: null });
			}
		} finally {
			setPending(false);
		}
	};

	return (
		<AppModal
			closeButtonProps={{ "aria-label": t("common.close"), disabled: pending }}
			onClose={close}
			opened
			size={480}
			title={t("asNeeded.record.title")}
			withCloseButton
		>
			<Stack gap="md">
				<Group gap="sm" wrap="nowrap">
					<MedicationAvatar name={getMedDisplayName(medication)} imageUrl={medication.imageUrl} size="lg" />
					<div>
						<Text fw={700}>{getMedDisplayName(medication)}</Text>
						<Text c="dimmed" size="sm">
							{t("form.blisters.noRegularSchedule")}
						</Text>
					</div>
				</Group>

				{result ? (
					<Alert ref={feedbackRef} tabIndex={-1} color="green" title={t("asNeeded.record.successTitle")}>
						{t("asNeeded.record.successMessage", {
							quantity: formatQuantity(result.event.quantity),
							unit: t(`asNeeded.units.${result.event.quantityUnit}`, { count: result.event.quantity }),
							time: formatTrustedDateTime(result.event.occurredAt),
							stock: formatQuantity(result.inventory.currentStock),
						})}
						{result.inventory.reconciliationRequired ? ` ${t("asNeeded.record.reconciliationRequired")}` : ""}
					</Alert>
				) : (
					<>
						<Text size="sm">{t("asNeeded.record.trustedTime")}</Text>
						<fieldset disabled={locked} style={{ border: 0, margin: 0, padding: 0 }}>
							<Stack gap="md">
								<label htmlFor="record-now-quantity">
									<Text component="span" fw={600} size="sm">
										{t("asNeeded.record.quantity", { unit: unitLabel })}
									</Text>
									<FormNumberStepper
										allowDecimal={!profile.wholeUnitsOnly}
										decrementLabel={t("asNeeded.record.decreaseQuantity")}
										incrementLabel={t("asNeeded.record.increaseQuantity")}
										inputId="record-now-quantity"
										max={profile.unit === "application" ? 1 : undefined}
										min={profile.uiStep}
										onChange={setQuantity}
										step={profile.uiStep}
										value={quantity}
									/>
								</label>
								<AppSelect
									data={[
										{ value: "", label: t("asNeeded.record.noPerson") },
										...medication.takenBy.map((name) => ({ value: name, label: name })),
									]}
									label={t("asNeeded.record.person")}
									onChange={(event) => setPerson(event.currentTarget.value)}
									value={person}
								/>
							</Stack>
						</fieldset>
						<Text c="dimmed" size="sm">
							{profile.measurable
								? t("asNeeded.record.stockEffect", { quantity: formatQuantity(numericQuantity), unit: unitLabel })
								: t("asNeeded.record.noStockEffect")}
						</Text>
						{!quantityIsValid && quantity.length > 0 ? (
							<Text c="red" role="alert" size="sm">
								{t("asNeeded.errors.invalidQuantity")}
							</Text>
						) : null}
						{pending ? (
							<Text aria-live="polite" role="status" size="sm">
								{t("asNeeded.record.saving")}
							</Text>
						) : null}
						{error ? (
							<Alert ref={feedbackRef} tabIndex={-1} color="red" title={t("asNeeded.record.failedTitle")}>
								{t(getErrorKey(error.code), { seconds: error.retryAfterSeconds ?? 0 })}
							</Alert>
						) : null}
					</>
				)}
			</Stack>

			<AppModalFooter>
				<AppButton type="button" tone="secondary" onClick={close} disabled={pending}>
					{result ? t("common.close") : t("common.cancel")}
				</AppButton>
				{!result ? (
					<AppButton type="button" tone="primary" onClick={() => void submit()} disabled={pending || !quantityIsValid}>
						{submitLabel}
					</AppButton>
				) : null}
			</AppModalFooter>
		</AppModal>
	);
}
