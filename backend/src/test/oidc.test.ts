import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, closeTestApp } from "./setup.js";

type OidcMocks = {
	values: ReturnType<typeof vi.fn>;
	set: ReturnType<typeof vi.fn>;
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
	userInfo?: Record<string, unknown>;
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
		mocks: {
			discovery,
			buildAuthorizationUrl,
			authorizationCodeGrant,
			fetchUserInfo,
			db: dbMock,
			values,
			set,
		} as OidcMocks,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("OIDC routes", () => {
	it.each([
		["https://images.example.test/avatar.png#fragment", "https://images.example.test/avatar.png"],
		[undefined, ""],
		["javascript:alert(1)", ""],
	])("persists only safe provider pictures on creation and refresh (%#)", async (picture, expected) => {
		for (const existing of [false, true]) {
			const context = await buildOidcApp(
				{},
				{
					selectResults: existing
						? [[{ id: 8, username: "sso-user", isActive: true, avatarUrl: "local.webp", oidcPictureUrl: "old" }]]
						: [[], []],
					userInfo: { sub: "oidc-subject-1", preferred_username: "sso-user", picture },
				}
			);
			try {
				const login = await context.app.inject({ method: "GET", url: "/auth/oidc/login" });
				const callback = await context.app.inject({
					method: "GET",
					url: `/auth/oidc/callback?code=abc&state=${getLocationState(login.headers.location)}`,
					headers: { cookie: buildCookieHeader(login.cookies) },
				});
				expect(callback.headers.location).toBe("http://localhost:5173/dashboard");
				const saved = existing ? context.mocks.set.mock.calls[0][0] : context.mocks.values.mock.calls[0][0];
				expect(saved.oidcPictureUrl).toBe(expected);
				expect(saved).not.toHaveProperty("avatarUrl");
			} finally {
				await closeTestApp(context);
			}
		}
	});

	it.each([
		[true, "verified@example.com", "verified@example.com"],
		[false, "unverified@example.com", ""],
		[undefined, "missing-verification@example.com", ""],
		["true", "string-verification@example.com", ""],
		[true, "invalid-email", ""],
		[true, undefined, ""],
	])("persists only a valid email with boolean verified provenance: %s %s", async (verified, email, expected) => {
		const context = await buildOidcApp(
			{},
			{
				selectResults: [[], []],
				userInfo: { sub: "oidc-subject-1", preferred_username: "sso-user", email, email_verified: verified },
			}
		);
		try {
			const login = await context.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const callback = await context.app.inject({
				method: "GET",
				url: `/auth/oidc/callback?code=abc&state=${getLocationState(login.headers.location)}`,
				headers: { cookie: buildCookieHeader(login.cookies) },
			});
			expect(callback.headers.location).toBe("http://localhost:5173/dashboard");
			const account = context.mocks.values.mock.calls[0][0];
			expect(account).toMatchObject({ authProvider: "oidc", verifiedOidcEmail: expected, passwordHash: null });
			expect(account).not.toHaveProperty("email");
			// Identity resolution reads only subject and username, never matching email.
			expect(context.mocks.db.select).toHaveBeenCalledTimes(2);
		} finally {
			await closeTestApp(context);
		}
	});

	it.each([true, false])("refreshes or clears verified email on subsequent logins: %s", async (verified) => {
		const context = await buildOidcApp(
			{},
			{
				selectResults: [[{ id: 8, username: "sso-user", authProvider: "oidc", isActive: true }]],
				userInfo: {
					sub: "oidc-subject-1",
					preferred_username: "sso-user",
					email: "new@example.com",
					email_verified: verified,
				},
			}
		);
		try {
			const login = await context.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const callback = await context.app.inject({
				method: "GET",
				url: `/auth/oidc/callback?code=abc&state=${getLocationState(login.headers.location)}`,
				headers: { cookie: buildCookieHeader(login.cookies) },
			});
			expect(callback.headers.location).toBe("http://localhost:5173/dashboard");
			expect(context.mocks.set).toHaveBeenCalledWith(
				expect.objectContaining({
					verifiedOidcEmail: verified ? "new@example.com" : "",
				})
			);
			expect(context.mocks.db.select).toHaveBeenCalledTimes(1);
		} finally {
			await closeTestApp(context);
		}
	});

	it.each([
		[null, true],
		[null, false],
		["existing-password-hash", true],
		["existing-password-hash", false],
	])("accepts a subject-linked local account with passwordHash=%s and verified=%s", async (passwordHash, verified) => {
		const context = await buildOidcApp(
			{ OIDC_AUTO_CREATE_USERS: false },
			{
				selectResults: [
					[
						{
							id: 8,
							username: "linked-local-user",
							oidcSubject: "oidc-subject-1",
							authProvider: "local",
							passwordHash,
							email: "recovery@example.com",
							verifiedOidcEmail: "old@example.com",
							isActive: true,
						},
					],
				],
				userInfo: {
					sub: "oidc-subject-1",
					preferred_username: "different-provider-username",
					email: "new@example.com",
					email_verified: verified,
				},
			}
		);
		try {
			const login = await context.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const callback = await context.app.inject({
				method: "GET",
				url: `/auth/oidc/callback?code=abc&state=${getLocationState(login.headers.location)}`,
				headers: { cookie: buildCookieHeader(login.cookies) },
			});
			expect(callback.headers.location).toBe("http://localhost:5173/dashboard");
			const accessToken = callback.cookies.find((cookie) => cookie.name === "access_token");
			expect(accessToken).toBeDefined();
			expect(await context.app.jwt.verify(accessToken?.value ?? "")).toMatchObject({
				sub: 8,
				username: "linked-local-user",
			});
			expect(callback.cookies.some((cookie) => cookie.name === "refresh_token")).toBe(true);
			// Only passwordless rows are promoted; never rewrite local credentials or recovery email.
			expect(context.mocks.set.mock.calls[0][0]).toEqual({
				verifiedOidcEmail: verified ? "new@example.com" : "",
				oidcPictureUrl: "",
				updatedAt: expect.any(Date),
				...(passwordHash ? {} : { authProvider: "oidc" }),
			});
			expect(context.mocks.db.select).toHaveBeenCalledTimes(1);
			expect(context.mocks.values).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ userId: 8, tokenId: expect.any(String) })
			);
		} finally {
			await closeTestApp(context);
		}
	});

	it.each([
		["local", null],
		["local", "existing-password-hash"],
		["oidc", null],
	])("rejects disabled subject-linked accounts: %s %s", async (authProvider, passwordHash) => {
		const context = await buildOidcApp(
			{},
			{
				selectResults: [
					[
						{
							id: 8,
							username: "disabled-user",
							oidcSubject: "oidc-subject-1",
							authProvider,
							passwordHash,
							isActive: false,
						},
					],
				],
				userInfo: {
					sub: "oidc-subject-1",
					preferred_username: "disabled-user",
					email: "new@example.com",
					email_verified: true,
				},
			}
		);
		try {
			const login = await context.app.inject({ method: "GET", url: "/auth/oidc/login" });
			const callback = await context.app.inject({
				method: "GET",
				url: `/auth/oidc/callback?code=abc&state=${getLocationState(login.headers.location)}`,
				headers: { cookie: buildCookieHeader(login.cookies) },
			});
			expect(callback.headers.location).toBe("http://localhost:5173");
			expect(callback.cookies.some((cookie) => ["access_token", "refresh_token"].includes(cookie.name))).toBe(false);
			expect(context.mocks.db.update).not.toHaveBeenCalled();
			expect(context.mocks.db.insert).not.toHaveBeenCalled();
			expect(context.mocks.db.select).toHaveBeenCalledTimes(1);
		} finally {
			await closeTestApp(context);
		}
	});

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
