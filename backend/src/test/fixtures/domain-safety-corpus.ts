import type { IntakeScheduleMode, Weekday } from "../../utils/scheduler-utils.js";

export type ScheduleCorpusCase = {
	name: string;
	schedule: {
		every: number;
		start: string;
		scheduleMode?: IntakeScheduleMode;
		weekdays?: Weekday[];
	};
	rangeStart: string;
	rangeEnd: string;
	expectedCount: number;
};

export type DstCorpusCase = {
	name: string;
	timezone: string;
	scheduleStart: string;
	rangeStart: { year: number; monthIndex: number; day: number };
	rangeEnd: { year: number; monthIndex: number; day: number };
	expectedLocalDates: string[];
	expectedLocalHour: number;
};

export const scheduleCorpus: ScheduleCorpusCase[] = [
	{
		name: "daily interval",
		schedule: { every: 1, start: "2026-06-01T08:00:00" },
		rangeStart: "2026-06-01T00:00:00",
		rangeEnd: "2026-06-08T00:00:00",
		expectedCount: 7,
	},
	{
		name: "weekly interval",
		schedule: { every: 7, start: "2026-06-01T08:00:00" },
		rangeStart: "2026-06-01T00:00:00",
		rangeEnd: "2026-06-30T00:00:00",
		expectedCount: 5,
	},
	{
		name: "custom every-three-days interval",
		schedule: { every: 3, start: "2026-06-01T08:00:00" },
		rangeStart: "2026-06-01T00:00:00",
		rangeEnd: "2026-06-16T00:00:00",
		expectedCount: 5,
	},
	{
		name: "weekday schedule",
		schedule: {
			every: 1,
			start: "2026-06-01T08:00:00",
			scheduleMode: "weekdays",
			weekdays: ["mon", "wed", "fri"],
		},
		rangeStart: "2026-06-01T00:00:00",
		rangeEnd: "2026-06-15T00:00:00",
		expectedCount: 6,
	},
];

export const dstCorpus: DstCorpusCase[] = [
	{
		name: "Europe/Berlin spring forward keeps daily 08:00 wall-clock doses",
		timezone: "Europe/Berlin",
		scheduleStart: "2026-03-28T08:00:00",
		rangeStart: { year: 2026, monthIndex: 2, day: 28 },
		rangeEnd: { year: 2026, monthIndex: 2, day: 31 },
		expectedLocalDates: ["2026-03-28", "2026-03-29", "2026-03-30"],
		expectedLocalHour: 8,
	},
	{
		name: "Europe/Berlin fall back keeps daily 08:00 wall-clock doses",
		timezone: "Europe/Berlin",
		scheduleStart: "2026-10-24T08:00:00",
		rangeStart: { year: 2026, monthIndex: 9, day: 24 },
		rangeEnd: { year: 2026, monthIndex: 9, day: 27 },
		expectedLocalDates: ["2026-10-24", "2026-10-25", "2026-10-26"],
		expectedLocalHour: 8,
	},
	{
		name: "America/New_York spring forward keeps daily 08:00 wall-clock doses",
		timezone: "America/New_York",
		scheduleStart: "2026-03-07T08:00:00",
		rangeStart: { year: 2026, monthIndex: 2, day: 7 },
		rangeEnd: { year: 2026, monthIndex: 2, day: 10 },
		expectedLocalDates: ["2026-03-07", "2026-03-08", "2026-03-09"],
		expectedLocalHour: 8,
	},
	{
		name: "America/New_York fall back keeps daily 08:00 wall-clock doses",
		timezone: "America/New_York",
		scheduleStart: "2026-10-31T08:00:00",
		rangeStart: { year: 2026, monthIndex: 9, day: 31 },
		rangeEnd: { year: 2026, monthIndex: 10, day: 3 },
		expectedLocalDates: ["2026-10-31", "2026-11-01", "2026-11-02"],
		expectedLocalHour: 8,
	},
];

export const stockPropertyCorpus = [
	{ name: "no stock and one historical dose", stock: 0, doseCount: 1 },
	{ name: "single pill and repeated historical doses", stock: 1, doseCount: 5 },
	{ name: "small stock and many repeated historical doses", stock: 3, doseCount: 12 },
	{ name: "larger stock still clamps after excessive history", stock: 10, doseCount: 30 },
] as const;
