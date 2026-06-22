import { Badge, type BadgeProps } from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./StatusBadge.module.css";

export type StatusTone = "success" | "warning" | "danger" | "info" | "high";

interface StatusBadgeProps extends Omit<BadgeProps, "color"> {
	tone: StatusTone;
	children: ReactNode;
}

const toneToColor: Record<StatusTone, string> = {
	danger: "red",
	high: "cyan",
	info: "blue",
	success: "green",
	warning: "yellow",
};

export function StatusBadge({
	tone,
	children,
	radius = "xl",
	variant = "light",
	className,
	...props
}: StatusBadgeProps) {
	return (
		<Badge
			className={[classes.badge, className].filter(Boolean).join(" ")}
			color={toneToColor[tone]}
			radius={radius}
			variant={variant}
			{...props}
		>
			{children}
		</Badge>
	);
}
