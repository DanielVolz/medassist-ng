import { Group, Stack, Switch, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { AppTooltipIcon } from "./AppTooltip";

interface AppSwitchProps {
	label?: ReactNode;
	ariaLabel?: string;
	description?: ReactNode;
	tooltip?: ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	"data-testid"?: string;
}

export function AppSwitch({
	label,
	ariaLabel,
	description,
	tooltip,
	checked,
	onChange,
	disabled,
	"data-testid": dataTestId,
}: AppSwitchProps) {
	if (!label && !description && !tooltip) {
		return (
			<div style={{ display: "flex", flex: "0 0 auto", marginLeft: "auto" }} data-testid={dataTestId}>
				<Switch
					aria-label={ariaLabel}
					checked={checked}
					disabled={disabled}
					onChange={(event) => onChange(event.currentTarget.checked)}
				/>
			</div>
		);
	}

	return (
		<Group align="flex-start" justify="space-between" gap="md" wrap="wrap" data-testid={dataTestId}>
			<Stack gap={4} style={{ flex: 1 }}>
				<Group align="center" gap={6} wrap="nowrap">
					<Text fw={600} style={{ flex: 1 }}>
						{label}
					</Text>
					{tooltip ? <AppTooltipIcon label={tooltip} /> : null}
				</Group>
				{description ? (
					<Text c="dimmed" size="sm">
						{description}
					</Text>
				) : null}
			</Stack>
			<div style={{ display: "flex", flex: "0 0 auto", marginLeft: "auto" }}>
				<Switch
					aria-label={ariaLabel}
					checked={checked}
					disabled={disabled}
					onChange={(event) => onChange(event.currentTarget.checked)}
				/>
			</div>
		</Group>
	);
}
