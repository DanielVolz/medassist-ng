import type { FastifyInstance } from "fastify";
import { createAuthPrivateRoutes } from "./auth-private-routes.js";
import { authPublicRoutes } from "./auth-public-routes.js";

export async function authRoutes(app: FastifyInstance) {
	const registerPrivateRoutes = createAuthPrivateRoutes(app);
	// Keep both groups on the same instance, in the original registration order.
	authPublicRoutes(app);
	registerPrivateRoutes();
}
