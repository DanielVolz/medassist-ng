import type { Client } from "@libsql/client";
import {
	forEachScheduledOccurrenceInRange,
	getDateOnlyTimestamp,
	getScheduleMatchWindowMs,
	parseIntakesJson,
	parseLocalDateTime,
} from "../utils/scheduler-utils.js";

const MS_PER_DAY = 86_400_000;

/**
 * Repair dose IDs that have a trailing hyphen caused by a frontend bug where
 * [].toString() produced an empty string.
 */
export async function repairTrailingHyphenDoseIds(client: Client): Promise<{ repaired: number; errors: string[] }> {
	const errors: string[] = [];
	let repaired = 0;

	try {
		const result = await client.execute(
			"UPDATE dose_tracking SET dose_id = RTRIM(dose_id, '-') WHERE dose_id LIKE '%-'"
		);
		repaired = result.rowsAffected;
	} catch (e: unknown) {
		errors.push(`Trailing-hyphen repair failed: ${(e as Error).message}`);
	}

	return { repaired, errors };
}

/**
 * Repair orphaned dose tracking IDs that no longer match the current intake schedule.
 */
export async function repairOrphanedDoseIds(client: Client): Promise<{ repaired: number; errors: string[] }> {
	const errors: string[] = [];
	let repaired = 0;

	try {
		const medsResult = await client.execute(
			"SELECT id, intakes_json, usage_json, every_json, start_json, intake_reminders_enabled FROM medications"
		);

		if (medsResult.rows.length === 0) return { repaired, errors };

		const dosesResult = await client.execute("SELECT id, dose_id FROM dose_tracking");
		if (dosesResult.rows.length === 0) return { repaired, errors };

		const dosesByMed = new Map<number, Array<{ id: number; doseId: string }>>();
		for (const row of dosesResult.rows) {
			const doseId = row.dose_id as string;
			const parts = doseId.split("-");
			if (parts.length < 3) continue;
			const medId = parseInt(parts[0], 10);
			if (Number.isNaN(medId)) continue;
			if (!dosesByMed.has(medId)) dosesByMed.set(medId, []);
			dosesByMed.get(medId)?.push({ id: row.id as number, doseId });
		}

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

		for (const med of medsResult.rows) {
			const medId = med.id as number;
			const medDoses = dosesByMed.get(medId);
			if (!medDoses || medDoses.length === 0) continue;

			const intakes = parseIntakesJson(
				med.intakes_json as string | null,
				{
					usageJson: (med.usage_json as string) || "[]",
					everyJson: (med.every_json as string) || "[]",
					startJson: (med.start_json as string) || "[]",
				},
				(med.intake_reminders_enabled as number) === 1
			);

			if (intakes.length === 0) continue;

			const validDatesByIntake = new Map<number, Set<number>>();
			for (let idx = 0; idx < intakes.length; idx++) {
				const intake = intakes[idx];
				const start = parseLocalDateTime(intake.start);
				const every = intake.every;
				if (every <= 0 || Number.isNaN(start.getTime())) continue;

				const validDates = new Set<number>();
				forEachScheduledOccurrenceInRange(intake, start.getTime(), today.getTime() + MS_PER_DAY - 1, (occurrenceMs) => {
					validDates.add(getDateOnlyTimestamp(new Date(occurrenceMs)));
				});
				validDatesByIntake.set(idx, validDates);
			}

			for (const dose of medDoses) {
				const parts = dose.doseId.split("-");
				if (parts.length < 3) continue;

				const intakeIdx = parseInt(parts[1], 10);
				const dateOnlyMs = parseInt(parts[2], 10);
				if (Number.isNaN(intakeIdx) || Number.isNaN(dateOnlyMs)) continue;

				const validDates = validDatesByIntake.get(intakeIdx);
				if (!validDates || validDates.has(dateOnlyMs)) continue;

				const intake = intakes[intakeIdx];
				if (!intake) continue;

				const halfInterval = getScheduleMatchWindowMs(intake);
				let bestMatch: number | null = null;
				let bestDist = Infinity;

				for (const validDate of validDates) {
					const dist = Math.abs(validDate - dateOnlyMs);
					if (dist < bestDist && dist <= halfInterval) {
						bestDist = dist;
						bestMatch = validDate;
					}
				}

				if (bestMatch !== null) {
					const personSuffix = parts.length > 3 ? `-${parts.slice(3).join("-")}` : "";
					const newDoseId = `${medId}-${intakeIdx}-${bestMatch}${personSuffix}`;

					try {
						await client.execute({
							sql: "UPDATE dose_tracking SET dose_id = ? WHERE id = ?",
							args: [newDoseId, dose.id],
						});
						repaired++;
					} catch (e: unknown) {
						errors.push(`Failed to repair dose ${dose.id}: ${(e as Error).message}`);
					}
				}
			}
		}
	} catch (e: unknown) {
		errors.push(`Repair failed: ${(e as Error).message}`);
	}

	return { repaired, errors };
}
