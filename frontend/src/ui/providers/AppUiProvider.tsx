import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { type ReactNode, useEffect, useState } from "react";
import { cssVariablesResolver, mantineTheme } from "../theme/mantineTheme";
import { getInitialTheme, toMantineColorScheme } from "../theme/themePreference";
import "./AppGlobalBaseline.module.css";

export function AppUiProvider({ children }: { children: ReactNode }) {
	const [colorScheme, setColorScheme] = useState(() => toMantineColorScheme(getInitialTheme()));

	useEffect(() => {
		const root = document.documentElement;
		const syncTheme = () => {
			const nextTheme = getInitialTheme();
			if (root.getAttribute("data-theme") !== nextTheme) {
				root.setAttribute("data-theme", nextTheme);
			}
			setColorScheme(toMantineColorScheme(nextTheme));
		};

		syncTheme();

		const observer = new MutationObserver(syncTheme);
		observer.observe(root, {
			attributeFilter: ["data-theme"],
			attributes: true,
		});

		const mediaQuery = window.matchMedia?.("(prefers-color-scheme: light)");
		mediaQuery?.addEventListener("change", syncTheme);
		window.addEventListener("storage", syncTheme);

		return () => {
			observer.disconnect();
			mediaQuery?.removeEventListener("change", syncTheme);
			window.removeEventListener("storage", syncTheme);
		};
	}, []);

	return (
		<MantineProvider
			cssVariablesResolver={cssVariablesResolver}
			defaultColorScheme="dark"
			forceColorScheme={colorScheme}
			theme={mantineTheme}
		>
			<ModalsProvider>
				{children}
				<Notifications autoClose={4000} position="top-right" />
			</ModalsProvider>
		</MantineProvider>
	);
}
