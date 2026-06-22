import { Anchor } from "@mantine/core";
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";

type TextActionProps = {
	children: ReactNode;
	className?: string;
	color?: string;
	fontWeight?: CSSProperties["fontWeight"];
	lineHeight?: CSSProperties["lineHeight"];
	onClick: MouseEventHandler<HTMLButtonElement>;
	style?: CSSProperties;
	textAlign?: CSSProperties["textAlign"];
};

export function AppTextAction({
	children,
	className,
	color,
	fontWeight,
	lineHeight,
	onClick,
	style,
	textAlign = "inherit",
}: TextActionProps) {
	return (
		<Anchor
			className={className}
			component="button"
			c={color}
			onClick={onClick}
			style={{
				appearance: "none",
				background: "transparent",
				border: 0,
				cursor: "pointer",
				fontWeight,
				lineHeight,
				padding: 0,
				textAlign,
				textDecorationSkipInk: "auto",
				textDecorationThickness: "0.08em",
				textUnderlineOffset: "0.16em",
				...style,
			}}
			type="button"
			underline="always"
		>
			{children}
		</Anchor>
	);
}
