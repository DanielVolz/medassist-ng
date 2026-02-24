export function createCorrelationId(prefix: string = "fe"): string {
	const randomPart = Math.random().toString(36).slice(2, 10);
	return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

export function withCorrelation(
	init?: RequestInit,
	prefix: string = "fe"
): { correlationId: string; init: RequestInit } {
	const correlationId = createCorrelationId(prefix);
	const headers = new Headers(init?.headers ?? {});
	headers.set("x-correlation-id", correlationId);
	return {
		correlationId,
		init: {
			...init,
			headers,
		},
	};
}
