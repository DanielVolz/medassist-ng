import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/client.js";
import { checkAndSendIntakeRemindersForUser } from "../services/intake-reminder-scheduler.js";

vi.mock("../db/client.js", () => ({
	db: {
		select: vi.fn(),
		insert: vi.fn(),
	},
}));

function createLogger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

describe("checkAndSendIntakeRemindersForUser", () => {
	const mockedDb = vi.mocked(db);
	let originalTz: string | undefined;

	beforeEach(() => {
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
		const insertedRows: Array<Record<string, unknown>> = [];
		const selectMock = vi.mocked(mockedDb.select);
		const insertMock = vi.mocked(mockedDb.insert);

		selectMock
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: () => ({
								limit: async () => [{ username: "auto-user" }],
							}),
						}),
					}) as never
			)
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: () => ({
								orderBy: async () => [
									{
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
										intakeRemindersEnabled: false,
										intakesJson: JSON.stringify([
											{
												usage: 1,
												every: 1,
												start: "2026-01-05T08:00:00.000Z",
												takenBy: null,
												intakeRemindersEnabled: false,
											},
										]),
										usageJson: "[]",
										everyJson: "[]",
										startJson: "[]",
									},
								],
							}),
						}),
					}) as never
			)
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: async () => [],
						}),
					}) as never
			)
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: async () => [],
						}),
					}) as never
			);

		insertMock.mockImplementation(
			() =>
				({
					values: async (row: Record<string, unknown>) => {
						insertedRows.push(row);
					},
				}) as never
		);

		const logger = createLogger();

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
			} as never,
			logger as never
		);

		expect(insertedRows).toHaveLength(1);
		expect(insertedRows[0]).toMatchObject({
			userId: 11,
			doseId: `7-0-${new Date(2026, 0, 5).getTime()}`,
			markedBy: null,
			takenSource: "automatic",
			dismissed: false,
		});
		expect(logger.info).toHaveBeenCalledWith("[IntakeReminder] Auto-marked 1 due intake dose(s) as taken");
	});

	it("does not auto-mark due intakes when current stock is empty", async () => {
		const insertedRows: Array<Record<string, unknown>> = [];
		const selectMock = vi.mocked(mockedDb.select);
		const insertMock = vi.mocked(mockedDb.insert);

		selectMock
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: () => ({
								limit: async () => [{ username: "auto-user" }],
							}),
						}),
					}) as never
			)
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: () => ({
								orderBy: async () => [
									{
										id: 7,
										userId: 11,
										name: "Vitamin D",
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
										intakeRemindersEnabled: false,
										intakesJson: JSON.stringify([
											{
												usage: 1,
												every: 1,
												start: "2026-01-05T08:00:00.000Z",
												takenBy: null,
												intakeRemindersEnabled: false,
											},
										]),
										usageJson: "[]",
										everyJson: "[]",
										startJson: "[]",
									},
								],
							}),
						}),
					}) as never
			)
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: async () => [],
						}),
					}) as never
			)
			.mockImplementationOnce(
				() =>
					({
						from: () => ({
							where: async () => [],
						}),
					}) as never
			);

		insertMock.mockImplementation(
			() =>
				({
					values: async (row: Record<string, unknown>) => {
						insertedRows.push(row);
					},
				}) as never
		);

		const logger = createLogger();

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
			} as never,
			logger as never
		);

		expect(insertedRows).toHaveLength(0);
		expect(logger.info).not.toHaveBeenCalledWith("[IntakeReminder] Auto-marked 1 due intake dose(s) as taken");
	});
});
