import { useCallback } from "react";
import { useAuth } from "../components/Auth";
import type { AsNeededIntakeMutationResponse } from "../types";

export class AsNeededIntakeRequestError extends Error {
	constructor(
		public readonly code: string,
		public readonly retryAfterSeconds: number | null = null
	) {
		super(code);
		this.name = "AsNeededIntakeRequestError";
	}
}

export function useAsNeededIntakes() {
	const { authFetch } = useAuth();

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
					body: JSON.stringify({ quantity: input.quantity, person: input.person }),
				});
			} catch {
				throw new AsNeededIntakeRequestError("NETWORK_ERROR");
			}

			if (!response.ok) {
				const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
				let code = "UNKNOWN_ERROR";
				try {
					const body = (await response.json()) as { code?: unknown };
					if (typeof body.code === "string") code = body.code;
				} catch {
					// The translated UI uses the stable fallback code for malformed error responses.
				}
				throw new AsNeededIntakeRequestError(code, Number.isFinite(retryAfter) ? retryAfter : null);
			}

			return (await response.json()) as AsNeededIntakeMutationResponse;
		},
		[authFetch]
	);

	return { recordAsNeededIntake };
}
