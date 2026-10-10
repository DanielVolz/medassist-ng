import AxeBuilder from "@axe-core/playwright";
import type { TestInfo } from "@playwright/test";
import {
	authFile,
	createMedicationViaAPI,
	deleteAllMedicationsViaAPI,
	expect,
	navigateTo,
	uiTest as test,
} from "./fixtures";

const longName = "Fictional medication for responsive layout coverage ".repeat(2).slice(0, 98);
const schedule = Array.from({ length: 8 }, (_, index) => ({
	every: 1,
	intakeRemindersEnabled: false,
	start: `2030-01-15T${String(7 + index).padStart(2, "0")}:00:00.000Z`,
	usage: 1,
}));
const reviewedAxeFindingsByView: Record<string, string[]> = {
	desktop: [
		'color-contrast|input[placeholder="e.g. Ozempic"]',
		'color-contrast|input[placeholder="e.g. Semaglutide"]',
		'color-contrast|.date-pair-field:nth-child(1) > .date-input-wrapper > .date-input-native[value=""][type="date"]',
		'color-contrast|.date-pair-field:nth-child(2) > .date-input-wrapper > .date-input-native[value=""][type="date"]',
		'color-contrast|input[placeholder="Type name and press Enter"]',
		'color-contrast|input[type="file"]',
		'label|input[type="file"]',
	],
	mobile: ['label|input[accept="image/*"]'],
};
type AxeDiagnosticTarget = {
	selector: string | null;
	safeTarget: string;
	contrast: Array<Record<string, string | number>>;
};

