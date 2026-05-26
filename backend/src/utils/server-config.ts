/**
 * Utility functions for server configuration.
 * Exported separately to allow testing without triggering server start.
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CookieSerializeOptions } from "@fastify/cookie";
import { getDataDir } from "../db/path-utils.js";
import { parseStringListEnv } from "./env-parsing.js";

/**
 * Parse comma-separated CORS origins string
 */
export function parseCorsOrigins(originsStr: string): string[] {
	return parseStringListEnv(originsStr);
}

/**
 * Build base cookie options for access token
 */
export function buildBaseCookieOptions(accessTtlMinutes: number, isProduction: boolean): CookieSerializeOptions {
	return {
		httpOnly: true,
		secure: isProduction,
		sameSite: "lax",
		path: "/",
		maxAge: accessTtlMinutes * 60, // Convert minutes to seconds
	};
}

/**
 * Build refresh cookie options (extends base with longer TTL)
 */
export function buildRefreshCookieOptions(
	baseCookieOptions: CookieSerializeOptions,
	refreshTtlDays: number
): CookieSerializeOptions {
	return {
		...baseCookieOptions,
		maxAge: refreshTtlDays * 24 * 60 * 60, // Convert days to seconds
	};
}

/**
 * Build complete app configuration object
 */
export interface AppConfigOptions {
	jwtSecret?: string;
	refreshSecret?: string;
	accessTtlMinutes: number;
	refreshTtlDays: number;
	isProduction: boolean;
}

export interface AppConfig {
	accessSecret: string;
	refreshSecret: string;
	accessTtl: number;
	refreshTtl: number;
	cookieOptions: CookieSerializeOptions;
	refreshCookieOptions: CookieSerializeOptions;
}

export function buildAppConfig(options: AppConfigOptions): AppConfig {
	const cookieOptions = buildBaseCookieOptions(options.accessTtlMinutes, options.isProduction);
	const refreshCookieOptions = buildRefreshCookieOptions(cookieOptions, options.refreshTtlDays);

	return {
		accessSecret: options.jwtSecret || "",
		refreshSecret: options.refreshSecret || "",
		accessTtl: options.accessTtlMinutes,
		refreshTtl: options.refreshTtlDays,
		cookieOptions,
		refreshCookieOptions,
	};
}

/**
 * Ensure images directory exists
 */
export function ensureImagesDirectory(cwd?: string): string {
	const imagesDir = resolve(getDataDir(cwd), "images");
	if (!existsSync(imagesDir)) {
		mkdirSync(imagesDir, { recursive: true });
	}
	return imagesDir;
}

/**
 * Get JWT configuration based on auth enabled status
 */
export interface JwtConfig {
	secret: string;
	cookie: {
		cookieName: string;
		signed: boolean;
	};
}

export function getJwtConfig(authEnabled: boolean, jwtSecret?: string): JwtConfig {
	const effectiveSecret = authEnabled && jwtSecret ? jwtSecret : "auth-disabled-no-secret-needed";

	return {
		secret: effectiveSecret,
		cookie: {
			cookieName: "access_token",
			signed: false,
		},
	};
}
