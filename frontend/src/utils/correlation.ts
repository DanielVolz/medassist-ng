function createCorrelationId(prefix = "fe"): string {
	const randomPart = Math.random().toString(36).slice(2, 10);
	return `${prefix}-${Date.now()}-${randomPart}`;
}

export function withCorrelation(init: RequestInit, prefix = "fe"): { correlationId: string; init: RequestInit } {
	const correlationId = createCorrelationId(prefix);
	const headers = new Headers(init.headers ?? undefined);
	headers.set("x-correlation-id", correlationId);

	return {
		correlationId,
		init: {
			...init,
			headers,
		},
	};
}
