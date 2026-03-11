import type { FastifyInstance, RouteOptions } from "fastify";

type SecurityEntry = Readonly<Record<string, readonly string[]>>;

const defaultProtectedSecurity: readonly SecurityEntry[] = [{ bearerAuth: [] }, { cookieAuth: [] }];

export const genericErrorSchema = {
	type: "object",
	properties: {
		error: { type: "string" },
		code: { type: "string" },
	},
} as const;

export const validationErrorSchema = {
	type: "object",
	additionalProperties: true,
} as const;

export const idParamsSchema = {
	type: "object",
	required: ["id"],
	properties: {
		id: { type: "string", pattern: "^\\d+$" },
	},
} as const;

export const tokenParamsSchema = {
	type: "object",
	required: ["token"],
	properties: {
		token: { type: "string", pattern: "^[a-f0-9]{16}$" },
	},
} as const;

export const successResponseSchema = {
	type: "object",
	properties: {
		success: { type: "boolean" },
	},
} as const;

export const messageResponseSchema = {
	type: "object",
	properties: {
		success: { type: "boolean" },
		message: { type: "string" },
	},
} as const;

export type OpenApiRouteStandardsOptions = {
	tag: string;
	protectedByDefault: boolean;
	protectedPaths?: RegExp[];
	publicPaths?: RegExp[];
};

function asMethods(method: RouteOptions["method"]): string[] {
	if (Array.isArray(method)) return method.map((m) => String(m).toUpperCase());
	return [String(method).toUpperCase()];
}

function pathMatches(path: string, patterns: RegExp[] | undefined): boolean {
	if (!patterns || patterns.length === 0) return false;
	return patterns.some((pattern) => pattern.test(path));
}

function buildDefaultSummary(methods: string[], path: string): string {
	const methodText = methods.join("/");
	return `${methodText} ${path}`;
}

function buildDefaultDescription(requiresAuth: boolean): string {
	return requiresAuth
		? "Protected endpoint. Requires Bearer token (API key or JWT) or session cookie."
		: "Public endpoint.";
}

export function applyOpenApiRouteStandards(app: FastifyInstance, options: OpenApiRouteStandardsOptions): void {
	app.addHook("onRoute", (routeOptions) => {
		const methods = asMethods(routeOptions.method);
		const path = routeOptions.url;

		const isExplicitlyPublic = pathMatches(path, options.publicPaths);
		const isExplicitlyProtected = pathMatches(path, options.protectedPaths);
		let requiresAuth = options.protectedByDefault;
		if (isExplicitlyPublic) {
			requiresAuth = false;
		} else if (isExplicitlyProtected) {
			requiresAuth = true;
		}

		routeOptions.schema = routeOptions.schema ?? {};
		routeOptions.schema.tags = routeOptions.schema.tags ?? [options.tag];
		routeOptions.schema.summary = routeOptions.schema.summary ?? buildDefaultSummary(methods, path);
		routeOptions.schema.description = routeOptions.schema.description ?? buildDefaultDescription(requiresAuth);

		if (requiresAuth) {
			routeOptions.schema.security = routeOptions.schema.security ?? defaultProtectedSecurity;
			routeOptions.schema.response = {
				...(routeOptions.schema.response ?? {}),
				401: (routeOptions.schema.response as Record<number | string, unknown> | undefined)?.[401] ?? {
					type: "object",
					properties: {
						error: { type: "string" },
						code: { type: "string" },
					},
				},
			};
		} else if (routeOptions.schema.security === undefined) {
			routeOptions.schema.security = [];
		}
	});
}
