import { Info } from "lucide-react";
import {
	type ButtonHTMLAttributes,
	type CSSProperties,
	cloneElement,
	type FocusEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactElement,
	type ReactNode,
	type TouchEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import classes from "./AppTooltip.module.css";

type AppTooltipEvents = {
	hover?: boolean;
	focus?: boolean;
	touch?: boolean;
};

interface AppTooltipProps {
	children: ReactElement;
	disabled?: boolean;
	events?: AppTooltipEvents;
	label: ReactNode;
	maw?: number | string;
	openDelay?: number;
	opened?: boolean;
}

interface AppTooltipIconProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
	label: ReactNode;
	icon?: ReactNode;
	iconSize?: number;
}

interface AppTooltipTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	children: ReactNode;
	label: ReactNode;
}

interface AppTooltipTargetProps {
	onBlur?: (event: FocusEvent<HTMLElement>) => void;
	onFocus?: (event: FocusEvent<HTMLElement>) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
	onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
	onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
	onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
	onTouchStart?: (event: TouchEvent<HTMLElement>) => void;
	"aria-describedby"?: string;
}

export function AppTooltip({
	children,
	events = { hover: true, focus: true, touch: true },
	label,
	maw = 320,
	openDelay = 150,
	opened,
	disabled = false,
}: AppTooltipProps) {
	const tooltipId = useId();
	const [hoverFocusedOpened, setHoverFocusedOpened] = useState(false);
	const [touchOpened, setTouchOpened] = useState(false);
	const openTimerRef = useRef<number | null>(null);
	const closeTouchTimerRef = useRef<number | null>(null);
	const controlled = typeof opened === "boolean";
	const childProps = (children.props ?? {}) as AppTooltipTargetProps;
	const touchEnabled = events.touch !== false && !controlled;
	const isOpen = !disabled && (controlled ? opened : hoverFocusedOpened || touchOpened);
	const maxWidth = typeof maw === "number" ? `${maw}px` : maw;

	const clearTouchTimer = useCallback(() => {
		if (closeTouchTimerRef.current) {
			window.clearTimeout(closeTouchTimerRef.current);
			closeTouchTimerRef.current = null;
		}
	}, []);

	const clearOpenTimer = useCallback(() => {
		if (openTimerRef.current) {
			window.clearTimeout(openTimerRef.current);
			openTimerRef.current = null;
		}
	}, []);

	const openFromHoverOrFocus = useCallback(() => {
		if (controlled) return;

		clearOpenTimer();
		openTimerRef.current = window.setTimeout(() => {
			setHoverFocusedOpened(true);
			openTimerRef.current = null;
		}, openDelay);
	}, [clearOpenTimer, controlled, openDelay]);

	const closeFromHoverOrFocus = useCallback(() => {
		if (controlled) return;

		clearOpenTimer();
		setHoverFocusedOpened(false);
	}, [clearOpenTimer, controlled]);

	const openFromTouch = useCallback(() => {
		if (!touchEnabled) return;

		clearTouchTimer();
		setTouchOpened(true);
		closeTouchTimerRef.current = window.setTimeout(() => {
			setTouchOpened(false);
			closeTouchTimerRef.current = null;
		}, 2500);
	}, [clearTouchTimer, touchEnabled]);

	const closeFromTouch = useCallback(() => {
		clearTouchTimer();
		setTouchOpened(false);
	}, [clearTouchTimer]);

	useEffect(
		() => () => {
			clearOpenTimer();
			clearTouchTimer();
		},
		[clearOpenTimer, clearTouchTimer]
	);

	const target = cloneElement(children as ReactElement<AppTooltipTargetProps>, {
		"aria-describedby": isOpen ? tooltipId : childProps["aria-describedby"],
		onBlur: (event: FocusEvent<HTMLElement>) => {
			childProps.onBlur?.(event);
			if (events.focus !== false) {
				closeFromHoverOrFocus();
			}
			closeFromTouch();
		},
		onFocus: (event: FocusEvent<HTMLElement>) => {
			childProps.onFocus?.(event);
			if (events.focus !== false) {
				openFromHoverOrFocus();
			}
		},
		onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
			childProps.onKeyDown?.(event);
			if (event.key === "Escape") {
				closeFromHoverOrFocus();
				closeFromTouch();
			}
		},
		onMouseEnter: (event: MouseEvent<HTMLElement>) => {
			childProps.onMouseEnter?.(event);
			if (events.hover !== false) {
				openFromHoverOrFocus();
			}
		},
		onMouseLeave: (event: MouseEvent<HTMLElement>) => {
			childProps.onMouseLeave?.(event);
			if (events.hover !== false) {
				closeFromHoverOrFocus();
			}
		},
		onPointerDown: (event: PointerEvent<HTMLElement>) => {
			childProps.onPointerDown?.(event);
			if (event.pointerType === "touch") {
				openFromTouch();
			}
		},
		onTouchStart: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchStart?.(event);
			openFromTouch();
		},
	} satisfies AppTooltipTargetProps);

	return (
		<span className={classes.tooltipRoot}>
			{target}
			{isOpen ? (
				<span
					className={classes.tooltipBubble}
					id={tooltipId}
					role="tooltip"
					style={{ "--app-tooltip-max-width": maxWidth } as CSSProperties}
				>
					{label}
				</span>
			) : null}
		</span>
	);
}

export function AppTooltipTrigger({ children, className, label, type = "button", ...props }: AppTooltipTriggerProps) {
	return (
		<AppTooltip label={label}>
			<button
				type={type}
				aria-label={typeof label === "string" ? label : props["aria-label"]}
				className={[classes.tooltipTrigger, className].filter(Boolean).join(" ")}
				{...props}
			>
				{children}
			</button>
		</AppTooltip>
	);
}

export function AppTooltipIcon({
	className,
	icon,
	iconSize = 14,
	label,
	type = "button",
	...props
}: AppTooltipIconProps) {
	return (
		<AppTooltip label={label}>
			<button
				type={type}
				aria-label={typeof label === "string" ? label : props["aria-label"]}
				className={[classes.tooltipIcon, className].filter(Boolean).join(" ")}
				{...props}
			>
				{icon ?? <Info size={iconSize} aria-hidden="true" />}
			</button>
		</AppTooltip>
	);
}
