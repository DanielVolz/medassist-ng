import { TextInput, type TextInputProps } from "@mantine/core";

export function AppTextInput(props: TextInputProps) {
	return <TextInput radius="md" size="md" {...props} />;
}
