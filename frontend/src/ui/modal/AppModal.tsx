import { Modal, type ModalProps } from "@mantine/core";
import { Children, cloneElement, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useScrollLock } from "../../hooks/useScrollLock";
import classes from "./AppModal.module.css";

interface AppModalProps extends Omit<ModalProps, "children" | "onClose" | "opened"> {
	children: ReactNode;
	contentClassName?: string;
	manageEscape?: boolean;
	manageScrollLock?: boolean;
	onClose: () => void;
	overlayClassName?: string;
	/** Class applied to the Mantine root element, which contains overlay and content. */
	rootClassName?: string;
	opened: boolean;
}

type ElementWithChildren = ReactElement<{ children?: ReactNode }>;
type AppModalFooterType = typeof AppModalFooter & { __appModalFooter?: true };

function isAppModalFooterElement(child: ReactNode) {
	return isValidElement(child) && Boolean((child.type as AppModalFooterType).__appModalFooter);
}

function shouldSplitChildElement(child: ReactElement) {
	if (child.type === AppModal) return false;
	if (typeof child.type !== "string") return false;
	if (child.type === "form") return false;
	return (child.props as { children?: ReactNode }).children !== undefined;
}

function splitModalChildren(children: ReactNode): { content: ReactNode[]; footers: ReactNode[] } {
	const content: ReactNode[] = [];
	const footers: ReactNode[] = [];

	Children.toArray(children).forEach((child) => {
		if (isAppModalFooterElement(child)) {
			footers.push(child);
			return;
		}

		if (isValidElement(child) && (child.type === Fragment || shouldSplitChildElement(child))) {
			const nested = splitModalChildren((child.props as { children?: ReactNode }).children);
			footers.push(...nested.footers);
			if (nested.content.length > 0) {
				content.push(cloneElement(child as ElementWithChildren, undefined, Children.toArray(nested.content)));
			}
			return;
		}

		content.push(child);
	});

	return { content, footers };
}

export function AppModal({
	children,
	contentClassName,
	manageEscape = true,
	manageScrollLock = true,
	onClose,
	opened,
	overlayClassName,
	rootClassName,
	centered = true,
	classNames,
	closeOnEscape,
	lockScroll,
	overlayProps,
	radius = 10,
	withinPortal = true,
	withCloseButton = false,
	...props
}: AppModalProps) {
	useEscapeKey(manageEscape && opened, onClose);
	useScrollLock(manageScrollLock && opened);

	const resolvedCloseOnEscape = manageEscape ? false : (closeOnEscape ?? true);
	const resolvedLockScroll = manageScrollLock ? false : (lockScroll ?? true);
	const providedClassNames = typeof classNames === "function" ? undefined : classNames;
	const { content, footers } = splitModalChildren(children);
	const modalContent = Children.toArray(content);
	const modalFooters = Children.toArray(footers);
	const hasFooterSlot = footers.length > 0;

	return (
		<Modal
			classNames={{
				...providedClassNames,
				body: [classes.body, hasFooterSlot ? classes.bodyWithFooter : undefined, providedClassNames?.body]
					.filter(Boolean)
					.join(" "),
				content: [classes.content, contentClassName, providedClassNames?.content].filter(Boolean).join(" "),
				header: [classes.header, providedClassNames?.header].filter(Boolean).join(" "),
				overlay: [overlayClassName, providedClassNames?.overlay].filter(Boolean).join(" "),
				root: [rootClassName, providedClassNames?.root].filter(Boolean).join(" "),
			}}
			centered={centered}
			closeOnEscape={resolvedCloseOnEscape}
			lockScroll={resolvedLockScroll}
			onClose={onClose}
			opened={opened}
			overlayProps={{ backgroundOpacity: 0.38, blur: 1, ...overlayProps }}
			radius={radius}
			withCloseButton={withCloseButton}
			withinPortal={withinPortal}
			zIndex={2400}
			{...props}
		>
			{hasFooterSlot ? (
				<>
					<div className={classes.scrollArea} data-testid="app-modal-scroll-area">
						{modalContent}
					</div>
					{modalFooters}
				</>
			) : (
				children
			)}
		</Modal>
	);
}

interface AppModalFooterProps {
	children: ReactNode;
	layout?: "end" | "split";
	left?: ReactNode;
	stackOnMobile?: boolean;
}

export function AppModalFooter({ children, layout, left, stackOnMobile = true }: AppModalFooterProps) {
	const resolvedLayout = layout ?? (left ? "split" : "end");

	return (
		<div
			className={classes.footer}
			data-layout={resolvedLayout}
			data-stack-on-mobile={stackOnMobile ? "true" : "false"}
			data-testid="app-modal-footer"
		>
			{left ? <div className={classes.footerLeft}>{left}</div> : null}
			<div className={classes.footerActions}>{children}</div>
		</div>
	);
}

(AppModalFooter as AppModalFooterType).__appModalFooter = true;
