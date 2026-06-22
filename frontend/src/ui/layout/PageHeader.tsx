import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface PageHeaderProps {
	title: string;
	description?: string;
	eyebrow?: string;
	actions?: ReactNode;
	"data-testid"?: string;
}

export function PageHeader({ title, description, eyebrow, actions, "data-testid": dataTestId }: PageHeaderProps) {
	return (
		<Group align="flex-start" justify="space-between" gap="md" wrap="wrap" data-testid={dataTestId}>
			<Stack gap={4}>
				{eyebrow ? (
					<Text c="dimmed" fw={600} size="sm" style={{ letterSpacing: 0, textTransform: "none" }}>
						{eyebrow}
					</Text>
				) : null}
				<Title order={1} size="h2">
					{title}
				</Title>
				{description ? (
					<Text c="dimmed" maw={720}>
						{description}
					</Text>
				) : null}
			</Stack>
			{actions}
		</Group>
	);
}
