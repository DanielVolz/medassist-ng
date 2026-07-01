/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_THEME,
	mergeMantineTheme,
	useMantineCssVariablesResolver,
	useMantineTheme,
	v8CssVariablesResolver,
} from "@mantine/core";
import { useHeadroom } from "@mantine/hooks";
import { modals } from "@mantine/modals";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShellLayout } from "../../ui/layout/AppShellLayout";
import { AppUiProvider } from "../../ui/providers/AppUiProvider";
import { cssVariablesResolver, mantineTheme } from "../../ui/theme/mantineTheme";

const headroomState = vi.hoisted(() => ({
	value: { pinned: true, scrollProgress: 1 },
}));

const notificationProps = vi.hoisted(() => ({
	latest: undefined as
		| undefined
		| {
				autoClose?: unknown;
				pauseResetOnHover?: unknown;
				position?: unknown;
		  },
}));

vi.mock("@mantine/hooks", async () => {
	const actual = await vi.importActual<typeof import("@mantine/hooks")>("@mantine/hooks");

	return {
		...actual,
		useHeadroom: vi.fn(() => headroomState.value),
	};
});

vi.mock("@mantine/notifications", () => ({
	Notifications: (props: typeof notificationProps.latest) => {
		notificationProps.latest = props;
		return <div data-testid="notifications-root" />;
	},
}));

vi.mock("../../components/AppHeader", () => ({
	AppHeader: ({ onOpenAbout, onOpenProfile }: { onOpenAbout: () => void; onOpenProfile: () => void }) => (
		<header data-testid="mock-app-header">
			<button type="button" onClick={onOpenProfile}>
				open profile
			</button>
			<button type="button" onClick={onOpenAbout}>
				open about
			</button>
		</header>
	),
}));

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const collapsedHeaderTransformPattern =
	/--app-shell-header-transform:translateY\(calc\(var\(--app-shell-header-height\) \* -1\)\)/;

function setHeadroomPinned(pinned: boolean) {
	headroomState.value = { pinned, scrollProgress: pinned ? 1 : 0 };
}

function renderAppShell(currentPath = "/dashboard") {
	render(
		<AppShellLayout
			currentPath={currentPath}
			onNavigate={vi.fn().mockResolvedValue(undefined)}
			onOpenAbout={vi.fn()}
			onOpenProfile={vi.fn()}
		>
			<div>Shell content</div>
		</AppShellLayout>
	);
}

function getInlineStyleText() {
	return Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-mantine-styles="inline"]'))
		.map((style) => style.textContent ?? "")
		.join("\n");
}

function readCssVariable(section: object, key: string) {
	return (section as Record<string, string | undefined>)[key];
}

describe("Mantine v9 upgrade contract", () => {
	beforeEach(() => {
		setHeadroomPinned(true);
		notificationProps.latest = undefined;
		document.documentElement.removeAttribute("data-theme");
	});

	afterEach(() => {
		modals.closeAll();
	});

	it("keeps Mantine packages on one coordinated v9 version range", () => {
		const packageJson = JSON.parse(readFileSync(resolve(frontendRoot, "package.json"), "utf8")) as {
			dependencies: Record<string, string>;
		};
		const mantinePackages = [
			"@mantine/core",
			"@mantine/dates",
			"@mantine/hooks",
			"@mantine/modals",
			"@mantine/notifications",
		];
		const versions = mantinePackages.map((packageName) => packageJson.dependencies[packageName]);

		expect(new Set(versions).size).toBe(1);
		expect(versions[0]).toMatch(/^\^9\./);
	});

	it("collapses the app header when the v9 headroom object reports unpinned", () => {
		setHeadroomPinned(false);

		renderAppShell();

		expect(useHeadroom).toHaveBeenCalledWith({ fixedAt: 60 });
		expect(screen.getByTestId("mock-app-header")).toBeInTheDocument();
		expect(getInlineStyleText()).toMatch(collapsedHeaderTransformPattern);
	});

	it("keeps the app header pinned when the v9 headroom object reports pinned", () => {
		setHeadroomPinned(true);

		renderAppShell();

		expect(getInlineStyleText()).not.toMatch(collapsedHeaderTransformPattern);
	});

	it("keeps the medication edit header visible even when headroom reports unpinned", () => {
		setHeadroomPinned(false);

		renderAppShell("/medications?editMedId=42");

		expect(getInlineStyleText()).not.toMatch(collapsedHeaderTransformPattern);
	});

	it("mounts Mantine providers and preserves notification hover pause behavior", () => {
		let providerSnapshot:
			| {
					primaryColor: string;
					usesClinicalResolver: boolean;
			  }
			| undefined;

		function ProviderProbe() {
			const theme = useMantineTheme();
			const resolver = useMantineCssVariablesResolver();
			providerSnapshot = {
				primaryColor: theme.primaryColor,
				usesClinicalResolver: resolver === cssVariablesResolver,
			};

			return <div data-testid="provider-child">provider child</div>;
		}

		render(
			<AppUiProvider>
				<ProviderProbe />
			</AppUiProvider>
		);

		expect(screen.getByTestId("provider-child")).toBeInTheDocument();
		expect(screen.getByTestId("notifications-root")).toBeInTheDocument();
		expect(providerSnapshot).toEqual({
			primaryColor: "brand",
			usesClinicalResolver: true,
		});
		expect(notificationProps.latest).toMatchObject({
			autoClose: 4000,
			pauseResetOnHover: "notification",
			position: "top-right",
		});
	});

	it("keeps the modal provider capable of rendering opened modals", async () => {
		function ModalTrigger() {
			return (
				<button
					type="button"
					onClick={() =>
						modals.open({
							children: <div>Provider modal body</div>,
							title: "Provider modal",
						})
					}
				>
					open modal
				</button>
			);
		}

		render(
			<AppUiProvider>
				<ModalTrigger />
			</AppUiProvider>
		);

		fireEvent.click(screen.getByRole("button", { name: "open modal" }));

		expect(await screen.findByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText("Provider modal body")).toBeInTheDocument();
	});

	it("composes v8 variant variables with the clinical theme resolver", () => {
		const resolvedTheme = mergeMantineTheme(DEFAULT_THEME, mantineTheme);
		const v8Variables = v8CssVariablesResolver(resolvedTheme);
		const clinicalVariables = cssVariablesResolver(resolvedTheme);
		const primaryVariantKeys = [
			"--mantine-primary-color-filled",
			"--mantine-primary-color-filled-hover",
			"--mantine-primary-color-light",
			"--mantine-primary-color-light-hover",
			"--mantine-primary-color-light-color",
		];
		const colorVariantSuffixes = ["light", "light-hover", "light-color"];
		const clinicalColors = ["blue", "brand", "green", "red", "yellow"];

		for (const key of primaryVariantKeys) {
			expect(readCssVariable(clinicalVariables.variables, key)).toBe(readCssVariable(v8Variables.variables, key));
		}

		for (const color of clinicalColors) {
			for (const scheme of ["light", "dark"] as const) {
				for (const suffix of colorVariantSuffixes) {
					const key = `--mantine-color-${color}-${suffix}`;
					expect(readCssVariable(clinicalVariables[scheme], key)).toBe(readCssVariable(v8Variables[scheme], key));
				}
			}
		}

		expect(clinicalVariables.dark["--mantine-color-body"]).toBe("#101314");
		expect(clinicalVariables.light["--mantine-color-body"]).toBe("#f6f6f4");
		expect(clinicalVariables.dark["--bg-primary"]).toBe("#101314");
		expect(clinicalVariables.light["--bg-primary"]).toBe("#f6f6f4");
	});
});
