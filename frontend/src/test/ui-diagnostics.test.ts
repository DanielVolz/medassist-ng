import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";
import {
	type AxeDiagnosticTarget,
	attachUiFailureDiagnostics,
	collectUiDomDiagnostics,
	recordUiAxeDiagnostics,
	sanitizeAxeContrast,
} from "../../e2e/fixtures/ui-diagnostics";

describe("safe UI failure diagnostics", () => {
	it("measures selected UI geometry and style without serializing element text or selectors", () => {
		const hiddenValue = "SAFE-DIAGNOSTIC-PRIVATE-MARKER";
		document.body.innerHTML = `
			<aside data-open="true" id="${hiddenValue}">
				<h2>${hiddenValue}</h2>
				<form>
					<label>${hiddenValue}<input id="${hiddenValue}" value="${hiddenValue}"></label>
					<button style="font-family: Arial; font-size: 16px; line-height: 24px; color: rgb(10, 20, 30); background-color: rgb(240, 230, 220)">
						${hiddenValue}
					</button>
				</form>
			</aside>
		`;
		document.documentElement.dataset.theme = "dark";
		const contrast = sanitizeAxeContrast({
			data: {
				fgColor: "#0a141e",
				bgColor: "#f0e6dc",
				contrastRatio: 12,
				expectedContrastRatio: 4.5,
				unapprovedText: hiddenValue,
			},
		});
		const diagnostics = collectUiDomDiagnostics([{ selector: `#${hiddenValue} input`, contrast: [contrast] }]);
		const serialized = JSON.stringify(diagnostics);

		expect(serialized).not.toContain(hiddenValue);
		expect(serialized).not.toContain("selector");
		expect(serialized).not.toContain("value");
		expect(diagnostics.theme).toBe("dark");
		expect(diagnostics.viewport).toHaveProperty("deviceScaleFactor");
		expect(diagnostics.elements.some((element) => element.kind === "editor")).toBe(true);
		expect(diagnostics.elements.some((element) => element.font.family === "Arial")).toBe(true);
		expect(diagnostics.elements.some((element) => element.foreground === "rgb(10, 20, 30)")).toBe(true);
		expect(diagnostics.elements[0].box).toHaveProperty("width");
		expect(diagnostics.axeTargets[0].tag).toBe("input");
		expect(diagnostics.axeTargets[0].measurement).toMatchObject({
			kind: "axe-target",
			font: expect.objectContaining({ size: expect.any(String) }),
		});
		expect(diagnostics.axeTargets[0].contrast).toEqual([
			{
				fgColor: "#0a141e",
				bgColor: "#f0e6dc",
				contrastRatio: 12,
				expectedContrastRatio: 4.5,
			},
		]);
	});

	it("attaches detailed browser and viewport diagnostics as ui-safe-diagnostics", async () => {
		document.body.innerHTML = `
			<aside data-open="true">
				<button id="SAFE-DIAGNOSTIC-PRIVATE-MARKER" style="color: rgb(10, 20, 30)">Not serialized</button>
			</aside>
		`;
		const attach = vi.fn();
		const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ui-safe-diagnostics-"));
		const outputPath = vi.fn((fileName: string) => path.join(outputDir, fileName));
		const page = {
			context: () => ({
				browser: () => ({
					browserType: () => ({ name: () => "chromium" }),
					version: () => "123.0",
				}),
			}),
			evaluate: async (callback: (targets: AxeDiagnosticTarget[]) => unknown, targets: AxeDiagnosticTarget[]) =>
				callback(targets),
			viewportSize: () => ({ width: 390, height: 844 }),
		} as unknown as Page;
		const testInfo = {
			project: { name: "chromium-ui" },
			outputPath,
			attach,
		} as unknown as TestInfo;
		recordUiAxeDiagnostics(page, [
			{
				selector: "#SAFE-DIAGNOSTIC-PRIVATE-MARKER",
				contrast: [
					{
						fgColor: "#0a141e",
						bgColor: "#f0e6dc",
						contrastRatio: 12,
						expectedContrastRatio: 4.5,
					},
				],
			},
		]);

		try {
			await attachUiFailureDiagnostics(page, testInfo, {
				consoleErrors: 2,
				pageErrors: 1,
				failedRequests: 3,
				httpErrorStatuses: [500],
			});

			const diagnosticsPath = path.join(outputDir, "ui-safe-diagnostics.json");
			expect(outputPath).toHaveBeenCalledWith("ui-safe-diagnostics.json");
			expect(attach).toHaveBeenCalledTimes(1);
			expect(attach).toHaveBeenCalledWith(
				"ui-safe-diagnostics",
				expect.objectContaining({ path: diagnosticsPath, contentType: "application/json" })
			);
			const attachedPayload = JSON.parse(await fs.promises.readFile(diagnosticsPath, "utf8"));
			expect(attachedPayload.browser).toEqual({ name: "chromium", version: "123.0", project: "chromium-ui" });
			expect(attachedPayload.viewport).toMatchObject({
				width: window.innerWidth,
				height: window.innerHeight,
				playwrightWidth: 390,
				playwrightHeight: 844,
			});
			expect(attachedPayload.elements).toEqual(expect.any(Array));
			expect(attachedPayload.axeTargets).toEqual(expect.any(Array));
			expect(attachedPayload.errorCounts).toEqual({
				consoleErrors: 2,
				pageErrors: 1,
				failedRequests: 3,
				httpErrorStatuses: [500],
			});
			expect(attachedPayload.axeTargets[0].contrast[0]).toEqual({
				fgColor: "#0a141e",
				bgColor: "#f0e6dc",
				contrastRatio: 12,
				expectedContrastRatio: 4.5,
			});
			expect(JSON.stringify(attachedPayload)).not.toContain("SAFE-DIAGNOSTIC-PRIVATE-MARKER");
			expect(JSON.stringify(attachedPayload)).not.toContain("Not serialized");
		} finally {
			await fs.promises.rm(outputDir, { recursive: true, force: true });
		}
	});

	it("rejects non-color axe strings and non-finite ratios", () => {
		expect(
			sanitizeAxeContrast({
				data: {
					fgColor: "private content",
					bgColor: "rgb(1, 2, 3)",
					contrastRatio: Number.NaN,
					expectedContrastRatio: 4.5,
				},
			})
		).toEqual({ bgColor: "rgb(1, 2, 3)", expectedContrastRatio: 4.5 });
	});
});
