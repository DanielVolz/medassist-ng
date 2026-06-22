import { Stack, type StackProps } from "@mantine/core";
import type { ReactNode } from "react";

interface PageContainerProps extends StackProps {
	children: ReactNode;
}

export function PageContainer({
	children,
	gap = "xl",
	maw = 1200,
	mx = "auto",
	w = "100%",
	...props
}: PageContainerProps) {
	return (
		<Stack gap={gap} maw={maw} mx={mx} w={w} {...props}>
			{children}
		</Stack>
	);
}
