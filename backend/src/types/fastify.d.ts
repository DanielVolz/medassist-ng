import "fastify";
import "@fastify/jwt";

// User type for authenticated requests
export interface AuthUser {
	id: number;
	username: string;
	role: string;
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
	}

	interface FastifyRequest {
		user?: AuthUser | null;
	}
}

declare module "@fastify/jwt" {
	interface FastifyJWT {
		// Allow flexible payload for access and refresh tokens
		payload: Record<string, unknown>;
		user: Record<string, unknown>;
	}
}
