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
});
