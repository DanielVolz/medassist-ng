import { Group, Paper, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./SectionCard.module.css";

interface SectionCardProps {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
	className?: string;
	contentClassName?: string;
	padding?: "sm" | "md" | "lg" | string | number;
	"data-testid"?: string;
}

export function SectionCard({
	title,
	description,
	actions,
	children,
	footer,
	className,
	contentClassName,
	padding = "lg",
	"data-testid": dataTestId,
}: SectionCardProps) {
	const cardClassName = [classes.root, className].filter(Boolean).join(" ");
	const contentClassNames = [classes.content, contentClassName].filter(Boolean).join(" ");

	return (
		<Paper withBorder radius={10} p={padding} className={cardClassName} data-testid={dataTestId}>
			{title || description || actions ? (
				<Group justify="space-between" align="center" className={classes.header}>
					{title || description ? (
						<div className={classes.copy}>
							{title ? (
								<Title order={2} className={classes.title}>
									{title}
								</Title>
							) : null}
							{description ? <Text className={classes.description}>{description}</Text> : null}
						</div>
					) : (
						<span />
					)}
					{actions}
				</Group>
			) : null}
			<div className={contentClassNames}>{children}</div>
			{footer ? <div className={classes.footer}>{footer}</div> : null}
		</Paper>
	);
}
