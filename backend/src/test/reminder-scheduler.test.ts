import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	getAllUserSettingsMock,
	loadReminderStateMock,
	saveReminderStateMock,
	updateUserReminderSentTimeMock,
	sendPushNotificationMock,
	buildStockReminderPushNotificationMock,
	buildPrescriptionReminderPushNotificationMock,
	selectMock,
	openSyncMock,
	unlinkSyncMock,
} = vi.hoisted(() => ({
	getAllUserSettingsMock: vi.fn(),
	loadReminderStateMock: vi.fn(),
	saveReminderStateMock: vi.fn(),
	updateUserReminderSentTimeMock: vi.fn(),
	sendPushNotificationMock: vi.fn(),
	buildStockReminderPushNotificationMock: vi.fn(),
	buildPrescriptionReminderPushNotificationMock: vi.fn(),
	selectMock: vi.fn(),
	openSyncMock: vi.fn(() => 1),
	unlinkSyncMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	openSync: openSyncMock,
	closeSync: vi.fn(),
	statSync: vi.fn(),
	unlinkSync: unlinkSyncMock,
}));

vi.mock("../db/path-utils.js", () => ({ getDataDir: () => "/tmp/medassist-reminder-tests" }));

vi.mock("../db/client.js", () => ({
	db: { select: selectMock },
}));

vi.mock("../routes/settings.js", () => ({
	getAllUserSettings: getAllUserSettingsMock,
}));

vi.mock("../services/notifications/state.js", () => ({
	loadReminderState: loadReminderStateMock,
	saveReminderState: saveReminderStateMock,
	updateUserReminderSentTime: updateUserReminderSentTimeMock,
	getReminderState: vi.fn(),
	updateReminderSentTime: vi.fn(),
}));

vi.mock("../services/notifications/delivery.js", () => ({
	getSmtpConfig: vi.fn(() => ({ port: 587, secure: false })),
	sendEmailNotification: vi.fn(),
	sendPushNotification: sendPushNotificationMock,
}));

vi.mock("../services/notifications/builders.js", () => ({
	buildStockReminderPushNotification: buildStockReminderPushNotificationMock,
	buildPrescriptionReminderPushNotification: buildPrescriptionReminderPushNotificationMock,
}));

vi.mock("../utils/scheduler-utils.js", async () => {
	const actual = await vi.importActual<typeof import("../utils/scheduler-utils.js")>("../utils/scheduler-utils.js");
	return {
		...actual,
		getTodayInTimezone: () => "2026-07-11",
		getEffectiveTimezone: () => "Europe/Berlin",
		getTimezone: () => "Europe/Berlin",
		getCurrentHourInTimezone: () => 5,
		getMsUntilNextCheck: () => 60_000,
		getNextScheduledTime: () => new Date("2026-07-11T06:00:00.000Z"),
		formatInTimezone: () => "2026-07-11 08:00",
	};
});

import {
	runReminderSchedulerNow,
	startReminderScheduler,
	stopReminderScheduler,
} from "../services/reminder-scheduler.js";

type ReminderState = {
	lastAutoEmailSent: string | null;
	lastAutoEmailDate: string | null;
	lastStockSchedulerCheckDate: string | null;
	notifiedMedications: string[];
	nextScheduledCheck: string | null;
	lastNotificationType: "stock" | "intake" | "prescription" | null;
	lastNotificationChannel: "email" | "push" | "both" | null;
};

function createLogger() {
	return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createSettings(overrides: Record<string, unknown> = {}) {
	return {
		userId: 42,
		language: "en",
		timezone: "Europe/Berlin",
		reminderDaysBefore: 3,
		lowStockDays: 7,
		stockCalculationMode: "automatic",
		repeatDailyReminders: false,
		emailEnabled: false,
		notificationEmail: null,
		emailStockReminders: false,
		emailPrescriptionReminders: false,
		shoutrrrEnabled: false,
		shoutrrrUrl: null,
		shoutrrrStockReminders: false,
		shoutrrrPrescriptionReminders: false,
		...overrides,
	};
}

function createMedication(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		userId: 42,
		name: "Aspirin",
		genericName: null,
		isObsolete: false,
		packageType: "blister",
		medicationForm: "tablet",
		packCount: 0,
		blistersPerPack: 1,
		pillsPerBlister: 10,
		looseTablets: 0,
		stockAdjustment: 0,
		lastStockCorrectionAt: null,
		intakesJson: JSON.stringify([{ usage: 1, every: 1, start: "2026-07-01T08:00:00.000Z" }]),
		usageJson: "[]",
		everyJson: "[]",
		startJson: "[]",
		prescriptionEnabled: false,
		prescriptionRemainingRefills: null,
		prescriptionLowRefillThreshold: null,
		prescriptionExpiryDate: null,
		...overrides,
	};
}

function queueMedicationQueries(...results: Array<Array<Record<string, unknown>>>) {
	for (const result of results) {
		const query = Promise.resolve(result) as Promise<Array<Record<string, unknown>>> & {
			orderBy: () => Promise<Array<Record<string, unknown>>>;
		};
		query.orderBy = async () => result;
		selectMock.mockReturnValueOnce({ from: () => ({ where: () => query }) });
	}
}

