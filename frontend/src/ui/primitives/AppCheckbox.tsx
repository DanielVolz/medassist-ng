import { Checkbox, type CheckboxProps, Group } from "@mantine/core";
import type { ReactNode } from "react";
import { AppTooltipIcon } from "./AppTooltip";

interface AppCheckboxProps extends Omit<CheckboxProps, "checked" | "onChange"> {
	checked: boolean;
	onChange: (checked: boolean) => void;
	tooltip?: ReactNode;
	"data-testid"?: string;
}

export function AppCheckbox({ checked, onChange, tooltip, "data-testid": dataTestId, ...props }: AppCheckboxProps) {
	return (
		<Group align="center" gap={8} wrap="wrap" data-testid={dataTestId}>
			<Checkbox
				checked={checked}
				onChange={(event) => onChange(event.currentTarget.checked)}
				radius="sm"
				size="md"
				{...props}
			/>
			{tooltip ? <AppTooltipIcon label={tooltip} /> : null}
		</Group>
	);
}
