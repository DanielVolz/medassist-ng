import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentationSchemaAjv } from "../utils/documentation-schema-keywords.js";

type OidcMocks = {
	discovery: ReturnType<typeof vi.fn>;
	buildAuthorizationUrl: ReturnType<typeof vi.fn>;
};

async function buildOidcApp(envOverrides: Record<string, unknown>) {
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

	vi.doMock("../db/client.js", () => ({
		db: {
			select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
			insert: vi.fn(() => ({
				values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([{ id: 1, username: "sso-user" }]) })),
			})),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
		},
	}));

	const discovery = vi.fn().mockResolvedValue({ issuer: "https://issuer.example.com" });
	const buildAuthorizationUrl = vi.fn().mockImplementation((_cfg, params) => {
		const state = typeof params?.state === "string" ? params.state : "state";
		return new URL(`https://issuer.example.com/authorize?state=${state}`);
	});

	vi.doMock("openid-client", () => ({
		discovery,
		buildAuthorizationUrl,
		authorizationCodeGrant: vi.fn(),
		fetchUserInfo: vi.fn(),
	}));

	const { oidcRoutes } = await import("../routes/oidc.js");

	const app = Fastify({ logger: false, ajv: documentationSchemaAjv });
	await app.register(cookie, { secret: "test-cookie-secret" });
	app.decorate("config", {
		accessSecret: "test-jwt-secret-12345",
		refreshSecret: "test-refresh-secret-12345",
		accessTtl: 15 * 60,
		refreshTtl: 7 * 24 * 60 * 60,
		cookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/" },
		refreshCookieOptions: { httpOnly: true, sameSite: "lax", secure: false, path: "/auth" },
	});
	await app.register(oidcRoutes);
	await app.ready();

	return {
		app,
		mocks: { discovery, buildAuthorizationUrl } as OidcMocks,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("OIDC routes", () => {
	it("returns 400 on login and callback when oidc is disabled", async () => {
		const { app } = await buildOidcApp({ OIDC_ENABLED: false });
		try {
			const login = await app.inject({ method: "GET", url: "/auth/oidc/login" });
			const callback = await app.inject({ method: "GET", url: "/auth/oidc/callback" });

			expect(login.statusCode).toBe(400);
			expect(callback.statusCode).toBe(400);
		} finally {
			await app.close();
		}
	});

	it("redirects to provider and sets PKCE cookies on /auth/oidc/login", async () => {
		const { app, mocks } = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await app.inject({ method: "GET", url: "/auth/oidc/login" });

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toContain("https://issuer.example.com/authorize");
			expect(res.cookies.some((c) => c.name === "oidc_code_verifier")).toBe(true);
			expect(res.cookies.some((c) => c.name === "oidc_state")).toBe(true);
			expect(mocks.discovery).toHaveBeenCalledTimes(1);
			expect(mocks.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
		} finally {
			await app.close();
		}
	});

	it("redirects with provider error when callback contains error params", async () => {
		const { app } = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await app.inject({
				method: "GET",
				url: "/auth/oidc/callback?error=access_denied&error_description=user_cancelled",
			});

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("http://localhost:5173");
		} finally {
			await app.close();
		}
	});

	it("redirects when callback is missing required params", async () => {
		const { app } = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await app.inject({ method: "GET", url: "/auth/oidc/callback" });

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("http://localhost:5173");
		} finally {
			await app.close();
		}
	});

	it("redirects when callback state validation fails", async () => {
		const { app } = await buildOidcApp({ OIDC_ENABLED: true });
		try {
			const res = await app.inject({
				method: "GET",
				url: "/auth/oidc/callback?code=abc123&state=state123",
			});

			expect(res.statusCode).toBe(302);
			expect(res.headers.location).toBe("http://localhost:5173");
		} finally {
			await app.close();
		}
	});
});
