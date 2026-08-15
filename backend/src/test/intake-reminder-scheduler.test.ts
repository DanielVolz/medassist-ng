import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { checkAndSendIntakeRemindersForUser } from "../services/intake-reminder-scheduler.js";

const { getActiveAsNeededStockEffectsMilliMock } = vi.hoisted(() => ({
	getActiveAsNeededStockEffectsMilliMock: vi.fn(async () => new Map<number, number>()),
}));

vi.mock("../db/client.js", () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
	},
}));

vi.mock("../services/as-needed-intakes-service.js", () => ({
	getActiveAsNeededStockEffectsMilli: getActiveAsNeededStockEffectsMilliMock,
}));

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

function createMedicationRow(overrides: Record<string, unknown> = {}, intakeOverrides: Record<string, unknown> = {}) {
	const intakeRemindersEnabled = Boolean(overrides.intakeRemindersEnabled ?? false);

	return {
		id: 7,
		userId: 11,
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
		intakeRemindersEnabled,
		intakesJson: JSON.stringify([
			{
				usage: 1,
				every: 1,
				start: "2026-01-05T08:00:00.000Z",
				takenBy: null,
				intakeRemindersEnabled,
				...intakeOverrides,
			},
		]),
		usageJson: "[]",
		everyJson: "[]",
		startJson: "[]",
		...overrides,
	};
}

function mockReminderQueries(medicationRows: Array<Record<string, unknown>>) {
	vi.mocked(db.select)
		.mockImplementationOnce(() => mockSelectWhere([{ username: "test-user" }]))
		.mockImplementationOnce(() => mockSelectWhere(medicationRows))
		.mockImplementationOnce(() => mockSelectWhere([]))
		.mockImplementationOnce(() => mockSelectWhere([]));
}

function captureInsertedRows() {
	const insertedRows: Array<Record<string, unknown>> = [];

	vi.mocked(db.insert).mockImplementation(
		() =>
			({
				values: async (row: Record<string, unknown>) => {
					insertedRows.push(row);
				},
			}) as never
	);

	return insertedRows;
}

async function runReminderCheck(settings: Record<string, unknown>, logger: ReturnType<typeof createLogger>) {
	await checkAndSendIntakeRemindersForUser(
		{
			userId: 11,
			language: "en",
			stockCalculationMode: "automatic",
			emailEnabled: false,
			notificationEmail: null,
			emailIntakeReminders: false,
			shoutrrrEnabled: false,
			shoutrrrUrl: null,
			shoutrrrIntakeReminders: false,
			repeatRemindersEnabled: false,
			...settings,
		} as never,
		logger as never
	);
}

describe("checkAndSendIntakeRemindersForUser", () => {
	let originalTz: string | undefined;

	beforeEach(() => {
		getActiveAsNeededStockEffectsMilliMock.mockReset();
		getActiveAsNeededStockEffectsMilliMock.mockResolvedValue(new Map());
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 0, 5, 10, 30, 0));
		originalTz = process.env.TZ;
		process.env.TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

	it("auto-marks due intakes in automatic mode even when all intake reminder channels are disabled", async () => {
		const insertedRows = captureInsertedRows();
		mockReminderQueries([createMedicationRow()]);
		const logger = createLogger();

		await runReminderCheck({}, logger);

		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			userId: 11,
			doseId: `7-0-${new Date(2026, 0, 5).getTime()}`,
			markedBy: null,
			takenSource: "automatic",
			dismissed: false,
		});
		expect(logger.info).toHaveBeenCalledWith("[IntakeReminder] Auto-mark completed for userId=11: inserted=1");
		expect(getActiveAsNeededStockEffectsMilliMock).toHaveBeenCalledTimes(1);
	});

	it("uses the active aggregate at the automatic reminder stock gate", async () => {
		getActiveAsNeededStockEffectsMilliMock.mockResolvedValue(new Map([[7, 10_000]]));
		const insertedRows = captureInsertedRows();
		mockReminderQueries([createMedicationRow()]);
		await runReminderCheck({}, createLogger());
		expect(insertedRows).toHaveLength(0);
		expect(getActiveAsNeededStockEffectsMilliMock).toHaveBeenCalledTimes(1);
	});

	it("does not auto-mark due intakes when current stock is empty", async () => {
		const insertedRows = captureInsertedRows();
		mockReminderQueries([createMedicationRow({ packCount: 0 })]);
		const logger = createLogger();

		await runReminderCheck({}, logger);

		expect(insertedRows).toHaveLength(0);
		expect(logger.info).not.toHaveBeenCalledWith("[IntakeReminder] Auto-marked 1 due intake dose(s) as taken");
	});

	it("suppresses intake notifications entirely when automatic mode and skip-taken reminders are both enabled", async () => {
		const insertedRows = captureInsertedRows();
		mockReminderQueries([createMedicationRow({ intakeRemindersEnabled: true })]);
		const logger = createLogger();

		await runReminderCheck(
			{
				skipRemindersForTakenDoses: true,
				emailEnabled: true,
				notificationEmail: "user@example.com",
				emailIntakeReminders: true,
			},
			logger
		);

		expect(insertedRows).toHaveLength(1);
		expect(logger.info).not.toHaveBeenCalledWith("[IntakeReminder] Sending reminder for 1 intakes...");
		expect(logger.error).not.toHaveBeenCalled();
	});
});
