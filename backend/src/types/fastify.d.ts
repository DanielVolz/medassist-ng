import "fastify";
import type { JwtSignOptions, JwtVerifyOptions } from "../plugins/jwt.js";

// User type for authenticated requests
export interface AuthUser {
	id: number;
	username: string;
}

export interface AuthContext {
	method: "session" | "api_key";
	scope: "read" | "write";
	apiKeyId?: number;
}

declare module "fastify" {
	interface FastifyInstance {
		config: {
			accessSecret: string;
			refreshSecret: string;
			accessTtl: number;
			refreshTtl: number;
			cookieOptions: import("@fastify/cookie").CookieSerializeOptions;
			refreshCookieOptions: import("@fastify/cookie").CookieSerializeOptions;
		};
		jwt: {
			sign(payload: Record<string, unknown>, options?: JwtSignOptions): Promise<string>;
			verify<T extends Record<string, unknown>>(token: string, options?: JwtVerifyOptions): Promise<T>;
		};
	}

	interface FastifyRequest {
		user?: AuthUser | null;
		authContext?: AuthContext;
		correlationId?: string;
		jwtVerify<T extends Record<string, unknown>>(options?: JwtVerifyOptions): Promise<T>;
	}
}
