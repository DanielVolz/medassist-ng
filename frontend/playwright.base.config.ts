import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

const DEFAULT_E2E_BASE_URL = "http://localhost:4174";
const DEFAULT_E2E_API_BASE_URL = "http://localhost:4175";
const DEFAULT_E2E_DATA_DIR = "../frontend/test-results/e2e-data";

function parseOptionalPort(value: string | undefined) {
	if (!value) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function shellQuote(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildPlaywrightConfig(runAllBrowsers: boolean) {
	const env =
		typeof globalThis === "object" && "process" in globalThis
			? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {})
			: {};
	const baseURL = env.PLAYWRIGHT_BASE_URL || DEFAULT_E2E_BASE_URL;
	const apiBaseURL = env.PLAYWRIGHT_API_BASE_URL || DEFAULT_E2E_API_BASE_URL;
	const frontendPort = parseOptionalPort(env.PLAYWRIGHT_FRONTEND_PORT) ?? parseOptionalPort(new URL(baseURL).port) ?? 4174;
	const backendPort = parseOptionalPort(new URL(apiBaseURL).port) ?? 4175;
	const dataDir = env.PLAYWRIGHT_DATA_DIR || DEFAULT_E2E_DATA_DIR;
	const excludeDomainSafety = env.PLAYWRIGHT_EXCLUDE_DOMAIN_SAFETY === "true";
	const reuseExistingServer = env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";
	const parsedWorkers = Number.parseInt(env.PLAYWRIGHT_WORKERS ?? "", 10);
	// Default to single-worker execution to keep API-seeded E2E suites deterministic.
	// Still allow explicit local overrides via PLAYWRIGHT_WORKERS.
	const workers = Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : 1;
	const backendEnv = [
		["PORT", String(backendPort)],
		["DATA_DIR", dataDir],
		["DOTENV_PATH", "/tmp/medassist-playwright-empty.env"],
		["CORS_ORIGINS", baseURL],
		["RATE_LIMIT_MAX", env.PLAYWRIGHT_RATE_LIMIT_MAX || "100000"],
		// The Playwright backend is isolated from local development data, so use
		// explicit test-only credentials to exercise the authenticated browser path.
		["AUTH_ENABLED", "true"],
		["REGISTRATION_ENABLED", "true"],
		["FORM_LOGIN_ENABLED", "true"],
		["JWT_SECRET", "playwright-test-jwt-secret-not-for-production"],
		["REFRESH_SECRET", "playwright-test-refresh-secret-not-for-production"],
		["COOKIE_SECRET", "playwright-test-cookie-secret-not-for-production"],
		// Exercise the SMTP-enabled settings branch without contacting a real mail provider.
		// E2E tests do not send mail; they only verify the server-configured UI state.
		["SMTP_HOST", "smtp.playwright.test"],
		["SMTP_PORT", "2525"],
		["SMTP_USER", "e2e@playwright.test"],
		["SMTP_PASS", "playwright-test-smtp-password"],
	];
	const frontendEnv = [["BACKEND_URL", apiBaseURL]];
	const chromiumTestIgnore = /.*-(?:data|crud|edit|status|schedule|lifecycle)\.spec\.ts|performance\.spec\.ts/;
	const testIgnore = excludeDomainSafety ? [chromiumTestIgnore, /.*domain-safety\.spec\.ts/] : chromiumTestIgnore;

	const projects: NonNullable<PlaywrightTestConfig["projects"]> = [
		{
			name: "setup",
			testMatch: /.*\.setup\.ts/,
		},
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
			},
			testIgnore,
			dependencies: ["setup"],
			retries: 1,
		},
		{
			name: "chromium-data",
			testMatch: /.*-(?:data|crud|edit|status|schedule|lifecycle)\.spec\.ts|performance\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
			},
			dependencies: ["setup"],
			fullyParallel: false,
			retries: 1,
		},
	];

	if (runAllBrowsers) {
		projects.push(
			{
				name: "firefox",
				use: {
					...devices["Desktop Firefox"],
				},
				testIgnore: /.*-(?:data|crud|edit|status|schedule|lifecycle)\.spec\.ts|performance\.spec\.ts/,
				dependencies: ["setup"],
			},
			{
				name: "webkit",
				use: {
					...devices["Desktop Safari"],
				},
				testIgnore: /.*-(?:data|crud|edit|status|schedule|lifecycle)\.spec\.ts|performance\.spec\.ts/,
				dependencies: ["setup"],
			},
		);
	}

	return defineConfig({
		testDir: "./e2e",
		testMatch: "**/*.spec.ts",
		timeout: 30 * 1000,
		expect: {
			timeout: 5000,
		},
		fullyParallel: true,
		forbidOnly: !!env.CI,
		retries: env.CI ? 2 : 0,
		workers,
		reporter: env.CI
			? [["html", { outputFolder: "playwright-report" }], ["github"]]
			: [["html", { outputFolder: "playwright-report" }], ["list"]],
		use: {
			baseURL,
			trace: "on-first-retry",
			screenshot: "only-on-failure",
			video: "on",
			viewport: { width: 1280, height: 720 },
			navigationTimeout: 30000,
			actionTimeout: 5000,
		},
		projects,
		outputDir: "test-results/",
		webServer: [
			{
				command: `cd ../backend && npm --prefix ../shared run build && ${backendEnv
					.map(([key, value]) => `${key}=${shellQuote(value)}`)
					.join(" ")} NODE_ENV=development exec node --import tsx src/index.ts`,
				url: `${apiBaseURL}/health`,
				reuseExistingServer,
				timeout: 120 * 1000,
			},
			{
				command: `npm --prefix ../shared run build && ${frontendEnv.map(([key, value]) => `${key}=${shellQuote(value)}`).join(" ")} exec ./node_modules/.bin/vite --host 127.0.0.1 --port ${frontendPort} --strictPort`,
				url: baseURL,
				reuseExistingServer,
				timeout: 120 * 1000,
			},
		],
	});
}
