import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	buildSandboxFrontendEnv,
	buildSandboxLaunchConfig,
	prepareSandboxData,
} from "./index.mjs";
import { sandboxViteOptions } from "../../frontend/scripts/ui-sandbox-vite.mjs";

const requiredKeys = ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"];
const smtpKeys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SMTP_SECURE"];
// All values in this file are disposable, fictional fixtures.
const oidcEntries = [
	"OIDC_ISSUER_URL=https://issuer.example.invalid",
	"export OIDC_CLIENT_ID='sandbox-fixture'",
	'OIDC_CLIENT_SECRET="fixture-only # not a comment"',
];

async function withFixture(run) {
	const projectRoot = mkdtempSync(resolve(tmpdir(), "medassist-ui-oidc-"));
	const originalRoot = mkdtempSync(resolve(tmpdir(), "medassist-ui-original-"));
	try {
		await run({ projectRoot, oidcEnvPath: resolve(originalRoot, ".env") });
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
		rmSync(originalRoot, { recursive: true, force: true });
	}
}

test("default sandbox remains anonymous, isolated and seeded without any OIDC configuration", async () => {
	await withFixture(async ({ projectRoot }) => {
		writeFileSync(resolve(projectRoot, ".env"),
			"SMTP_HOST=mail.example.invalid\nOIDC_ENABLED=true\nFORM_LOGIN_ENABLED=true\nREGISTRATION_ENABLED=true\n");
		const config = await buildSandboxLaunchConfig({
			projectRoot,
			inheritedEnv: {
				AUTH_ENABLED: "true", OIDC_ENABLED: "true",
				FORM_LOGIN_ENABLED: "true", REGISTRATION_ENABLED: "true",
			},
		});
		assert.equal(config.mode, "anonymous");
		assert.equal(config.backendEnv.AUTH_ENABLED, "false");
		assert.equal(config.backendEnv.OIDC_ENABLED, undefined);
		assert.equal(config.backendEnv.FORM_LOGIN_ENABLED, undefined);
		assert.equal(config.backendEnv.REGISTRATION_ENABLED, undefined);
		assert.equal(config.backendEnv.SMTP_HOST, "mail.example.invalid");
		assert.equal(config.backendEnv.PUBLIC_APP_URL, undefined);
		assert.equal(config.backendEnv.DATA_DIR, resolve(projectRoot, ".ui-dev/data"));
		assert.equal(config.backendEnv.DOTENV_PATH, "/dev/null");
		assert.equal(config.appUrl, "http://127.0.0.1:5176/dashboard");
		let seeds = 0;
		await prepareSandboxData(config.mode, async () => { seeds += 1; });
		assert.equal(seeds, 1);
	});
});

