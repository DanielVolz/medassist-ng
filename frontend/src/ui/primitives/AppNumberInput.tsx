import { NumberInput, type NumberInputProps } from "@mantine/core";

export function AppNumberInput(props: NumberInputProps) {
	return <NumberInput hideControls radius="md" size="md" {...props} />;
}
