import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Testing Configuration
 *
 * Run E2E tests with:
 *   npm run test:e2e          - Run tests in headless mode
 *   npm run test:e2e:ui       - Run tests with Playwright UI
 *   npm run test:e2e:headed   - Run tests in headed mode
 *
 * Before running tests, ensure both backend and frontend are running:
 *   docker compose -f docker-compose.dev.yml up
 *
 * Or run them separately:
 *   cd backend && npm run dev
 *   cd frontend && npm run dev
 */

// Base URL for the frontend dev server
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:5173";

export default defineConfig({
	// Directory containing test files
	testDir: "./e2e",

	// Test file pattern
	testMatch: "**/*.spec.ts",

	// Maximum time one test can run
	timeout: 30 * 1000,

	// Maximum time to wait for expect assertions
	expect: {
		timeout: 5000,
	},

	// Run tests in parallel
	fullyParallel: true,

	// Fail the build on CI if you accidentally left test.only in the source code
	forbidOnly: !!process.env.CI,

	// Retry failed tests (more retries on CI)
	retries: process.env.CI ? 2 : 0,

	// Opt out of parallel tests on CI
	workers: process.env.CI ? 1 : undefined,

	// Reporter configuration
	reporter: process.env.CI
		? [["html", { outputFolder: "playwright-report" }], ["github"]]
		: [["html", { outputFolder: "playwright-report" }], ["list"]],

	// Shared settings for all projects
	use: {
		// Base URL for page.goto() calls
		baseURL,

		// Collect trace on first retry
		trace: "on-first-retry",

		// Capture screenshot on failure
		screenshot: "only-on-failure",

		// Record video on first retry
		video: "on-first-retry",

		// Default viewport size
		viewport: { width: 1280, height: 720 },

		// Wait for network idle before considering navigation complete
		navigationTimeout: 10000,

		// Accept cookies and local storage
		actionTimeout: 5000,
	},

	// Configure projects for multiple browsers
	projects: [
		// Setup project for authentication state
		{
			name: "setup",
			testMatch: /.*\.setup\.ts/,
		},

		// Desktop browsers
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
			},
			dependencies: ["setup"],
		},

		{
			name: "firefox",
			use: {
				...devices["Desktop Firefox"],
			},
			dependencies: ["setup"],
		},

		{
			name: "webkit",
			use: {
				...devices["Desktop Safari"],
			},
			dependencies: ["setup"],
		},

		// Mobile browsers (optional)
		{
			name: "mobile-chrome",
			use: {
				...devices["Pixel 5"],
			},
			dependencies: ["setup"],
		},

		{
			name: "mobile-safari",
			use: {
				...devices["iPhone 12"],
			},
			dependencies: ["setup"],
		},
	],

	// Directory for test output files (screenshots, traces, videos)
	outputDir: "test-results/",

	// Web server configuration - automatically start dev server if not running
	// Commented out by default as you typically run the dev servers separately
	// webServer: [
	//   {
	//     command: 'cd ../backend && npm run dev',
	//     url: 'http://localhost:3000/health',
	//     reuseExistingServer: !process.env.CI,
	//     timeout: 120 * 1000,
	//   },
	//   {
	//     command: 'npm run dev',
	//     url: 'http://localhost:5173',
	//     reuseExistingServer: !process.env.CI,
	//     timeout: 120 * 1000,
	//   },
	// ],
});