test("OIDC sandbox enables local login and registration alongside Pocket ID only in isolated loopback settings", async () => {
	await withFixture(async ({ projectRoot, oidcEnvPath }) => {
		const forbiddenKeys = [
			"SMTP_TOKEN", "SMTP_HOST_EXTRA", "API_KEY_PEPPER", "AUTH_SECRET",
			"DATABASE_URL", "DEFAULT_SHOUTRRR_URL",
			"DEFAULT_NOTIFICATION_EMAIL", "OIDC_SCOPES", "OIDC_AUTO_CREATE_USERS",
			"RATE_LIMIT_MAX",
		];
		const excluded = forbiddenKeys.map((key) => `${key}=excluded-fixture`).join("\n");
		writeFileSync(oidcEnvPath, `${oidcEntries.join("\n")}\n${excluded}
AUTH_ENABLED=false
OIDC_ENABLED=false
FORM_LOGIN_ENABLED=false
REGISTRATION_ENABLED=false
PUBLIC_APP_URL=https://production.example.invalid/private?fixture=excluded
OIDC_REDIRECT_URI=https://production.example.invalid/callback
CORS_ORIGINS=https://production.example.invalid
JWT_SECRET=excluded-fixture-jwt
REFRESH_SECRET=excluded-fixture-refresh
COOKIE_SECRET=excluded-fixture-cookie
DATA_DIR=/unrelated/data
`);
		// The target worktree's file must not supply OIDC values or a LAN URL.
		writeFileSync(resolve(projectRoot, ".env"), "PUBLIC_APP_URL=http://192.168.1.20\nOIDC_CLIENT_ID=wrong-fixture\n");
		const inheritedEnv = Object.fromEntries([...forbiddenKeys, ...requiredKeys].map((key) => [key, "excluded-inherited"]));
		Object.assign(inheritedEnv, {
			NODE_ENV: "production",
			FORM_LOGIN_ENABLED: "false",
			REGISTRATION_ENABLED: "false",
			UI_SANDBOX_HOST: "0.0.0.0",
			PUBLIC_APP_URL: "https://inherited.example.invalid/",
			...Object.fromEntries(smtpKeys.map((key) => [key, "excluded-inherited"])),
		});
		const config = await buildSandboxLaunchConfig({ mode: "oidc", projectRoot, oidcEnvPath, inheritedEnv });
		const env = config.backendEnv;
		for (const key of requiredKeys) assert.equal(typeof env[key], "string");
		assert.ok(env.OIDC_ISSUER_URL === "https://issuer.example.invalid");
		assert.ok(env.OIDC_CLIENT_ID === "sandbox-fixture");
		assert.ok(env.OIDC_CLIENT_SECRET === "fixture-only # not a comment");
		for (const key of forbiddenKeys) assert.equal(Object.hasOwn(env, key), false, `${key} must not be forwarded`);
		for (const key of smtpKeys) assert.equal(Object.hasOwn(env, key), false, `${key} must not be inherited`);
		assert.equal(env.PUBLIC_APP_URL, "http://localhost:5176/");
		for (const key of ["JWT_SECRET", "REFRESH_SECRET", "COOKIE_SECRET"]) {
			// Boolean assertions avoid including even generated keys in failure output.
			assert.ok(/^[a-f0-9]{64}$/.test(env[key]), `${key} must be sandbox-generated`);
		}
		assert.equal(env.AUTH_ENABLED, "true");
		assert.equal(env.NODE_ENV, "development");
		assert.equal(env.FORM_LOGIN_ENABLED, "true");
		assert.equal(env.REGISTRATION_ENABLED, "true");
		assert.equal(env.OIDC_ENABLED, "true");
		assert.equal(env.OIDC_PROVIDER_NAME, "Pocket ID");
		assert.equal(env.OIDC_REDIRECT_URI, "http://localhost:5176/api/auth/oidc/callback");
		assert.equal(env.CORS_ORIGINS, "http://localhost:5176");
		assert.equal(env.ALLOW_UNAUTHENTICATED, "false");
		assert.equal(env.UI_SANDBOX_MODE, "oidc");
		assert.equal(env.DATA_DIR, resolve(projectRoot, ".ui-dev/oidc-data"));
		assert.equal(env.DOTENV_PATH, "/dev/null");
		assert.equal(env.MEDICATION_ENRICHMENT_STARTUP_REFRESH_ENABLED, "false");
		assert.deepEqual(config.network, { host: "127.0.0.1", publicAppUrl: undefined });
		assert.equal(config.appUrl, "http://localhost:5176/dashboard");
		const frontend = buildSandboxFrontendEnv(config, inheritedEnv);
		assert.deepEqual(Object.keys(frontend).sort(), ["BACKEND_URL", "NODE_ENV", "UI_SANDBOX_HOST"]);
		assert.equal(frontend.BACKEND_URL, "http://127.0.0.1:5177");
		assert.equal(sandboxViteOptions(frontend).server.host, "127.0.0.1");
		assert.equal(sandboxViteOptions(frontend).envDir, false);
		let seeds = 0;
		await prepareSandboxData(config.mode, async () => { seeds += 1; });
		assert.equal(seeds, 0);
	});
});

test("OIDC sandbox imports exactly six SMTP keys from the primary fixture and forces local recovery links", async () => {
	await withFixture(async ({ projectRoot, oidcEnvPath }) => {
		const smtpEntries = [
			"export SMTP_HOST='mail.example.invalid'",
			"SMTP_PORT=587",
			'SMTP_USER="fixture-user"',
			'SMTP_PASS="fixture-only # literal ${NO_EXPANSION}"',
			"SMTP_FROM='Sandbox <sandbox@example.invalid>'",
			"SMTP_SECURE=false",
		];
		const expectedValues = [
			"mail.example.invalid", "587", "fixture-user",
			"fixture-only # literal ${NO_EXPANSION}", "Sandbox <sandbox@example.invalid>", "false",
		];
		writeFileSync(oidcEnvPath, [
			...oidcEntries, ...smtpEntries,
			// Unselected assignments must never be parsed or imported, even if malformed.
			'PUBLIC_APP_URL="unfinished-excluded-fixture',
			'SMTP_TOKEN="unfinished-excluded-fixture',
			"SMTP_HOST_EXTRA=excluded-fixture",
			"DEFAULT_NOTIFICATION_EMAIL=excluded@example.invalid",
			"DEFAULT_SHOUTRRR_URL=excluded-fixture",
			"UNRELATED_SECRET=excluded-fixture",
		].join("\n"));
		writeFileSync(resolve(projectRoot, ".env"), [
			...smtpKeys.map((key) => `${key}=wrong-worktree-fixture`),
			"PUBLIC_APP_URL=http://192.168.1.20",
		].join("\n"));
		const inheritedEnv = Object.fromEntries(
			[...smtpKeys, "SMTP_TOKEN", "PUBLIC_APP_URL"].map((key) => [key, "excluded-inherited"])
		);
		const { backendEnv: env } = await buildSandboxLaunchConfig({
			mode: "oidc", projectRoot, oidcEnvPath, inheritedEnv,
		});
		assert.deepEqual(Object.keys(env).filter((key) => key.startsWith("SMTP_")).sort(), [...smtpKeys].sort());
		for (const [index, key] of smtpKeys.entries()) {
			// Boolean assertions keep even fictional SMTP values out of failure reports.
			assert.ok(env[key] === expectedValues[index], `${key} must come only from the primary fixture`);
		}
		for (const key of ["DEFAULT_NOTIFICATION_EMAIL", "DEFAULT_SHOUTRRR_URL", "UNRELATED_SECRET"]) {
			assert.equal(Object.hasOwn(env, key), false, `${key} must not be forwarded`);
		}
		assert.equal(env.PUBLIC_APP_URL, "http://localhost:5176/");
		assert.equal(env.AUTH_ENABLED, "true");
		assert.equal(env.FORM_LOGIN_ENABLED, "true");
		assert.equal(env.DOTENV_PATH, "/dev/null");
	});
});

