import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { getDataDir } from "../../db/db-utils.js";
import { userSettings } from "../../db/schema.js";
import {
	createDefaultReminderState,
	getTodayInTimezone,
	parseReminderState,
	type ReminderState,
} from "../../utils/scheduler-utils.js";

const reminderStateFile = resolve(getDataDir(), "reminder-state.json");

export function loadReminderState(): ReminderState {
	try {
		if (existsSync(reminderStateFile)) {
			return parseReminderState(readFileSync(reminderStateFile, "utf-8"));
		}
	} catch {
		// ignore
	}
	return createDefaultReminderState();
}

export function saveReminderState(state: ReminderState): void {
	writeFileSync(reminderStateFile, JSON.stringify(state, null, 2));
}

export function getReminderState(): ReminderState {
	return loadReminderState();
}

export function updateReminderSentTime(
	type: "stock" | "intake" | "prescription" = "stock",
	channel: "email" | "push" | "both" = "email"
): void {
	const state = loadReminderState();
	const today = getTodayInTimezone();
	saveReminderState({
		...state,
		lastAutoEmailSent: new Date().toISOString(),
		lastAutoEmailDate: today,
		lastNotificationType: type,
		lastNotificationChannel: channel,
	});
}

// Stock and intake reminders are tracked separately so neither overwrites the other.
export async function updateUserReminderSentTime(
	userId: number,
	type: "stock" | "intake" | "prescription" = "stock",
	channel: "email" | "push" | "both" = "email",
	medName?: string,
	takenBy?: string
): Promise<void> {
	const now = new Date().toISOString();
	if (type === "stock") {
		await db
			.update(userSettings)
			.set({
				lastStockReminderSent: now,
				lastStockReminderChannel: channel,
				lastStockReminderMedNames: medName ?? null,
			})
			.where(eq(userSettings.userId, userId));
		return;
	}

	if (type === "prescription") {
		await db
			.update(userSettings)
			.set({
				lastPrescriptionReminderSent: now,
				lastPrescriptionReminderChannel: channel,
				lastPrescriptionReminderMedNames: medName ?? null,
			})
			.where(eq(userSettings.userId, userId));
		return;
	}

	await db
		.update(userSettings)
		.set({
			lastAutoEmailSent: now,
			lastNotificationType: type,
			lastNotificationChannel: channel,
			lastReminderMedName: medName ?? null,
			lastReminderTakenBy: takenBy ?? null,
		})
		.where(eq(userSettings.userId, userId));
}
