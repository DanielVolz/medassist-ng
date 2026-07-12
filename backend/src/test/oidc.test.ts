import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, closeTestApp } from "./setup.js";

type OidcMocks = {
	discovery: ReturnType<typeof vi.fn>;
	buildAuthorizationUrl: ReturnType<typeof vi.fn>;
	authorizationCodeGrant: ReturnType<typeof vi.fn>;
	fetchUserInfo: ReturnType<typeof vi.fn>;
	db: {
		select: ReturnType<typeof vi.fn>;
		insert: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	};
};

type JwtPayloadWithExp = Record<string, unknown> & { exp?: number; sub?: number; type?: string };

type OidcAppOptions = {
	selectResults?: unknown[][];
	insertReturning?: unknown[];
	userInfo?: Record<string, string>;
};

function buildCookieHeader(cookies: Array<{ name: string; value: string }>): string {
	return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function getLocationState(location: string | string[] | undefined): string {
	expect(location).toBeDefined();
	const locationValue = Array.isArray(location) ? location[0] : location;
	return new URL(locationValue ?? "").searchParams.get("state") ?? "";
}

async function buildOidcApp(envOverrides: Record<string, unknown>, options: OidcAppOptions = {}) {
	vi.resetModules();

	const env = {
		OIDC_ENABLED: true,
		OIDC_ISSUER_URL: "https://issuer.example.com",
		OIDC_CLIENT_ID: "medassist-client",
		OIDC_CLIENT_SECRET: "medassist-client-secret",
		OIDC_REDIRECT_URI: "https://app.example.com/api/auth/oidc/callback",
		OIDC_SCOPES: "openid profile email",
		OIDC_AUTO_CREATE_USERS: true,
		OIDC_USERNAME_CLAIM: "preferred_username",
		OIDC_PROVIDER_NAME: "SSO",
		NODE_ENV: "test",
		CORS_ORIGINS: "http://localhost:5173",
		ACCESS_TOKEN_TTL_MINUTES: 15,
		REFRESH_TOKEN_TTL_DAYS: 7,
		...envOverrides,
	};

	vi.doMock("../plugins/env.js", () => ({ env }));

	const selectResults = [...(options.selectResults ?? [[]])];
	const where = vi.fn().mockImplementation(() => Promise.resolve(selectResults.shift() ?? []));
	const returning = vi.fn().mockResolvedValue(options.insertReturning ?? [{ id: 1, username: "sso-user" }]);
	const values = vi.fn(() => ({ returning }));
	const updateWhere = vi.fn().mockResolvedValue(undefined);
	const set = vi.fn(() => ({ where: updateWhere }));
	const dbMock = {
		select: vi.fn(() => ({ from: vi.fn(() => ({ where })) })),
		insert: vi.fn(() => ({ values })),
		update: vi.fn(() => ({ set })),
	};

	vi.doMock("../db/client.js", () => ({
		db: dbMock,
	}));

	const discovery = vi.fn().mockResolvedValue({ issuer: "https://issuer.example.com" });
	const buildAuthorizationUrl = vi.fn().mockImplementation((_cfg, params) => {
		const state = typeof params?.state === "string" ? params.state : "state";
		return new URL(`https://issuer.example.com/authorize?state=${state}`);
	});
	const authorizationCodeGrant = vi.fn().mockResolvedValue({
		access_token: "oidc-provider-access-token",
		claims: () => ({ sub: "oidc-subject-1" }),
	});
	const fetchUserInfo = vi.fn().mockResolvedValue(
		options.userInfo ?? {
			sub: "oidc-subject-1",
			preferred_username: "sso-user",
			email: "sso-user@example.com",
		}
	);

	vi.doMock("openid-client", () => ({
		discovery,
		buildAuthorizationUrl,
		authorizationCodeGrant,
		fetchUserInfo,
	}));

	const { oidcRoutes } = await import("../routes/oidc.js");

	const testContext = await buildTestApp({
		config: {
			accessSecret: "test-jwt-secret-12345",
			refreshSecret: "test-refresh-secret-12345",
			refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/auth" },
		},
	});
	await testContext.app.register(oidcRoutes);
	await testContext.app.ready();

	return {
		...testContext,
		mocks: { discovery, buildAuthorizationUrl, authorizationCodeGrant, fetchUserInfo, db: dbMock } as OidcMocks,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("OIDC routes", () => {
	it("returns 400 on login and callback when oidc is disabled", async () => {
		const testContext = await buildOidcApp({ OIDC_ENABLED: false });
		try {
			const login = await testContext.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const callback = await testContext.app.inject({ method: "GET", url: "/auth/oidc/callback" });

			expect(login.statusCode).toBe(400);
			expect(callback.statusCode).toBe(400);
		} finally {
			await closeTestApp(testContext);
		}
	});

	it("redirects to provider and sets PKCE cookies on /auth/oidc/login", async () => {
		const testContext = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await testContext.app.inject({ method: "GET", url: "/auth/oidc/login" });

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toContain("https://issuer.example.com/authorize");
			expect(res.cookies.some((c) => c.name === "oidc_code_verifier")).toBe(true);
			expect(res.cookies.some((c) => c.name === "oidc_state")).toBe(true);
			expect(testContext.mocks.discovery).toHaveBeenCalledTimes(1);
			expect(testContext.mocks.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
		} finally {
			await closeTestApp(testContext);
		}
	});

	it("redirects with provider error when callback contains error params", async () => {
		const testContext = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await testContext.app.inject({
				method: "GET",
				url: "/auth/oidc/callback?error=access_denied&error_description=user_cancelled",
			});

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("http://localhost:5173");
		} finally {
			await closeTestApp(testContext);
		}
	});

	it("redirects when callback is missing required params", async () => {
		const testContext = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await testContext.app.inject({ method: "GET", url: "/auth/oidc/callback" });

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("http://localhost:5173");
		} finally {
			await closeTestApp(testContext);
		}
	});

	it("redirects when callback state validation fails", async () => {
		const testContext = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await testContext.app.inject({
				method: "GET",
				url: "/auth/oidc/callback?code=abc123&state=state123",
			});

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("http://localhost:5173");
		} finally {
			await closeTestApp(testContext);
		}
	});

	it("does not auto-link an OIDC subject to an existing local username", async () => {
		const testContext = await buildOidcApp(
			{ OIDC_ENABLED: true },
			{
				selectResults: [[], [{ id: 42, username: "victim", authProvider: "local", oidcSubject: null }]],
				userInfo: {
					sub: "attacker-oidc-subject",
					preferred_username: "victim",
					email: "victim@example.com",
				},
			}
		);
		try {
			const login = await testContext.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const state = getLocationState(login.headers.location);

			const callback = await testContext.app.inject({
				method: "GET",
				url: `/auth/oidc/callback?code=abc123&state=${state}`,
				headers: { cookie: buildCookieHeader(login.cookies) },
			});

			expect(callback.statusCode).toBe(302);
			expect(callback.headers.location).toBe("http://localhost:5173");
			expect(testContext.mocks.db.update).not.toHaveBeenCalled();
			expect(testContext.mocks.db.insert).not.toHaveBeenCalled();
		} finally {
			await closeTestApp(testContext);
		}
	});

	it("signs OIDC refresh tokens with the configured refresh secret", async () => {
		const testContext = await buildOidcApp(
			{ OIDC_ENABLED: true },
			{
				selectResults: [[], []],
				insertReturning: [{ id: 7, username: "sso-user" }],
			}
		);
		try {
			const login = await testContext.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const state = getLocationState(login.headers.location);

			const callback = await testContext.app.inject({
				method: "GET",
				url: `/auth/oidc/callback?code=abc123&state=${state}`,
				headers: { cookie: buildCookieHeader(login.cookies) },
			});

			expect(callback.statusCode).toBe(302);
			expect(callback.headers.location).toBe("http://localhost:5173/dashboard");

			const refreshCookie = callback.cookies.find((c) => c.name === "refresh_token");
			expect(refreshCookie).toBeDefined();

			const refreshPayload = await testContext.app.jwt.verify<JwtPayloadWithExp>(refreshCookie?.value ?? "", {
				key: testContext.app.config.refreshSecret,
			});
			expect(refreshPayload.sub).toBe(7);
			expect(refreshPayload.type).toBe("refresh");
			await expect(testContext.app.jwt.verify(refreshCookie?.value ?? "")).rejects.toThrow();
		} finally {
			await closeTestApp(testContext);
		}
	});
});