test("OIDC sandbox leaves empty SMTP settings absent and rejects multiline SMTP without echoing values", async () => {
	await withFixture(async (options) => {
		writeFileSync(options.oidcEnvPath, [
			...oidcEntries, ...smtpKeys.map((key) => `${key}=""`),
		].join("\n"));
		const build = () => buildSandboxLaunchConfig({ ...options, mode: "oidc", inheritedEnv: {} });
		const { backendEnv } = await build();
		for (const key of smtpKeys) assert.equal(Object.hasOwn(backendEnv, key), false);
		for (const key of smtpKeys) {
			writeFileSync(options.oidcEnvPath, [...oidcEntries, `${key}="unfinished-fixture`].join("\n"));
			await assert.rejects(build, { message: `OIDC sandbox requires a single-line dotenv value for ${key}.` });
		}
	});
});

test("OIDC sandbox fails closed for absent or missing original-worktree configuration without echoing values", async () => {
	await withFixture(async (options) => {
		const build = () => buildSandboxLaunchConfig({ ...options, mode: "oidc", inheritedEnv: {} });
		await assert.rejects(build, { message: "Cannot read the original worktree .env for the OIDC sandbox." });
		for (let omitted = 0; omitted < requiredKeys.length; omitted += 1) {
			writeFileSync(options.oidcEnvPath, oidcEntries.filter((_, index) => index !== omitted).join("\n"));
			await assert.rejects(build, { message: `OIDC sandbox is missing required settings: ${requiredKeys[omitted]}.` });
		}
		writeFileSync(options.oidcEnvPath, 'OIDC_CLIENT_SECRET="unfinished-fixture\n');
		await assert.rejects(build, { message: "OIDC sandbox requires a single-line dotenv value for OIDC_CLIENT_SECRET." });
		for (const issuer of ["not-a-url", "http://issuer.example.invalid", "https://user:fixture@issuer.example.invalid"]) {
			writeFileSync(options.oidcEnvPath, [`OIDC_ISSUER_URL=${issuer}`, ...oidcEntries.slice(1)].join("\n"));
			await assert.rejects(build, { message: "OIDC sandbox requires a valid HTTPS OIDC_ISSUER_URL without embedded credentials." });
		}
	});
});

test("unknown sandbox modes fail closed without seeding", async () => {
	await assert.rejects(() => buildSandboxLaunchConfig({ mode: "unexpected" }), /Unknown UI sandbox mode/);
	await assert.rejects(() => prepareSandboxData("unexpected", () => assert.fail("must not seed")), /Unknown UI sandbox mode/);
});

test("OIDC backend entry rejects production, unsafe auth, data and non-loopback origins before importing the database", () => {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const safeSettings = {
		PATH: process.env.PATH,
		NODE_ENV: "development",
		UI_SANDBOX_LAUNCHER: "1",
		UI_SANDBOX_MODE: "oidc",
		AUTH_ENABLED: "true",
		OIDC_ENABLED: "true",
		FORM_LOGIN_ENABLED: "true",
		REGISTRATION_ENABLED: "true",
		ALLOW_UNAUTHENTICATED: "false",
		DATA_DIR: resolve(root, ".ui-dev/oidc-data"),
		DOTENV_PATH: "/dev/null",
		OIDC_REDIRECT_URI: "http://localhost:5176/api/auth/oidc/callback",
		CORS_ORIGINS: "http://localhost:5176",
	};
	for (const unsafeSetting of [
		{ AUTH_ENABLED: "false" },
		{ NODE_ENV: "production" },
		{ UI_SANDBOX_LAUNCHER: undefined },
		{ OIDC_ENABLED: "false" },
		{ DATA_DIR: resolve(root, ".ui-dev/data") },
		{ OIDC_REDIRECT_URI: "https://production.example.invalid/callback" },
		{ CORS_ORIGINS: "http://192.168.1.20:5176" },
		{ CORS_ORIGINS: "http://localhost:5176,http://192.168.1.20:5176" },
		{ OIDC_REDIRECT_URI: "http://192.168.1.20:5176/api/auth/oidc/callback" },
	]) {
		const result = spawnSync(process.execPath, [
			resolve(root, "backend/node_modules/tsx/dist/cli.mjs"),
			resolve(root, "backend/src/ui-sandbox.ts"),
		], {
			cwd: root,
			encoding: "utf8",
			env: { ...safeSettings, ...unsafeSetting },
			timeout: 15_000,
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /must be started by its launcher with isolated development settings/);
		assert.doesNotMatch(result.stderr, /Backend listening/);
	}
});
