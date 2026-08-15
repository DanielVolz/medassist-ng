import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AsNeededIntakeRequestError, useAsNeededIntakes } from "../../hooks/useAsNeededIntakes";

const authFetchMock = vi.fn();

vi.mock("../../components/Auth", () => ({
	useAuth: () => ({ authFetch: authFetchMock }),
}));

describe("useAsNeededIntakes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("posts the owner-scoped endpoint with one stable intent key and payload", async () => {
		const response = { event: { eventId: "event-1" }, inventory: { currentStock: 9 } };
		authFetchMock.mockResolvedValue({ ok: true, json: async () => response });
		const { result } = renderHook(() => useAsNeededIntakes());

		let received: unknown;
		await act(async () => {
			received = await result.current.recordAsNeededIntake({
				medicationId: 42,
				quantity: 0.5,
				person: null,
				idempotencyKey: "stable-intent-key",
			});
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/medications/42/as-needed-intakes",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json", "Idempotency-Key": "stable-intent-key" },
				body: JSON.stringify({ quantity: 0.5, person: null }),
			})
		);
		expect(received).toBe(response);
	});

	it("preserves server codes and Retry-After for a safe same-intent retry", async () => {
		authFetchMock.mockResolvedValue({
			ok: false,
			headers: new Headers({ "Retry-After": "17" }),
			json: async () => ({ code: "TOO_MANY_NEW_INTAKES" }),
		});
		const { result } = renderHook(() => useAsNeededIntakes());

		await expect(
			result.current.recordAsNeededIntake({ medicationId: 1, quantity: 1, person: "Alex", idempotencyKey: "retry-key" })
		).rejects.toEqual(expect.objectContaining({ code: "TOO_MANY_NEW_INTAKES", retryAfterSeconds: 17 }));
	});

	it("posts a reversal with its stable intent key and exposes the current revision from a conflict", async () => {
		authFetchMock.mockResolvedValue({
			ok: false,
			headers: new Headers(),
			json: async () => ({ code: "EVENT_VERSION_CONFLICT", currentRevision: 3 }),
		});
		const { result } = renderHook(() => useAsNeededIntakes());

		await expect(
			result.current.reverseAsNeededIntake({ eventId: "event-42", expectedRevision: 2, idempotencyKey: "reverse-key" })
		).rejects.toEqual(expect.objectContaining({ code: "EVENT_VERSION_CONFLICT", currentRevision: 3 }));
		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/as-needed-intakes/event-42/reversal",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json", "Idempotency-Key": "reverse-key" },
				body: JSON.stringify({ expectedRevision: 2 }),
			})
		);
	});

	it("includes a replacement link only when the caller supplies one", async () => {
		authFetchMock.mockResolvedValue({ ok: true, json: async () => ({ event: {}, inventory: {} }) });
		const { result } = renderHook(() => useAsNeededIntakes());

		await result.current.recordAsNeededIntake({
			medicationId: 42,
			quantity: 1,
			person: null,
			idempotencyKey: "replacement-key",
			replacementForEventId: "reversed-event",
		});

		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/medications/42/as-needed-intakes",
			expect.objectContaining({
				body: JSON.stringify({ quantity: 1, person: null, replacementForEventId: "reversed-event" }),
			})
		);
	});

	it("maps a transport failure to the translated uncertain-result state", async () => {
		authFetchMock.mockRejectedValue(new Error("connection dropped"));
		const { result } = renderHook(() => useAsNeededIntakes());

		await expect(
			result.current.recordAsNeededIntake({ medicationId: 1, quantity: 1, person: null, idempotencyKey: "network-key" })
		).rejects.toBeInstanceOf(AsNeededIntakeRequestError);
		await expect(
			result.current.recordAsNeededIntake({ medicationId: 1, quantity: 1, person: null, idempotencyKey: "network-key" })
		).rejects.toEqual(expect.objectContaining({ code: "NETWORK_ERROR" }));
	});

	it("lists corrected history with a bounded cursor request and forwards cancellation", async () => {
		const response = { events: [], nextCursor: "next-page" };
		const controller = new AbortController();
		authFetchMock.mockResolvedValue({ ok: true, json: async () => response });
		const { result } = renderHook(() => useAsNeededIntakes());

		await expect(result.current.listAsNeededIntakes(42, "cursor-1", controller.signal)).resolves.toBe(response);
		expect(authFetchMock).toHaveBeenCalledWith(
			"/api/medications/42/as-needed-intakes?includeReversed=true&limit=10&cursor=cursor-1",
			{ signal: controller.signal }
		);
	});

	it("maps unavailable history responses and transport failures to safe errors", async () => {
		const { result } = renderHook(() => useAsNeededIntakes());
		authFetchMock.mockResolvedValueOnce({ ok: false });
		await expect(result.current.listAsNeededIntakes(1)).rejects.toEqual(
			expect.objectContaining({ code: "HISTORY_UNAVAILABLE" })
		);

		authFetchMock.mockRejectedValueOnce(new Error("offline"));
		await expect(result.current.listAsNeededIntakes(1)).rejects.toEqual(
			expect.objectContaining({ code: "NETWORK_ERROR" })
		);
	});
});
