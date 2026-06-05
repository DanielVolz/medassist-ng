/**
 * Utility functions for server configuration.
 * Exported separately to allow testing without triggering server start.
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CookieSerializeOptions } from "@fastify/cookie";
import { getDataDir } from "../db/path-utils.js";
import { parseStringListEnv } from "./env-parsing.js";

export const DEFAULT_CORS_ORIGINS = "http://localhost:5173,http://localhost:4174";
export const DEFAULT_LOG_LEVEL = "info";
export const DEFAULT_COOKIE_SECRET = "dev-cookie-secret";
export const DEFAULT_ACCESS_TOKEN_TTL_MINUTES = 15;
export const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 7;
export const DEFAULT_RATE_LIMIT_MAX = 100;
export const DEFAULT_RATE_LIMIT_TIME_WINDOW = "1 minute";
export const DEFAULT_MULTIPART_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

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

export interface CreateAppOptions {
	logLevel?: string;
	corsOrigins?: string[];
	authEnabled?: boolean;
	jwtSecret?: string;
	refreshSecret?: string;
	cookieSecret?: string;
	accessTtlMinutes?: number;
	refreshTtlDays?: number;
	isProduction?: boolean;
	imagesDir?: string;
	openApiDocsEnabled?: boolean;
	docsAuthRequired?: boolean;
	rateLimitMax?: number;
}

export interface RuntimeAppEnv {
	LOG_LEVEL: string;
	CORS_ORIGINS: string;
	AUTH_ENABLED: boolean;
	JWT_SECRET?: string;
	REFRESH_SECRET?: string;
	COOKIE_SECRET?: string;
	ACCESS_TOKEN_TTL_MINUTES: number;
	REFRESH_TOKEN_TTL_DAYS: number;
	NODE_ENV: string;
	OPENAPI_DOCS_ENABLED: boolean;
	DOCS_AUTH_REQUIRED: boolean;
	RATE_LIMIT_MAX: number;
}

export function buildRuntimeAppOptions(env: RuntimeAppEnv, imagesDir: string): CreateAppOptions {
	return {
		logLevel: env.LOG_LEVEL,
		corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
		authEnabled: env.AUTH_ENABLED,
		jwtSecret: env.JWT_SECRET,
		refreshSecret: env.REFRESH_SECRET,
		cookieSecret: env.COOKIE_SECRET,
		accessTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
		refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
		isProduction: env.NODE_ENV === "production",
		imagesDir,
		openApiDocsEnabled: env.OPENAPI_DOCS_ENABLED,
		docsAuthRequired: env.DOCS_AUTH_REQUIRED,
		rateLimitMax: env.RATE_LIMIT_MAX,
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
