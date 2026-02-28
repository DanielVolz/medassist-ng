import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

export function buildPlaywrightConfig(runAllBrowsers: boolean) {
	const env =
		typeof globalThis === "object" && "process" in globalThis
			? ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {})
			: {};
	const baseURL = env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";
	const parsedWorkers = Number.parseInt(env.PLAYWRIGHT_WORKERS ?? "", 10);
	const workers = Number.isFinite(parsedWorkers) && parsedWorkers > 0 ? parsedWorkers : env.CI ? 1 : 4;

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
				url: "http://localhost:3000/health",
				reuseExistingServer: true,
				timeout: 120 * 1000,
			},
			{
				command: "npm run dev",
				url: "http://localhost:5173",
				reuseExistingServer: true,
				timeout: 120 * 1000,
			},
		],
	});
}
