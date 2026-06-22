import { Textarea, type TextareaProps } from "@mantine/core";

export function AppTextarea(props: TextareaProps) {
	return <Textarea autosize minRows={3} radius="md" size="md" {...props} />;
}
