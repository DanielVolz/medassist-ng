import { TextEncoder } from "node:util";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify as verifyJwt } from "jose";

const JWT_ALGORITHM = "HS256";
const encoder = new TextEncoder();

export interface JwtPluginOptions {
	secret: string;
	cookie: {
		cookieName: string;
		signed: boolean;
	};
}

export interface JwtSignOptions {
	expiresIn?: string | number;
	key?: string;
}

export interface JwtVerifyOptions {
	key?: string;
}

function getKey(secret: string): Uint8Array {
	return encoder.encode(secret);
}

function getTokenFromRequest(request: FastifyRequest, cookieName: string): string {
	const authorization = request.headers.authorization;
	if (authorization) {
		const [scheme, rawToken] = authorization.split(" ");
		if (scheme?.toLowerCase() === "bearer" && rawToken?.trim()) {
			return rawToken.trim();
		}
	}

	const token = request.cookies?.[cookieName];
	if (typeof token === "string" && token.length > 0) {
		return token;
	}

	throw new Error("JWT token missing");
}

export const jwtPlugin: FastifyPluginAsync<JwtPluginOptions> = async (app, options) => {
	const defaultKey = getKey(options.secret);

	app.decorate("jwt", {
		sign(payload: Record<string, unknown>, signOptions?: JwtSignOptions) {
			const tokenBuilder = new SignJWT(payload).setProtectedHeader({ alg: JWT_ALGORITHM, typ: "JWT" }).setIssuedAt();

			if (signOptions?.expiresIn != null) {
				tokenBuilder.setExpirationTime(signOptions.expiresIn);
			}

			return tokenBuilder.sign(getKey(signOptions?.key ?? options.secret));
		},

		async verify<T extends Record<string, unknown>>(token: string, verifyOptions?: JwtVerifyOptions): Promise<T> {
			const { payload } = await verifyJwt(token, getKey(verifyOptions?.key ?? options.secret), {
				algorithms: [JWT_ALGORITHM],
				typ: "JWT",
			});

			return payload as T;
		},
	});

	app.decorateRequest("jwtVerify", async function jwtVerify<
		T extends Record<string, unknown>,
	>(this: FastifyRequest, verifyOptions?: JwtVerifyOptions): Promise<T> {
		const token = getTokenFromRequest(this, options.cookie.cookieName);
		const { payload } = await verifyJwt(token, verifyOptions?.key ? getKey(verifyOptions.key) : defaultKey, {
			algorithms: [JWT_ALGORITHM],
			typ: "JWT",
		});

		return payload as T;
	});
};
