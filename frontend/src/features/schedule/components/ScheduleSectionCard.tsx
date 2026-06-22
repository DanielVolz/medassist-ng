import { SectionCard } from "../../../ui/components/SectionCard";

type ScheduleSectionCardProps = {
	title: string;
	children: React.ReactNode;
	headerRight?: React.ReactNode;
	className?: string;
};

export function ScheduleSectionCard({ title, children, headerRight, className }: ScheduleSectionCardProps) {
	return (
		<SectionCard className={className ?? "schedule-full"} title={title} actions={headerRight}>
			{children}
		</SectionCard>
	);
}