describe("reminder scheduler", () => {
	let state: ReminderState;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-11T05:00:00.000Z"));
		state = {
			lastAutoEmailSent: null,
			lastAutoEmailDate: null,
			lastStockSchedulerCheckDate: null,
			notifiedMedications: [],
			nextScheduledCheck: null,
			lastNotificationType: null,
			lastNotificationChannel: null,
		};
		loadReminderStateMock.mockImplementation(() => ({ ...state, notifiedMedications: [...state.notifiedMedications] }));
		saveReminderStateMock.mockImplementation((nextState: ReminderState) => {
			state = { ...nextState, notifiedMedications: [...nextState.notifiedMedications] };
		});
		getAllUserSettingsMock.mockResolvedValue([]);
		sendPushNotificationMock.mockResolvedValue({ success: true });
		buildStockReminderPushNotificationMock.mockReturnValue({ title: "stock title", message: "stock message" });
		buildPrescriptionReminderPushNotificationMock.mockReturnValue({
			title: "prescription title",
			message: "prescription message",
		});
	});

	afterEach(() => {
		stopReminderScheduler();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("skips medication queries when the user has no enabled scheduler delivery channel", async () => {
		getAllUserSettingsMock.mockResolvedValue([createSettings()]);
		const logger = createLogger();

		await runReminderSchedulerNow(logger as never);

		expect(selectMock).not.toHaveBeenCalled();
		expect(sendPushNotificationMock).not.toHaveBeenCalled();
		expect(state.lastStockSchedulerCheckDate).toBe("2026-07-11");
	});

	it("sends an eligible German stock push and records the successful channel", async () => {
		getAllUserSettingsMock.mockResolvedValue([
			createSettings({
				language: "de",
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrStockReminders: true,
			}),
		]);
		queueMedicationQueries([createMedication()], [], []);
		const logger = createLogger();

		await runReminderSchedulerNow(logger as never);

		expect(buildStockReminderPushNotificationMock).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ name: "Aspirin", medsLeft: 0 })]),
			"de"
		);
		expect(sendPushNotificationMock).toHaveBeenCalledWith("ntfy://ntfy.sh/medassist", "stock title", "stock message");
		expect(updateUserReminderSentTimeMock).toHaveBeenCalledWith(42, "stock", "push", "Aspirin");
		expect(state).toMatchObject({
			lastNotificationType: "stock",
			lastNotificationChannel: "push",
			notifiedMedications: ["user_42_2026-07-11_stock"],
		});
	});

	it("prevents duplicate prescription delivery and retains the per-user daily marker", async () => {
		getAllUserSettingsMock.mockResolvedValue([
			createSettings({
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrPrescriptionReminders: true,
			}),
		]);
		const prescription = createMedication({
			prescriptionEnabled: true,
			prescriptionRemainingRefills: 0,
			prescriptionLowRefillThreshold: 1,
		});
		queueMedicationQueries([], [], [prescription], [], [], [prescription]);
		const logger = createLogger();

		await runReminderSchedulerNow(logger as never);
		await runReminderSchedulerNow(logger as never);

		expect(buildPrescriptionReminderPushNotificationMock).toHaveBeenCalledTimes(1);
		expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
		expect(state.notifiedMedications).toContain("user_42_2026-07-11_prescription");
		expect(updateUserReminderSentTimeMock).toHaveBeenCalledWith(42, "prescription", "push", "Aspirin");
	});

	it("logs a failed stock delivery, releases its lock, and leaves it eligible for a retry", async () => {
		getAllUserSettingsMock.mockResolvedValue([
			createSettings({
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrStockReminders: true,
			}),
		]);
		queueMedicationQueries([createMedication()], [], [], [createMedication()], [], []);
		sendPushNotificationMock
			.mockResolvedValueOnce({ success: false, error: "provider unavailable" })
			.mockResolvedValueOnce({ success: true });
		const logger = createLogger();

		await runReminderSchedulerNow(logger as never);
		expect(logger.error).toHaveBeenCalledWith("[Reminder] Failed to send stock push: provider unavailable");
		expect(state.notifiedMedications).not.toContain("user_42_2026-07-11_stock");

		await runReminderSchedulerNow(logger as never);

		expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
		expect(unlinkSyncMock).toHaveBeenCalledTimes(2);
		expect(state.notifiedMedications).toContain("user_42_2026-07-11_stock");
	});

	it("starts once and clears the scheduled timer during shutdown", () => {
		const logger = createLogger();

		startReminderScheduler(logger as never);
		startReminderScheduler(logger as never);
		stopReminderScheduler();

		expect(logger.info).toHaveBeenCalledWith("[Reminder] Scheduler already started, skipping duplicate start call");
		expect(vi.getTimerCount()).toBe(0);
		expect(state.nextScheduledCheck).toBe("2026-07-11T06:00:00.000Z");
	});
});
