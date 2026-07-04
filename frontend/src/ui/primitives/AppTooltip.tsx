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
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
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
	onPointerMove?: (event: PointerEvent<HTMLElement>) => void;
	onTouchStart?: (event: TouchEvent<HTMLElement>) => void;
	onTouchMove?: (event: TouchEvent<HTMLElement>) => void;
	"aria-describedby"?: string;
}

type TooltipPlacement = "top" | "bottom";

interface TooltipPosition {
	arrowOffset: number;
	left: number;
	placement: TooltipPlacement;
	top: number;
	viewportMaxWidth: number;
}

const VIEWPORT_MARGIN = 8;
const TOOLTIP_GAP = 8;
const MIN_READABLE_WIDTH = 160;
const MIN_ARROW_OFFSET = 10;
const TOUCH_FOCUS_SUPPRESSION_MS = 3000;

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
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
	const rootRef = useRef<HTMLSpanElement | null>(null);
	const bubbleRef = useRef<HTMLSpanElement | null>(null);
	const [hoverFocusedOpened, setHoverFocusedOpened] = useState(false);
	const [touchOpened, setTouchOpened] = useState(false);
	const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition | null>(null);
	const openTimerRef = useRef<number | null>(null);
	const lastTouchInteractionRef = useRef(0);
	const controlled = typeof opened === "boolean";
	const childProps = (children.props ?? {}) as AppTooltipTargetProps;
	const touchEnabled = events.touch !== false && !controlled;
	const isOpen = !disabled && (controlled ? opened : hoverFocusedOpened || touchOpened);
	const maxWidth = typeof maw === "number" ? `${maw}px` : maw;
	const canUseDom = typeof document !== "undefined";

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

		setTouchOpened(true);
	}, [touchEnabled]);

	const closeFromTouch = useCallback(() => {
		setTouchOpened(false);
	}, []);

	const closeFromViewportMovement = useCallback(() => {
		closeFromHoverOrFocus();
		closeFromTouch();
	}, [closeFromHoverOrFocus, closeFromTouch]);

	const noteTouchInteraction = useCallback(() => {
		lastTouchInteractionRef.current = Date.now();
	}, []);

	const focusFollowsRecentTouch = useCallback(() => {
		return Date.now() - lastTouchInteractionRef.current < TOUCH_FOCUS_SUPPRESSION_MS;
	}, []);

	useEffect(
		() => () => {
			clearOpenTimer();
		},
		[clearOpenTimer]
	);

	useEffect(() => {
		if (!isOpen || controlled || !canUseDom) return;

		const isInsideTooltip = (target: EventTarget | null) => {
			if (!(target instanceof Node)) return false;
			return Boolean(rootRef.current?.contains(target) || bubbleRef.current?.contains(target));
		};

		const closeTooltipOnOutsideInteraction = (event: Event) => {
			if (!isInsideTooltip(event.target)) {
				closeFromViewportMovement();
			}
		};

		const visualViewport = window.visualViewport;

		document.addEventListener("pointerdown", closeTooltipOnOutsideInteraction, { capture: true, passive: true });
		document.addEventListener("touchstart", closeTooltipOnOutsideInteraction, { capture: true, passive: true });
		document.addEventListener("mousedown", closeTooltipOnOutsideInteraction, { capture: true, passive: true });
		document.addEventListener("scroll", closeFromViewportMovement, { capture: true, passive: true });
		document.addEventListener("wheel", closeFromViewportMovement, { capture: true, passive: true });
		window.addEventListener("scroll", closeFromViewportMovement, { capture: true, passive: true });
		visualViewport?.addEventListener("resize", closeFromViewportMovement, { passive: true });
		visualViewport?.addEventListener("scroll", closeFromViewportMovement, { passive: true });

		return () => {
			document.removeEventListener("pointerdown", closeTooltipOnOutsideInteraction, true);
			document.removeEventListener("touchstart", closeTooltipOnOutsideInteraction, true);
			document.removeEventListener("mousedown", closeTooltipOnOutsideInteraction, true);
			document.removeEventListener("scroll", closeFromViewportMovement, true);
			document.removeEventListener("wheel", closeFromViewportMovement, true);
			window.removeEventListener("scroll", closeFromViewportMovement, true);
			visualViewport?.removeEventListener("resize", closeFromViewportMovement);
			visualViewport?.removeEventListener("scroll", closeFromViewportMovement);
		};
	}, [canUseDom, closeFromViewportMovement, controlled, isOpen]);

	const updateTooltipPosition = useCallback(() => {
		const root = rootRef.current;
		const bubble = bubbleRef.current;
		if (!root || !bubble) return;

		const anchorRect = root.getBoundingClientRect();
		const anchorCenterX = anchorRect.left + anchorRect.width / 2;
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const viewportMaxWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
		const centeredMaxWidth = Math.max(
			0,
			2 * Math.min(anchorCenterX - VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - anchorCenterX)
		);
		const readableMaxWidth = Math.min(MIN_READABLE_WIDTH, viewportMaxWidth);
		const effectiveViewportMaxWidth = Math.max(Math.min(viewportMaxWidth, centeredMaxWidth), readableMaxWidth);

		bubble.style.setProperty("--app-tooltip-viewport-max-width", `${effectiveViewportMaxWidth}px`);

		const bubbleRect = bubble.getBoundingClientRect();
		const bubbleWidth = bubbleRect.width;
		const bubbleHeight = bubbleRect.height;
		const left = clamp(
			anchorCenterX - bubbleWidth / 2,
			VIEWPORT_MARGIN,
			Math.max(VIEWPORT_MARGIN, viewportWidth - VIEWPORT_MARGIN - bubbleWidth)
		);
		const topCandidate = anchorRect.top - TOOLTIP_GAP - bubbleHeight;
		const bottomCandidate = anchorRect.bottom + TOOLTIP_GAP;
		const availableAbove = anchorRect.top - VIEWPORT_MARGIN;
		const availableBelow = viewportHeight - anchorRect.bottom - VIEWPORT_MARGIN;
		const placement: TooltipPlacement =
			topCandidate < VIEWPORT_MARGIN && availableBelow > availableAbove ? "bottom" : "top";
		const verticalCandidate = placement === "top" ? topCandidate : bottomCandidate;
		const top = clamp(
			verticalCandidate,
			VIEWPORT_MARGIN,
			Math.max(VIEWPORT_MARGIN, viewportHeight - VIEWPORT_MARGIN - bubbleHeight)
		);
		const arrowOffset = clamp(
			anchorCenterX - left,
			MIN_ARROW_OFFSET,
			Math.max(MIN_ARROW_OFFSET, bubbleWidth - MIN_ARROW_OFFSET)
		);

		setTooltipPosition({
			arrowOffset,
			left,
			placement,
			top,
			viewportMaxWidth: effectiveViewportMaxWidth,
		});
	}, []);

	useLayoutEffect(() => {
		if (!isOpen || !canUseDom) {
			setTooltipPosition(null);
			return;
		}

		updateTooltipPosition();
		let frame = 0;
		const scheduleUpdate = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(updateTooltipPosition);
		};

		window.addEventListener("resize", scheduleUpdate);

		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", scheduleUpdate);
		};
	}, [canUseDom, isOpen, updateTooltipPosition]);

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
			if (events.focus !== false && !focusFollowsRecentTouch()) {
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
				noteTouchInteraction();
				openFromTouch();
			}
		},
		onPointerMove: (event: PointerEvent<HTMLElement>) => {
			childProps.onPointerMove?.(event);
			if (event.pointerType === "touch") {
				noteTouchInteraction();
			}
		},
		onTouchStart: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchStart?.(event);
			noteTouchInteraction();
			openFromTouch();
		},
		onTouchMove: (event: TouchEvent<HTMLElement>) => {
			childProps.onTouchMove?.(event);
			noteTouchInteraction();
		},
	} satisfies AppTooltipTargetProps);

	const tooltipBubble =
		isOpen && canUseDom
			? createPortal(
					<span
						className={classes.tooltipBubble}
						data-placement={tooltipPosition?.placement ?? "top"}
						data-ready={tooltipPosition ? "true" : "false"}
						id={tooltipId}
						ref={bubbleRef}
						role="tooltip"
						style={
							{
								"--app-tooltip-arrow-offset": tooltipPosition ? `${tooltipPosition.arrowOffset}px` : "50%",
								"--app-tooltip-left": tooltipPosition ? `${tooltipPosition.left}px` : "-9999px",
								"--app-tooltip-max-width": maxWidth,
								"--app-tooltip-top": tooltipPosition ? `${tooltipPosition.top}px` : "-9999px",
								"--app-tooltip-viewport-max-width": tooltipPosition
									? `${tooltipPosition.viewportMaxWidth}px`
									: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
							} as CSSProperties
						}
					>
						{label}
					</span>,
					document.body
				)
			: null;

	return (
		<span className={classes.tooltipRoot} ref={rootRef}>
			{target}
			{tooltipBubble}
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
