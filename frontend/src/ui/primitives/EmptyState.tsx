import { Paper, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface EmptyStateProps {
	title: string;
	description?: string;
	icon?: ReactNode;
	"data-testid"?: string;
}

export function EmptyState({ title, description, icon, "data-testid": dataTestId }: EmptyStateProps) {
	return (
		<Paper
			withBorder
			p="xl"
			radius={10}
			ta="center"
			data-testid={dataTestId}
			style={{
				background: "color-mix(in srgb, var(--bg-secondary) 84%, var(--accent) 16%)",
				borderColor: "color-mix(in srgb, var(--border-primary) 88%, transparent)",
				boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--accent) 8%, transparent)",
			}}
		>
			<Stack align="center" gap="sm">
				{icon}
				<Title order={3} c="var(--text-primary)">
					{title}
				</Title>
				{description ? <Text c="var(--text-secondary)">{description}</Text> : null}
			</Stack>
		</Paper>
	);
}
