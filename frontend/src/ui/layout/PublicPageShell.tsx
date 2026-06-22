import { Container, Group, Paper } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./PublicPageShell.module.css";

interface PublicPageShellProps {
	children: ReactNode;
	className?: string;
	containerClassName?: string;
	shellTestId?: string;
	containerTestId?: string;
}

export function PublicPageShell({
	children,
	className,
	containerClassName,
	shellTestId,
	containerTestId,
}: PublicPageShellProps) {
	return (
		<Container className={[classes.shell, className].filter(Boolean).join(" ")} data-testid={shellTestId} size="xl">
			<Group className={classes.container} justify="center" wrap="nowrap">
				<Paper className={containerClassName} data-testid={containerTestId} radius={10} shadow="sm" withBorder>
					{children}
				</Paper>
			</Group>
		</Container>
	);
}
