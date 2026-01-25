import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Medication } from "../../types";
import { generateICS } from "../../utils/ics";

describe("generateICS", () => {
	let mockCreateObjectURL: ReturnType<typeof vi.fn>;
	let mockRevokeObjectURL: ReturnType<typeof vi.fn>;
	let mockAppendChild: ReturnType<typeof vi.fn>;
	let mockRemoveChild: ReturnType<typeof vi.fn>;
	let mockClick: ReturnType<typeof vi.fn>;
	let createdLink: HTMLAnchorElement | null = null;

	beforeEach(() => {
		mockCreateObjectURL = vi.fn().mockReturnValue("blob:test-url");
		mockRevokeObjectURL = vi.fn();
		mockAppendChild = vi.fn();
		mockRemoveChild = vi.fn();
		mockClick = vi.fn();

		global.URL.createObjectURL = mockCreateObjectURL;
		global.URL.revokeObjectURL = mockRevokeObjectURL;

		vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
			mockAppendChild(node);
			createdLink = node as HTMLAnchorElement;
			return node;
		});
		vi.spyOn(document.body, "removeChild").mockImplementation(mockRemoveChild);

		// Mock createElement to track the created anchor
		const originalCreateElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation((tag) => {
			const element = originalCreateElement(tag);
			if (tag === "a") {
				element.click = mockClick;
			}
			return element;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		createdLink = null;
	});

	const createTestMed = (overrides?: Partial<Medication>): Medication => ({
		id: 1,
		name: "TestMed",
		genericName: "Generic Test",
		packCount: 1,
		blistersPerPack: 1,
		pillsPerBlister: 30,
		looseTablets: 0,
		takenBy: ["John"],
		pillWeightMg: 100,
		blisters: [
			{
				usage: 1,
				every: 1,
				start: "2024-03-15T09:00:00",
			},
		],
		notes: "Take with food",
		updatedAt: null,
		...overrides,
	});

	it("creates and downloads ICS file", () => {
		const med = createTestMed();

		generateICS(med);

		expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
		expect(mockAppendChild).toHaveBeenCalledTimes(1);
		expect(mockClick).toHaveBeenCalledTimes(1);
		expect(mockRemoveChild).toHaveBeenCalledTimes(1);
		expect(mockRevokeObjectURL).toHaveBeenCalledWith("blob:test-url");
	});

	it("generates correct filename", () => {
		const med = createTestMed({ name: "Test Med/Special" });

		generateICS(med);

		expect(createdLink?.download).toBe("Test_Med_Special_schedule.ics");
	});

	it("creates blob with text/calendar content type", () => {
		const med = createTestMed();

		generateICS(med);

		expect(mockCreateObjectURL).toHaveBeenCalled();
		const blobArg = mockCreateObjectURL.mock.calls[0][0];
		expect(blobArg).toBeInstanceOf(Blob);
		expect(blobArg.type).toBe("text/calendar;charset=utf-8");
	});

	it("handles medication with multiple blisters", () => {
		const med = createTestMed({
			blisters: [
				{ usage: 1, every: 1, start: "2024-03-15T09:00:00" },
				{ usage: 2, every: 7, start: "2024-03-15T21:00:00" },
			],
		});

		expect(() => generateICS(med)).not.toThrow();
		expect(mockCreateObjectURL).toHaveBeenCalled();
	});

	it("handles medication without optional fields", () => {
		const med = createTestMed({
			genericName: undefined,
			pillWeightMg: undefined,
			takenBy: [],
			notes: undefined,
		});

		expect(() => generateICS(med)).not.toThrow();
	});

	it("handles medication with empty blisters", () => {
		const med = createTestMed({ blisters: [] });

		expect(() => generateICS(med)).not.toThrow();
	});

	it("handles plural pills correctly", () => {
		const singlePillMed = createTestMed({
			blisters: [{ usage: 1, every: 1, start: "2024-03-15T09:00:00" }],
		});

		const multiPillMed = createTestMed({
			blisters: [{ usage: 2, every: 1, start: "2024-03-15T09:00:00" }],
		});

		expect(() => generateICS(singlePillMed)).not.toThrow();
		expect(() => generateICS(multiPillMed)).not.toThrow();
	});

	it("handles different interval values", () => {
		const dailyMed = createTestMed({
			blisters: [{ usage: 1, every: 1, start: "2024-03-15T09:00:00" }],
		});

		const weeklyMed = createTestMed({
			blisters: [{ usage: 1, every: 7, start: "2024-03-15T09:00:00" }],
		});

		expect(() => generateICS(dailyMed)).not.toThrow();
		expect(() => generateICS(weeklyMed)).not.toThrow();
	});
});
