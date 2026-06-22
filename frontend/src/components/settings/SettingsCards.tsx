import { ActionIcon } from "@mantine/core";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import classes from "./SettingsCards.module.css";

interface SettingsActionCardProps {
	title: ReactNode;
	description: ReactNode;
	action: ReactNode;
}

export function SettingsActionCard({ title, description, action }: SettingsActionCardProps) {
	return (
		<div className={classes.actionCard}>
			<div className={classes.actionCopy}>
				<span className={classes.actionTitle}>{title}</span>
				<span className={classes.actionDescription}>{description}</span>
			</div>
			<div className={classes.actionControl}>{action}</div>
		</div>
	);
}

interface SettingsOptionCardProps {
	id: string;
	name: string;
	value: string;
	checked: boolean;
	title: ReactNode;
	description: ReactNode;
	onChange: (value: string) => void;
}

export function SettingsOptionCard({
	id,
	name,
	value,
	checked,
	title,
	description,
	onChange,
}: SettingsOptionCardProps) {
	const cardClassName = [classes.optionCard, checked ? classes.optionCardSelected : ""].filter(Boolean).join(" ");

	return (
		<label className={cardClassName} htmlFor={id}>
			<input
				id={id}
				type="radio"
				name={name}
				value={value}
				checked={checked}
				className={classes.optionInput}
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
			<span className={classes.optionTitle}>{title}</span>
			<span className={classes.optionDescription}>{description}</span>
		</label>
	);
}

interface SettingsSuccessNoticeProps {
	title: ReactNode;
	children: ReactNode;
	closeLabel: string;
	onClose: () => void;
}

export function SettingsSuccessNotice({ title, children, closeLabel, onClose }: SettingsSuccessNoticeProps) {
	return (
		<div className={classes.successNotice}>
			<div className={classes.successNoticeBody}>
				<strong className={classes.successNoticeTitle}>{title}</strong>
				<span className={classes.successNoticeText}>{children}</span>
			</div>
			<ActionIcon type="button" color="green" variant="subtle" onClick={onClose} aria-label={closeLabel}>
				<X size={16} aria-hidden="true" />
			</ActionIcon>
		</div>
	);
}
