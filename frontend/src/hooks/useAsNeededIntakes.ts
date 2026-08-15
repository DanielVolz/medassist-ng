import { useCallback } from "react";
import { useAuth } from "../components/Auth";
import type { AsNeededIntakeListResponse, AsNeededIntakeMutationResponse } from "../types";

export class AsNeededIntakeRequestError extends Error {
	constructor(
		public readonly code: string,
		public readonly retryAfterSeconds: number | null = null
	) {
		super(code);
		this.name = "AsNeededIntakeRequestError";
	}
}

async function getMutationError(response: Response): Promise<AsNeededIntakeRequestError> {
	const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
	let code = "UNKNOWN_ERROR";
	try {
		const body = (await response.json()) as { code?: unknown };
		if (typeof body.code === "string") code = body.code;
	} catch {
		// The translated UI uses stable fallbacks for malformed error responses.
	}
	return new AsNeededIntakeRequestError(code, Number.isFinite(retryAfter) ? retryAfter : null);
}

export function useAsNeededIntakes() {
	const { authFetch } = useAuth();
	const listAsNeededIntakes = useCallback(
		async (medicationId: number, cursor?: string, signal?: AbortSignal): Promise<AsNeededIntakeListResponse> => {
			const query = new URLSearchParams({ includeReversed: "false", limit: "10" });
			if (cursor) query.set("cursor", cursor);

			let response: Response;
			try {
				response = await authFetch(`/api/medications/${medicationId}/as-needed-intakes?${query}`, { signal });
			} catch {
				throw new AsNeededIntakeRequestError("NETWORK_ERROR");
			}
			if (!response.ok) throw new AsNeededIntakeRequestError("HISTORY_UNAVAILABLE");
			return (await response.json()) as AsNeededIntakeListResponse;
		},
		[authFetch]
	);

	const recordAsNeededIntake = useCallback(
		async (input: {
			medicationId: number;
			quantity: number;
			person: string | null;
			idempotencyKey: string;
		}): Promise<AsNeededIntakeMutationResponse> => {
			let response: Response;
			try {
				response = await authFetch(`/api/medications/${input.medicationId}/as-needed-intakes`, {
					method: "POST",
					headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
					body: JSON.stringify({
						quantity: input.quantity,
						person: input.person,
					}),
				});
			} catch {
				throw new AsNeededIntakeRequestError("NETWORK_ERROR");
			}

			if (!response.ok) throw await getMutationError(response);

			return (await response.json()) as AsNeededIntakeMutationResponse;
		},
		[authFetch]
	);

	const undoAsNeededIntake = useCallback(
		async (eventId: string): Promise<void> => {
			let response: Response;
			try {
				response = await authFetch(`/api/as-needed-intakes/${eventId}`, {
					method: "DELETE",
				});
			} catch {
				throw new AsNeededIntakeRequestError("NETWORK_ERROR");
			}
			if (!response.ok) throw await getMutationError(response);
		},
		[authFetch]
	);

	return { listAsNeededIntakes, recordAsNeededIntake, undoAsNeededIntake };
}
