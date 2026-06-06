import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockedEnv,
	createNotificationActionContextMock,
	storeNotificationActionGroupNtfyMessageIdMock,
	sendPushNotificationMock,
} = vi.hoisted(() => ({
	mockedEnv: {
		PUBLIC_APP_URL: undefined as string | undefined,
		CORS_ORIGINS: "http://localhost:5173" as string,
	},
	createNotificationActionContextMock: vi.fn(),
	storeNotificationActionGroupNtfyMessageIdMock: vi.fn(),
	sendPushNotificationMock: vi.fn(),
}));

vi.mock("node:fs", () => ({
	existsSync: () => false,
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

vi.mock("../db/path-utils.js", () => ({
	getDataDir: () => "/tmp",
}));

vi.mock("../db/client.js", () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
	},
	migrationsReady: Promise.resolve(),
}));

vi.mock("../plugins/env.js", () => ({ env: mockedEnv }));

vi.mock("../services/notification-actions-service.js", () => ({
	createNotificationActionContext: createNotificationActionContextMock,
	storeNotificationActionGroupNtfyMessageId: storeNotificationActionGroupNtfyMessageIdMock,
}));

vi.mock("../services/notifications/delivery.js", () => ({
	getSmtpConfig: vi.fn(() => null),
	sendEmailNotification: vi.fn(),
	sendPushNotification: sendPushNotificationMock,
}));

vi.mock("../services/notifications/state.js", () => ({
	updateReminderSentTime: vi.fn(),
	updateUserReminderSentTime: vi.fn(),
}));

vi.mock("../utils/scheduler-utils.js", async () => {
	const actual = await vi.importActual<typeof import("../utils/scheduler-utils.js")>("../utils/scheduler-utils.js");
	const candidate = {
		medName: "Calcium",
		intakeTime: new Date("2026-01-05T11:15:00.000Z"),
		intakeTimeStr: "11:15",
		usage: 1,
		takenBy: null,
		pillWeightMg: null,
		doseUnit: "mg",
	};

	return {
		...actual,
		getEffectiveTimezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
		getDateLocale: () => "en-US",
		normalizeMedicationSchedule: () => ({
			intakes: [
				{
					usage: 1,
					every: 1,
					start: "2026-01-05T10:45:00.000Z",
					takenBy: null,
					intakeRemindersEnabled: true,
				},
			],
			takenBy: [],
		}),
		getTodaysIntakes: () => [candidate],
		getUpcomingIntakes: () => [candidate],
	};
});

import { db } from "../db/client.js";
import { checkAndSendIntakeRemindersForUser } from "../services/intake-reminder-scheduler.js";

function createLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function mockSelectWhere<T>(result: T) {
	return {
		from: () => ({
			where: async () => result,
		}),
	} as never;
}

