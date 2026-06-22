import { Button, type ButtonProps } from "@mantine/core";
import type { MouseEventHandler } from "react";

type AppButtonTone =
	| "primary"
	| "secondary"
	| "ghost"
	| "danger"
	| "success"
	| "warning"
	| "warningGhost"
	| "warningOutline";

interface AppButtonProps extends Omit<ButtonProps, "color" | "variant" | "type" | "onClick"> {
	form?: string;
	tone?: AppButtonTone;
	type?: "button" | "submit" | "reset";
	onClick?: MouseEventHandler<HTMLButtonElement>;
	title?: string;
}

export function AppButton({ tone = "primary", ...props }: AppButtonProps) {
	const sharedProps = {
		...props,
	};

	if (tone === "success") {
		return <Button color="green" variant="filled" {...sharedProps} />;
	}

	if (tone === "warning") {
		return <Button color="yellow" variant="filled" {...sharedProps} />;
	}

	if (tone === "warningGhost") {
		return <Button color="yellow" variant="subtle" {...sharedProps} />;
	}

	if (tone === "warningOutline") {
		return <Button color="yellow" variant="outline" {...sharedProps} />;
	}

	if (tone === "danger") {
		return <Button color="red" variant="filled" {...sharedProps} />;
	}

	if (tone === "secondary") {
		return <Button color="brand" variant="default" {...sharedProps} />;
	}

	if (tone === "ghost") {
		return <Button color="brand" variant="subtle" {...sharedProps} />;
	}

	return <Button color="brand" variant="filled" {...sharedProps} />;
}
