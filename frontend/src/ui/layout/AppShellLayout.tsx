import { AppShell } from "@mantine/core";
import { useHeadroom } from "@mantine/hooks";
import type { ReactNode } from "react";
import { AppHeader } from "../../components/AppHeader";
import classes from "./AppShellLayout.module.css";

interface AppShellLayoutProps {
	children: ReactNode;
	currentPath: string;
	onNavigate: (path: string) => Promise<void>;
	onOpenProfile: () => void;
	onOpenAbout: () => void;
}

export function AppShellLayout({
	children,
	currentPath,
	onNavigate: _onNavigate,
	onOpenProfile,
	onOpenAbout,
}: AppShellLayoutProps) {
	const { pinned } = useHeadroom({ fixedAt: 60 });
	const keepHeaderVisible = currentPath.startsWith("/medications") && currentPath.includes("editMedId=");

	return (
		<AppShell
			className={classes.shell}
			data-testid="app-shell"
			header={{ height: { base: 132, sm: 72 }, collapsed: keepHeaderVisible ? false : !pinned, offset: false }}
			padding={0}
		>
			<AppShell.Header className={classes.header}>
				<div aria-hidden="true" className={classes.topBlur} data-testid="app-shell-top-blur" />
				<div className={classes.headerInner}>
					<AppHeader onOpenProfile={onOpenProfile} onOpenAbout={onOpenAbout} />
				</div>
			</AppShell.Header>

			<AppShell.Main className={classes.main} data-testid="app-shell-main">
				<div className={classes.page}>{children}</div>
			</AppShell.Main>
		</AppShell>
	);
}