describe("intake reminder scheduler action wiring", () => {
	const mockedDb = vi.mocked(db);
	let originalTz: string | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 0, 5, 10, 30, 0));
		originalTz = process.env.TZ;
		process.env.TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
		mockedEnv.PUBLIC_APP_URL = undefined;
		mockedEnv.CORS_ORIGINS = "http://localhost:5173";
		createNotificationActionContextMock.mockReset();
		storeNotificationActionGroupNtfyMessageIdMock.mockReset();
		sendPushNotificationMock.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		if (originalTz === undefined) {
			delete process.env.TZ;
		} else {
			process.env.TZ = originalTz;
		}
	});

	it("attaches action context to push notifications when PUBLIC_APP_URL is configured", async () => {
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "push-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 11,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		createNotificationActionContextMock.mockResolvedValue({
			groupId: 41,
			actions: [
				{
					kind: "taken",
					label: "Taken",
					url: "https://app.example.com/api/notification-actions/taken",
					method: "POST",
				},
			],
			respondUrl: "https://app.example.com/api/notification-actions/respond",
			viewUrl: "https://app.example.com/?date=2026-01-05",
			sequenceId: "medassist-sequence",
		});
		sendPushNotificationMock.mockResolvedValue({ success: true, providerMessageId: "ntfy-msg-1" });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 11,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(createNotificationActionContextMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 11,
				publicAppUrl: "https://app.example.com",
				language: "en",
				actionMode: "full",
				doseIds: [expect.stringMatching(/^7-0-/)],
			})
		);
		expect(sendPushNotificationMock).toHaveBeenCalledWith(
			"ntfy://ntfy.sh/medassist",
			expect.any(String),
			expect.any(String),
			expect.objectContaining({
				actions: [
					{
						kind: "taken",
						label: "Taken",
						url: "https://app.example.com/api/notification-actions/taken",
						method: "POST",
					},
				],
				respondUrl: "https://app.example.com/api/notification-actions/respond",
				viewUrl: "https://app.example.com/?date=2026-01-05",
				clickUrl: "https://app.example.com/api/notification-actions/respond",
				sequenceId: "medassist-sequence",
				tags: ["pill"],
				priority: 3,
			})
		);
		expect(storeNotificationActionGroupNtfyMessageIdMock).toHaveBeenCalledWith(41, "ntfy-msg-1");
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Notification action context ready"));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Sending push reminder"));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Push delivered"));
	});

	it("uses view-only actions for grouped intake reminders", async () => {
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "grouped-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 13,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
					{
						id: 8,
						userId: 13,
						name: "Vitamin D",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		createNotificationActionContextMock.mockResolvedValue({
			actions: [
				{
					kind: "view",
					label: "View",
					url: "https://app.example.com/dashboard?day=2026-01-05&dose=7-0-1736075700000",
					method: "GET",
				},
			],
			viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=7-0-1736075700000",
		});
		sendPushNotificationMock.mockResolvedValue({ success: true });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 13,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(createNotificationActionContextMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 13,
				publicAppUrl: "https://app.example.com",
				language: "en",
				actionMode: "view-only",
				doseIds: [expect.stringMatching(/^7-0-/), expect.stringMatching(/^8-0-/)],
			})
		);
		expect(sendPushNotificationMock).toHaveBeenCalledWith(
			"ntfy://ntfy.sh/medassist",
			expect.any(String),
			expect.any(String),
			expect.objectContaining({
				actions: [
					{
						kind: "view",
						label: "View",
						url: "https://app.example.com/dashboard?day=2026-01-05&dose=7-0-1736075700000",
						method: "GET",
					},
				],
				respondUrl: undefined,
				viewUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=7-0-1736075700000",
				clickUrl: "https://app.example.com/dashboard?day=2026-01-05&dose=7-0-1736075700000",
				sequenceId: undefined,
				tags: ["pill"],
				priority: 3,
			})
		);
	});

	it("sends push notifications without actions when PUBLIC_APP_URL is missing", async () => {
		createNotificationActionContextMock.mockResolvedValue(null);

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "pushless-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 12,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		sendPushNotificationMock.mockResolvedValue({ success: true });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 12,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(createNotificationActionContextMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 12,
				publicAppUrl: undefined,
			})
		);
		expect(sendPushNotificationMock).toHaveBeenCalledWith(
			"ntfy://ntfy.sh/medassist",
			expect.any(String),
			expect.any(String),
			expect.objectContaining({
				actions: undefined,
				respondUrl: undefined,
				viewUrl: undefined,
				clickUrl: undefined,
				tags: ["pill"],
				priority: 3,
			})
		);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("No reachable public app URL configured; sending intake reminders without actions")
		);
	});

	it("falls back to push delivery without actions when action context generation fails", async () => {
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "context-failure-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 15,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		createNotificationActionContextMock.mockRejectedValue(new Error("action context write failed"));
		sendPushNotificationMock.mockResolvedValue({ success: true });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 15,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(sendPushNotificationMock).toHaveBeenCalledWith(
			"ntfy://ntfy.sh/medassist",
			expect.any(String),
			expect.any(String),
			expect.objectContaining({
				actions: undefined,
				respondUrl: undefined,
				viewUrl: undefined,
				clickUrl: undefined,
			})
		);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Notification action context failed"));
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining("Sending intake reminders without actions after action context failure")
		);
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Sending push reminder"));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Push delivered"));
	});

	it("logs enriched push delivery failures with action context metadata", async () => {
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "push-failure-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 16,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		createNotificationActionContextMock.mockResolvedValue({
			groupId: 52,
			actions: [
				{
					kind: "taken",
					label: "Taken",
					url: "https://app.example.com/api/notification-actions/taken",
					method: "POST",
				},
			],
			respondUrl: "https://app.example.com/api/notification-actions/respond",
			viewUrl: "https://app.example.com/?date=2026-01-05",
			sequenceId: "medassist-sequence",
		});
		sendPushNotificationMock.mockResolvedValue({ success: false, error: "HTTP 500: upstream down" });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 16,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Notification action context ready"));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Sending push reminder"));
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Push delivery failed"));
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("provider=ntfy"));
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("actionMode=full"));
		expect(storeNotificationActionGroupNtfyMessageIdMock).not.toHaveBeenCalled();
	});

	it("warns but keeps reminder flow alive when ntfy message id persistence fails", async () => {
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "persist-warning-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 17,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 1,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		createNotificationActionContextMock.mockResolvedValue({
			groupId: 77,
			actions: [
				{
					kind: "taken",
					label: "Taken",
					url: "https://app.example.com/api/notification-actions/taken",
					method: "POST",
				},
			],
			respondUrl: "https://app.example.com/api/notification-actions/respond",
			viewUrl: "https://app.example.com/?date=2026-01-05",
			sequenceId: "medassist-sequence",
		});
		sendPushNotificationMock.mockResolvedValue({ success: true, providerMessageId: "ntfy-msg-77" });
		storeNotificationActionGroupNtfyMessageIdMock.mockRejectedValue(new Error("db write failed"));

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 17,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(storeNotificationActionGroupNtfyMessageIdMock).toHaveBeenCalledWith(77, "ntfy-msg-77");
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Failed to store ntfy message id"));
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Push delivered"));
	});

	it("does not send intake reminders for reminder-enabled medications with empty stock", async () => {
		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "empty-stock-user" }]))
			.mockImplementationOnce(() =>
				mockSelectWhere([
					{
						id: 7,
						userId: 14,
						name: "Calcium",
						genericName: null,
						takenByJson: null,
						packageType: "blister",
						medicationForm: "tablet",
						packCount: 0,
						blistersPerPack: 1,
						pillsPerBlister: 10,
						looseTablets: 0,
						stockAdjustment: 0,
						pillWeightMg: null,
						doseUnit: "mg",
						isObsolete: false,
						intakeRemindersEnabled: true,
						intakesJson: "[]",
						usageJson: "[]",
						everyJson: "[]",
						startJson: "[]",
					},
				])
			)
			.mockImplementationOnce(() => mockSelectWhere([]));

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 14,
				language: "en",
				stockCalculationMode: "manual",
				emailEnabled: false,
				notificationEmail: null,
				emailIntakeReminders: false,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(createNotificationActionContextMock).not.toHaveBeenCalled();
		expect(sendPushNotificationMock).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Skipping reminder-enabled medications with empty stock")
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("No reminder-eligible medications with stock remaining")
		);
	});
});
