import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

function parseOptionalPort(value: string | undefined) {
	if (!value) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildPlaywrightConfig(runAllBrowsers: boolean) {
	const env =
		typeof globalThis === "object" && "process" in globalThis
			? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {})
			: {};
	const baseURL = env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";
	const apiBaseURL = env.PLAYWRIGHT_API_BASE_URL || "http://localhost:3000";
	const frontendPort = parseOptionalPort(env.PLAYWRIGHT_FRONTEND_PORT) ?? parseOptionalPort(new URL(baseURL).port) ?? 5173;
	const parsedWorkers = Number.parseInt(env.PLAYWRIGHT_WORKERS ?? "", 10);
	// Default to single-worker execution to keep API-seeded E2E suites deterministic.
	// Still allow explicit local overrides via PLAYWRIGHT_WORKERS.
	const workers = Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : 1;

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
			testIgnore: /.*-(?:data|crud|edit|status|schedule|lifecycle)\.spec\.ts|performance\.spec\.ts/,
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
				command: "cd ../backend && npm run dev",
				url: `${apiBaseURL}/health`,
				reuseExistingServer: true,
				timeout: 120 * 1000,
			},
			{
				command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort} --strictPort`,
				url: baseURL,
				reuseExistingServer: true,
				timeout: 120 * 1000,
			},
		],
	});
}
