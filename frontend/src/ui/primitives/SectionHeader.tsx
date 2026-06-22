import { Group, Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

interface SectionHeaderProps {
	title: string;
	description?: string;
	actions?: ReactNode;
}

export function SectionHeader({ title, description, actions }: SectionHeaderProps) {
	return (
		<Group align="flex-start" justify="space-between" gap="md" wrap="wrap">
			<Stack gap={2}>
				<Title order={3} size="h4">
					{title}
				</Title>
				{description ? (
					<Text c="dimmed" size="sm">
						{description}
					</Text>
				) : null}
			</Stack>
			{actions}
		</Group>
	);
}