function safeAxeTarget(selector: string | string[]) {
	const sanitize = (value: string) =>
		value
			.replace(/\[(?:value|placeholder|aria-label|name|title)\s*=\s*(?:"[^"]*"|'[^']*'|[^\]]*)\]/gi, "")
			.replace(/\s+/g, " ")
			.slice(0, 240);
	return typeof selector === "string" ? sanitize(selector) : JSON.stringify(selector.map(sanitize));
}

function axeContrastData(check: { data?: unknown }) {
	if (!check.data || typeof check.data !== "object") return {};
	const data = check.data as Record<string, unknown>;
	const contrast: Record<string, string | number> = {};
	for (const key of ["fgColor", "bgColor", "contrastRatio", "expectedContrastRatio"]) {
		const value = data[key];
		if (typeof value === "string" || typeof value === "number") contrast[key] = value;
	}
	return contrast;
}

async function attachFailureDiagnostics(
	page: Parameters<typeof navigateTo>[0],
	testInfo: TestInfo,
	reason: string,
	axeTargets: AxeDiagnosticTarget[] = []
) {
	try {
		const diagnostics = await page.evaluate((targets) => {
			const editor = document.querySelector('[data-ui-a11y-scope="true"], [role="dialog"], aside[data-open="true"]');
			const selectors = [
				["heading", "h2"],
				["form", "form"],
				["labels", "label"],
				["inputs", "input"],
				["tabs", '[role="tab"]'],
				["actions", "button"],
			] as const;
			const describe = (element: Element, selector: string) => {
				const style = getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				const textBoxes: Array<{ bottom: number; left: number; right: number; top: number }> = [];
				const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
				while (walker.nextNode()) {
					const range = document.createRange();
					range.selectNodeContents(walker.currentNode);
					for (const textRect of Array.from(range.getClientRects())) {
						if (textRect.width > 0 && textRect.height > 0) {
							textBoxes.push({
								bottom: textRect.bottom,
								left: textRect.left,
								right: textRect.right,
								top: textRect.top,
							});
						}
					}
				}
				return {
					selector,
					tag: element.tagName.toLowerCase(),
					box: {
						bottom: rect.bottom,
						height: rect.height,
						left: rect.left,
						right: rect.right,
						top: rect.top,
						width: rect.width,
					},
					font: {
						family: style.fontFamily,
						size: style.fontSize,
						lineHeight: style.lineHeight,
					},
					color: style.color,
					backgroundColor: style.backgroundColor,
					display: style.display,
					textBoxes,
				};
			};
			const themeValue = document.documentElement.dataset.theme ?? document.body.dataset.theme ?? "";
			let theme = "unknown";
			if (themeValue === "light" || themeValue === "dark") {
				theme = themeValue;
			} else if (document.documentElement.classList.contains("dark")) {
				theme = "dark";
			} else if (document.documentElement.classList.contains("light")) {
				theme = "light";
			}
			return {
				viewport: {
					width: window.innerWidth,
					height: window.innerHeight,
					deviceScaleFactor: window.devicePixelRatio,
					documentWidth: document.documentElement.clientWidth,
					documentHeight: document.documentElement.clientHeight,
				},
				colorSchemePreference: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
				reducedMotionPreference: matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference",
				theme,
				editorElements: [
					...(editor ? [describe(editor, "editor")] : []),
					...selectors.flatMap(([name, selector]) =>
						Array.from(editor?.querySelectorAll(selector) ?? [])
							.slice(0, name === "actions" || name === "tabs" ? 8 : 4)
							.map((element) => describe(element, name))
					),
				],
				axeTargets: targets.slice(0, 24).map((target) => {
					let element: Element | null = null;
					if (target.selector !== null) {
						try {
							element = document.querySelector(target.selector);
						} catch {
							// Invalid Axe selectors are reported without DOM-derived details.
						}
					}
					return {
						target: target.safeTarget,
						style: element ? describe(element, target.safeTarget) : null,
						contrast: target.contrast,
					};
				}),
			};
		}, axeTargets);
		const browser = page.context().browser();
		await testInfo.attach("ui-failure-diagnostics.json", {
			body: JSON.stringify(
				{
					reason,
					browser: {
						name: browser?.browserType().name() ?? "unknown",
						version: browser?.version() ?? "unknown",
						project: testInfo.project.name,
						playwrightViewport: page.viewportSize(),
					},
					...diagnostics,
				},
				null,
				2
			),
			contentType: "application/json",
		});
	} catch {
		// Diagnostics must not replace the original visual or accessibility failure.
	}

	try {
		const screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
		await testInfo.attach("ui-failure-rendered-page.png", {
			body: screenshot,
			contentType: "image/png",
		});
	} catch {
		// Playwright's original failure screenshot remains available if this capture fails.
	}
}
async function seedMedications() {
	const medication = await createMedicationViaAPI({
		name: longName,
		genericName: "Sample ingredient with a deliberately extended descriptive name",
		intakes: schedule,
		notes: "Fictional, deterministic UI-only sample data.",
	});
	for (let index = 1; index <= 3; index += 1) {
		await createMedicationViaAPI({
			name: `Supplemental fictional medication ${index}`,
			genericName: `Fictional ingredient ${index}`,
			intakes: [{ every: 1, intakeRemindersEnabled: false, start: "2030-01-15T08:00:00.000Z", usage: 1 }],
			notes: "Fictional, deterministic UI-only sample data.",
		});
	}
	return medication;
}

async function setRealTheme(page: Parameters<typeof navigateTo>[0], theme: "light" | "dark") {
	await page.emulateMedia({ colorScheme: theme, reducedMotion: "no-preference" });
	await page.addInitScript((colorScheme) => {
		try {
			localStorage.setItem("theme", colorScheme);
		} catch {
			// The app reads its theme from the first same-origin navigation.
		}
	}, theme);
}

async function navigateToMedicationList(page: Parameters<typeof navigateTo>[0]) {
	await page.goto("/medications", { waitUntil: "domcontentloaded" });
	await expect(page.getByRole("heading", { name: /^Medications$/i })).toBeVisible({ timeout: 30000 });
}

async function openEditor(page: Parameters<typeof navigateTo>[0]) {
	const row = page.getByTestId("medication-row").filter({ hasText: longName });
	await navigateToMedicationList(page);
	await expect(row).toBeVisible({ timeout: 30000 });
	await row.getByRole("button", { name: /Edit/i }).focus();
	await page.keyboard.press("Enter");
	const editor =
		page.viewportSize()?.width && page.viewportSize()!.width <= 768
			? page.getByRole("dialog")
			: page.locator('aside[data-open="true"]');
	await expect(editor).toBeVisible();
	await expect
		.poll(() =>
			editor.evaluate(
				(element) =>
					element
						.getAnimations({ subtree: true })
						.filter(
							(animation) =>
								animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime)
						).length
			)
		)
		.toBe(0);
	return editor;
}

async function expectRealMotionPreferences(page: Parameters<typeof navigateTo>[0]) {
	expect(await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(false);
	expect(await page.locator("#pw-video-safety-style").count()).toBe(0);
}

async function checkEditorGeometry(
	editor: Awaited<ReturnType<typeof openEditor>>,
	page: Parameters<typeof navigateTo>[0]
) {
	const geometry = await editor.evaluate((element) => {
		const bounds = (target: Element | null) => {
			if (!target) return null;
			const rect = target.getBoundingClientRect();
			return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
		};
		const heading = element.querySelector("h2");
		const back = Array.from(element.querySelectorAll("button")).find((button) =>
			/^Back$/i.test(button.textContent?.trim() ?? "")
		);
		const form = element.querySelector("form");
		const name = form?.querySelector("input");
		const backBox = bounds(back ?? null);
		const headingTextBoxes: NonNullable<ReturnType<typeof bounds>>[] = [];
		if (heading) {
			const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
			while (walker.nextNode()) {
				const range = document.createRange();
				range.selectNodeContents(walker.currentNode);
				for (const rect of Array.from(range.getClientRects())) {
					if (rect.width > 0 && rect.height <= Number.parseFloat(getComputedStyle(heading).lineHeight) * 1.5) {
						headingTextBoxes.push({
							bottom: rect.bottom,
							left: rect.left,
							right: rect.right,
							top: rect.top,
						});
					}
				}
			}
		}
		return {
			editor: bounds(element),
			form: bounds(form ?? null),
			name: bounds(name ?? null),
			viewport: { height: window.innerHeight, width: window.innerWidth },
			headingTextOverlapsBack: headingTextBoxes.some(
				(text) =>
					!!backBox &&
					text.left < backBox.right &&
					text.right > backBox.left &&
					text.top < backBox.bottom &&
					text.bottom > backBox.top
			),
		};
	});

	expect(geometry.form).not.toBeNull();
	expect(geometry.name).not.toBeNull();
	expect(geometry.editor!.left).toBeGreaterThanOrEqual(0);
	expect(geometry.editor!.right).toBeLessThanOrEqual(geometry.viewport.width + 1);
	expect(geometry.editor!.top).toBeGreaterThanOrEqual(0);
	expect(geometry.editor!.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1);
	expect(geometry.headingTextOverlapsBack, "Rendered heading text overlaps the Back control").toBe(false);
	expect(geometry.name!.left).toBeGreaterThanOrEqual(geometry.form!.left);
	expect(geometry.name!.right).toBeLessThanOrEqual(geometry.form!.right + 1);
	const isMobile = (page.viewportSize()?.width ?? 1280) <= 768;
	if (!isMobile) {
		expect(await editor.locator("form").evaluate((form) => form.scrollWidth - form.clientWidth)).toBeLessThanOrEqual(1);
	}

	const scheduleTab = editor.getByRole("tab", { name: /Schedule/i });
	await scheduleTab.focus();
	await page.keyboard.press("Enter");
	await expect(scheduleTab).toHaveAttribute("aria-selected", "true");
	await expect(editor.locator(".blister-row")).toHaveCount(8);

	if (!isMobile) {
		const scrollBody = editor.locator("form > div").first();
		await expect.poll(() => scrollBody.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		await scrollBody.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		await expect.poll(() => scrollBody.evaluate((node) => node.scrollTop > 0)).toBe(true);
		await expect(editor.locator('form button[type="submit"]')).toBeInViewport();
	} else {
		const lastSchedule = editor.getByTestId("mobile-edit-tab-viewport").locator(":scope > div > div").nth(2);
		await expect.poll(() => lastSchedule.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
		await lastSchedule.evaluate((node) => {
			node.scrollTop = node.scrollHeight;
		});
		await expect.poll(() => lastSchedule.evaluate((node) => node.scrollTop > 0)).toBe(true);
		await expect(editor.locator('form button[type="submit"]')).toBeInViewport();
	}
}

test.describe("Medication editor UI regressions", () => {
	test.use({ storageState: authFile });
	test.describe.configure({ timeout: 90000 });

	test.beforeEach(async () => {
		await deleteAllMedicationsViaAPI();
	});

	test.afterAll(async () => {
		await deleteAllMedicationsViaAPI();
	});

	for (const emptyView of [
		{ name: "desktop", size: { width: 1280, height: 900 }, mobile: false, theme: "light" as const },
		{ name: "mobile-dark", size: { width: 390, height: 844 }, mobile: true, theme: "dark" as const },
	]) {
		test(`empty ${emptyView.name} medication list is actionable`, async ({ page }) => {
			await page.setViewportSize(emptyView.size);
			await setRealTheme(page, emptyView.theme);
			await navigateToMedicationList(page);
			const newMedication = page.getByRole("button", { name: "New medication", exact: true });
			await expect(newMedication).toBeVisible({ timeout: 30000 });
			await expect(page.getByTestId("medication-row")).toHaveCount(0);
			await newMedication.click();
			const editor = emptyView.mobile ? page.getByRole("dialog") : page.locator('aside[data-open="true"]');
			await expect(editor).toBeVisible();
		});
	}

	for (const viewport of [
		{ name: "desktop", size: { width: 1280, height: 900 }, mobile: false, theme: "light" as const },
		{ name: "mobile", size: { width: 390, height: 844 }, mobile: true, theme: "light" as const },
		{ name: "desktop-dark", size: { width: 1280, height: 900 }, mobile: false, theme: "dark" as const },
		{ name: "mobile-dark", size: { width: 390, height: 844 }, mobile: true, theme: "dark" as const },
	]) {
		test.describe(viewport.name, () => {
			test.use({ viewport: viewport.size, isMobile: viewport.mobile, hasTouch: viewport.mobile });

			test("long names and eight scheduled intakes remain usable", async ({ page }, testInfo) => {
				await setRealTheme(page, viewport.theme);
				await seedMedications();
				const editor = await openEditor(page);
				await expect(page.getByTestId("medication-row")).toHaveCount(4);
				await expectRealMotionPreferences(page);
				try {
					await expect(page).toHaveScreenshot(`medication-editor-${viewport.name}.png`, {
						animations: "disabled",
						caret: "hide",
						maxDiffPixelRatio: 0.002,
					});
				} catch (error) {
					await attachFailureDiagnostics(page, testInfo, "screenshot assertion");
					throw error;
				}
				await checkEditorGeometry(editor, page);
			});

			if (viewport.theme === "light") {
				test("invalid keyboard submission shows field errors without writing", async ({ page }) => {
					await setRealTheme(page, viewport.theme);
					await seedMedications();
					const editor = await openEditor(page);
					const form = editor.locator("form.form-grid");
					const name = form.locator("input").nth(0);
					const generic = form.locator("input").nth(1);
					await name.fill("");
					await generic.fill("");
					await name.focus();
					await page.keyboard.press("Tab");
					expect(await form.evaluate((formNode) => formNode.contains(document.activeElement))).toBe(true);
					const writes: string[] = [];
					page.on("request", (request) => {
						if (request.method() === "PUT" && /\/api\/medications\/\d+$/.test(new URL(request.url()).pathname)) {
							writes.push(request.method());
						}
					});
					await name.press("Enter");
					await expect(form.locator(".field-error").first()).toBeVisible();
					expect(writes).toEqual([]);
				});

				test("failed API save shows feedback and keeps edits available", async ({ page }) => {
					await setRealTheme(page, viewport.theme);
					const medication = await seedMedications();
					const editor = await openEditor(page);
					await editor.getByRole("tab", { name: "Package", exact: true }).click();
					const notes = editor.locator("textarea").first();
					await notes.fill("Updated fictional note kept after a failed save.");
					await page.route("**/api/medications/*", async (route) => {
						const request = route.request();
						if (request.method() === "PUT" && new URL(request.url()).pathname.endsWith(`/${medication.id}`)) {
							await route.fulfill({ status: 500, json: { error: "Test-only save failure" } });
							return;
						}
						await route.continue();
					});
					await editor.getByRole("button", { name: "Save", exact: true }).click();
					await expect(page.getByRole("alert")).toContainText("Test-only save failure");
					await expect(notes).toHaveValue("Updated fictional note kept after a failed save.");
					await expect(editor).toBeVisible();
				});
			}
		});
	}

	test.describe("mobile modal keyboard focus", () => {
		test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

		test("keeps Tab focus in the dialog and Escape restores the prior route", async ({ page }) => {
			await setRealTheme(page, "light");
			await navigateTo(page, "/dashboard");
			const routeOpener = page.getByTestId("main-nav").getByRole("button", { name: "Medications", exact: true });
			await routeOpener.click();
			await expect(page.getByRole("heading", { name: /^Medications$/i })).toBeVisible();
			await page.getByRole("button", { name: "New medication", exact: true }).click();
			const editor = page.getByRole("dialog");
			await expect(editor).toBeVisible();
			const focusable = editor.locator(
				'button:visible:not([disabled]), input:visible:not([disabled]), textarea:visible:not([disabled]), select:visible:not([disabled]), [tabindex]:visible:not([tabindex="-1"])'
			);
			const first = focusable.first();
			const last = focusable.last();
			await first.focus();
			await page.keyboard.press("Shift+Tab");
			await expect(last).toBeFocused();
			await page.keyboard.press("Tab");
			await expect(first).toBeFocused();
			await page.keyboard.press("Escape");
			await expect(editor).not.toBeVisible();
			await expect(page.getByRole("heading", { name: /^Dashboard$/i })).toBeVisible();
		});
	});

	for (const viewport of [
		{ name: "desktop", size: { width: 1280, height: 900 }, mobile: false },
		{ name: "mobile", size: { width: 390, height: 844 }, mobile: true },
	]) {
		test.describe(`${viewport.name} axe input audit`, () => {
			test.use({ viewport: viewport.size, isMobile: viewport.mobile, hasTouch: viewport.mobile });

			test("reports reviewed findings and no new WCAG 2.1/2.2 editor violations", async ({ page }, testInfo) => {
				await setRealTheme(page, "light");
				await seedMedications();
				const editor = await openEditor(page);
				await editor.evaluate((element) => element.setAttribute("data-ui-a11y-scope", "true"));
				const results = await new AxeBuilder({ page })
					.include('[data-ui-a11y-scope="true"]')
					.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
					.analyze();
				const findings = results.violations.flatMap((violation) =>
					violation.nodes.map((node) => `${violation.id}|${node.target.join(" ")}`)
				);
				const reviewed = findings.filter((finding) => reviewedAxeFindingsByView[viewport.name].includes(finding));
				const unreviewed = findings.filter((finding) => !reviewedAxeFindingsByView[viewport.name].includes(finding));
				console.warn(`Reviewed existing axe findings (${viewport.name}): ${reviewed.join(", ")}`);
				try {
					expect(unreviewed).toEqual([]);
				} catch (error) {
					const axeTargets = results.violations.flatMap((violation) =>
						violation.nodes.flatMap((node) => {
							const contrast = [...node.any, ...node.all, ...node.none]
								.map(axeContrastData)
								.filter((data) => Object.keys(data).length > 0);
							return node.target.map((selector) => ({
								selector: typeof selector === "string" ? selector : null,
								safeTarget: safeAxeTarget(selector),
								contrast,
							}));
						})
					);
					await attachFailureDiagnostics(page, testInfo, "axe assertion", axeTargets);
					throw error;
				}
			});
		});
	}
});
