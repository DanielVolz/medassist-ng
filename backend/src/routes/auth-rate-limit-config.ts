// lgtm[js/missing-rate-limiting]
export const sensitiveRateLimitConfig = {
	max: 5, // 5 requests
	timeWindow: "15 minutes", // per 15 minutes (for login/register)
	errorResponseBuilder: () => ({
		statusCode: 429,
		error: "Too many attempts. Please try again later.",
		code: "RATE_LIMIT_EXCEEDED",
	}),
};
