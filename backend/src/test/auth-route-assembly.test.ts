import type { RouteOptions } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "../plugins/auth.js";
import { authRoutes } from "../routes/auth.js";
import { buildTestApp } from "./setup.js";

// Registration-only assertions must not initialize or access the runtime database.
vi.mock("../db/client.js", () => ({ db: {}, withImmediateWriteTransaction: vi.fn() }));

describe("auth route assembly", () => {
	it("registers public then private routes on the same instance with existing guards and limits", async () => {
		const { app, client } = await buildTestApp();
		const routes: RouteOptions[] = [];
		const captureOrder: string[] = [];
		for (const key of ["accessTtl", "refreshTtl"] as const) {
			const value = app.config[key];
			Object.defineProperty(app.config, key, {
				get: () => {
					captureOrder.push(key);
					return value;
				},
			});
		}
		app.addHook("onRoute", function (route) {
			expect(this).toBe(app);
			captureOrder.push(route.url);
			if (route.method !== "HEAD") routes.push(route);
		});
		try {
			await authRoutes(app);
			expect(captureOrder.slice(0, 3)).toEqual(["accessTtl", "refreshTtl", "/auth/state"]);
			expect(routes.map((route) => `${route.method} ${route.url}`)).toEqual([
				"GET /auth/state",
				"POST /auth/register",
				"POST /auth/login",
				"POST /auth/forgot-password",
				"POST /auth/reset-password",
				"POST /auth/refresh",
				"POST /auth/logout",
				"GET /auth/me",
				"PUT /auth/me",
				"POST /auth/avatar",
				"DELETE /auth/avatar",
				"DELETE /auth/me",
			]);
			for (const route of routes.slice(7)) expect(route.preHandler).toBe(requireAuth);
			expect(routes[0].config?.rateLimit).toMatchObject({ max: 60, timeWindow: "1 minute" });
			expect(routes[1].config?.rateLimit).toMatchObject({ max: 5, timeWindow: "15 minutes" });
			expect(routes[3].config?.rateLimit).toMatchObject({ max: 3, timeWindow: "15 minutes" });
			expect(routes[5].config?.rateLimit).toMatchObject({ max: 10, timeWindow: "1 minute" });
			expect(routes[11].config?.rateLimit).toBe(routes[1].config?.rateLimit);
		} finally {
			await app.close();
			client.close();
		}
	});
});
