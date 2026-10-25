import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockedEnv,
	createNotificationActionContextMock,
	storeNotificationActionGroupNtfyMessageIdMock,
	sendPushNotificationMock,
	getSmtpConfigMock,
	sendEmailNotificationMock,
	existsSyncMock,
	readFileSyncMock,
	writeFileSyncMock,
	getActiveAsNeededStockEffectsMilliMock,
} = vi.hoisted(() => ({
	mockedEnv: {
		PUBLIC_APP_URL: undefined as string | undefined,
		CORS_ORIGINS: "http://localhost:5173" as string,
	},
	createNotificationActionContextMock: vi.fn(),
	storeNotificationActionGroupNtfyMessageIdMock: vi.fn(),
	sendPushNotificationMock: vi.fn(),
	getSmtpConfigMock: vi.fn(() => ({
		host: undefined,
		user: undefined,
		pass: undefined,
		port: 587,
		secure: false,
		from: undefined,
	})),
	sendEmailNotificationMock: vi.fn(),
	existsSyncMock: vi.fn(() => false),
	readFileSyncMock: vi.fn(),
	writeFileSyncMock: vi.fn(),
	getActiveAsNeededStockEffectsMilliMock: vi.fn(async () => new Map<number, number>()),
}));

vi.mock("node:fs", () => ({
	existsSync: existsSyncMock,
	readFileSync: readFileSyncMock,
	writeFileSync: writeFileSyncMock,
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

vi.mock("../services/as-needed-intakes-service.js", () => ({
	filterScheduledDoseRows: async <T>(_: unknown, __: number, rows: T[]) => rows,
	getActiveAsNeededStockEffectsMilli: getActiveAsNeededStockEffectsMilliMock,
	getAsNeededAnchorDoseIds: async () => new Set<string>(),
}));

vi.mock("../services/notifications/delivery.js", () => ({
	getSmtpConfig: getSmtpConfigMock,
	sendEmailNotification: sendEmailNotificationMock,
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
		getTodaysIntakes: (medName: string) => [{ ...candidate, medName }],
		getUpcomingIntakes: (medName: string) => [{ ...candidate, medName }],
	};
});

import { db } from "../db/client.js";
import { checkAndSendIntakeRemindersForUser } from "../services/intake-reminder-scheduler.js";
import { getSmtpConfig, sendEmailNotification } from "../services/notifications/delivery.js";
import { updateReminderSentTime, updateUserReminderSentTime } from "../services/notifications/state.js";

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

function createReminderMedicationRow(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		userId: 18,
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
		...overrides,
	};
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
		vi.mocked(getSmtpConfig).mockReset();
		vi.mocked(getSmtpConfig).mockReturnValue({
			host: undefined,
			user: undefined,
			pass: undefined,
			port: 587,
			secure: false,
			from: undefined,
		});
		vi.mocked(sendEmailNotification).mockReset();
		vi.mocked(sendEmailNotification).mockResolvedValue({ success: true });
		existsSyncMock.mockReset();
		existsSyncMock.mockReturnValue(false);
		readFileSyncMock.mockReset();
		readFileSyncMock.mockReturnValue("");
		writeFileSyncMock.mockReset();
		vi.mocked(updateReminderSentTime).mockReset();
		vi.mocked(updateUserReminderSentTime).mockReset();
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

	it("attaches Portuguese action context to push notifications when PUBLIC_APP_URL is configured", async () => {
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
				language: "pt-PT",
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
				language: "pt-PT",
				actionMode: "full",
				doseIds: [expect.stringMatching(/^7-0-/)],
			})
		);
		expect(sendPushNotificationMock).toHaveBeenCalledWith(
			"ntfy://ntfy.sh/medassist",
			expect.stringContaining("Aviso: Toma de medicamento"),
			expect.stringContaining("Enviado de MedAssist-ng"),
			expect.objectContaining({
				language: "pt-PT",
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

	it("sends per-dose actionable email and push reminders with shared action contexts", async () => {
		mockedEnv.PUBLIC_APP_URL = "https://app.example.com";
		vi.mocked(getSmtpConfig).mockReturnValue({
			host: "smtp.example.com",
			user: "medassist",
			pass: "smtp-test-pass",
			port: 587,
			secure: false,
			from: "medassist@example.com",
		});

		const selectMock = vi.mocked(mockedDb.select);
		const reminderMedications = [
			createReminderMedicationRow({ id: 7, userId: 13, name: "Calcium" }),
			createReminderMedicationRow({ id: 8, userId: 13, name: "Vitamin D" }),
		];
		const configureReminderQueries = () => {
			selectMock.mockReset();
			selectMock
				.mockImplementationOnce(() => mockSelectWhere([{ username: "grouped-user" }]))
				.mockImplementationOnce(() => mockSelectWhere(reminderMedications))
				.mockImplementationOnce(() => mockSelectWhere([]));
		};
		configureReminderQueries();

		createNotificationActionContextMock.mockImplementation(async (input) => {
			const doseId = input.doseIds[0];
			return {
				groupId: doseId.startsWith("7-") ? 71 : 81,
				sequenceId: `sequence-${doseId}`,
				respondUrl: `https://app.example.com/api/notification-actions/respond-${doseId}`,
				viewUrl: `https://app.example.com/dashboard?day=2026-01-05&dose=${doseId}`,
				actions: [
					{
						kind: "taken",
						label: "Take",
						url: `https://app.example.com/api/notification-actions/taken-${doseId}`,
						method: "POST",
					},
				],
			};
		});
		sendPushNotificationMock.mockResolvedValue({ success: true });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 13,
				language: "en-US",
				stockCalculationMode: "manual",
				emailEnabled: true,
				notificationEmail: "user@example.com",
				emailIntakeReminders: true,
				shoutrrrEnabled: true,
				shoutrrrUrl: "ntfy://ntfy.sh/medassist",
				shoutrrrIntakeReminders: true,
				repeatRemindersEnabled: false,
			} as never,
			logger as never
		);

		expect(createNotificationActionContextMock).toHaveBeenCalledTimes(2);
		const actionContextCalls = createNotificationActionContextMock.mock.calls.map(([input]) => input);
		expect(actionContextCalls.map((input) => input.doseIds)).toEqual([
			[expect.stringMatching(/^7-0-/)],
			[expect.stringMatching(/^8-0-/)],
		]);
		expect(actionContextCalls.every((input) => input.actionMode === "full")).toBe(true);

		expect(sendEmailNotification).toHaveBeenCalledTimes(1);
		const emailBody = vi.mocked(sendEmailNotification).mock.calls[0]?.[0];
		expect(emailBody?.text).toContain("Calcium");
		expect(emailBody?.text).toContain("Vitamin D");
		expect(emailBody?.text).toMatch(
			/Calcium[^\n]*\nRespond: https:\/\/app\.example\.com\/api\/notification-actions\/respond-7-0-/
		);
		expect(emailBody?.text).toMatch(
			/Vitamin D[^\n]*\nRespond: https:\/\/app\.example\.com\/api\/notification-actions\/respond-8-0-/
		);
		expect(emailBody?.html).toContain("Calcium");
		expect(emailBody?.html).toContain("Vitamin D");
		expect(emailBody?.html).toMatch(
			/<td[^>]*>Calcium<br \/><a href="https:\/\/app\.example\.com\/api\/notification-actions\/respond-7-0-[^"]+">Respond<\/a><\/td>/
		);
		expect(emailBody?.html).toMatch(
			/<td[^>]*>Vitamin D<br \/><a href="https:\/\/app\.example\.com\/api\/notification-actions\/respond-8-0-[^"]+">Respond<\/a><\/td>/
		);

		expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
		expect(sendPushNotificationMock.mock.calls[0]?.[3]).toMatchObject({
			actions: [expect.objectContaining({ kind: "taken", url: expect.stringContaining("taken-7-0-") })],
			respondUrl: expect.stringContaining("respond-7-0-"),
		});
		expect(sendPushNotificationMock.mock.calls[1]?.[3]).toMatchObject({
			actions: [expect.objectContaining({ kind: "taken", url: expect.stringContaining("taken-8-0-") })],
			respondUrl: expect.stringContaining("respond-8-0-"),
		});

		configureReminderQueries();
		createNotificationActionContextMock.mockReset().mockResolvedValue(null);
		vi.mocked(sendEmailNotification).mockClear();
		await checkAndSendIntakeRemindersForUser(
			{
				userId: 13,
				language: "en-US",
				stockCalculationMode: "manual",
				emailEnabled: true,
				notificationEmail: "user@example.com",
				emailIntakeReminders: true,
				shoutrrrEnabled: false,
				shoutrrrUrl: null,
				shoutrrrIntakeReminders: false,
				repeatRemindersEnabled: false,
			} as never,
			createLogger() as never
		);

		expect(sendEmailNotification).toHaveBeenCalledTimes(1);
		const fallbackEmail = vi.mocked(sendEmailNotification).mock.calls[0]?.[0];
		expect(fallbackEmail?.text).toContain("Calcium");
		expect(fallbackEmail?.text).toContain("Vitamin D");
		expect(fallbackEmail?.text).not.toContain("Respond:");
		expect(fallbackEmail?.html).toContain("Calcium");
		expect(fallbackEmail?.html).toContain("Vitamin D");
		expect(fallbackEmail?.html).not.toContain("Respond</a>");
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
				language: "en-US",
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
				language: "en-US",
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
				language: "en-US",
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
		expect(writeFileSyncMock).not.toHaveBeenCalled();
		expect(updateReminderSentTime).not.toHaveBeenCalled();
		expect(updateUserReminderSentTime).not.toHaveBeenCalled();
	});

	it("keeps a failed intake push eligible for retry and persists only the successful retry", async () => {
		for (let attempt = 0; attempt < 2; attempt++) {
			vi.mocked(mockedDb.select)
				.mockImplementationOnce(() => mockSelectWhere([{ username: "retry-user" }]))
				.mockImplementationOnce(() => mockSelectWhere([createReminderMedicationRow()]))
				.mockImplementationOnce(() => mockSelectWhere([]));
		}
		sendPushNotificationMock
			.mockResolvedValueOnce({ success: false, error: "provider unavailable" })
			.mockResolvedValueOnce({ success: true });
		const settings = {
			userId: 18,
			language: "en-US",
			stockCalculationMode: "manual",
			emailEnabled: false,
			shoutrrrEnabled: true,
			shoutrrrUrl: "ntfy://ntfy.sh/medassist",
			shoutrrrIntakeReminders: true,
			repeatRemindersEnabled: false,
		};
		const logger = createLogger();
		await checkAndSendIntakeRemindersForUser(settings as never, logger);
		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("provider unavailable"));
		expect(writeFileSyncMock).not.toHaveBeenCalled();
		expect(updateUserReminderSentTime).not.toHaveBeenCalled();
		await checkAndSendIntakeRemindersForUser(settings as never, logger);
		expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
		expect(writeFileSyncMock).toHaveBeenCalledOnce();
		const persisted = JSON.parse(String(writeFileSyncMock.mock.calls[0][1]));
		expect(Object.values(persisted.reminders)).toEqual([expect.objectContaining({ advanceSent: true, sendCount: 0 })]);
		expect(updateUserReminderSentTime).toHaveBeenCalledWith(18, "intake", "push", "Calcium", undefined);
	});

	it("does not resend an already persisted advance reminder after restart", async () => {
		const candidateTimeMs = new Date("2026-01-05T11:15:00.000Z").getTime();
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockReturnValue(
			JSON.stringify({
				reminders: {
					[`user_18:Calcium:${candidateTimeMs}`]: {
						firstSentAt: candidateTimeMs - 10 * 60 * 1000,
						lastSentAt: candidateTimeMs - 10 * 60 * 1000,
						sendCount: 0,
						advanceSent: true,
					},
				},
			})
		);

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "restart-user" }]))
			.mockImplementationOnce(() => mockSelectWhere([createReminderMedicationRow({ userId: 18 })]))
			.mockImplementationOnce(() => mockSelectWhere([]));

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 18,
				language: "en-US",
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
		expect(writeFileSyncMock).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("No reminders to send"));
	});

	it("falls back to default intake reminder state and logs when persisted state cannot be read", async () => {
		existsSyncMock.mockReturnValue(true);
		readFileSyncMock.mockImplementation(() => {
			throw new Error("state file unreadable");
		});

		const selectMock = vi.mocked(mockedDb.select);
		selectMock
			.mockImplementationOnce(() => mockSelectWhere([{ username: "corrupt-state-user" }]))
			.mockImplementationOnce(() => mockSelectWhere([createReminderMedicationRow({ userId: 19 })]))
			.mockImplementationOnce(() => mockSelectWhere([]));

		sendPushNotificationMock.mockResolvedValue({ success: true });

		const logger = createLogger();

		await checkAndSendIntakeRemindersForUser(
			{
				userId: 19,
				language: "en-US",
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

		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Failed to load reminder state file"));
		expect(sendPushNotificationMock).toHaveBeenCalledOnce();
		expect(writeFileSyncMock).toHaveBeenCalledOnce();
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
				language: "en-US",
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
				language: "en-US",
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
